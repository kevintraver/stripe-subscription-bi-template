import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeActiveSubscribersTool } from '../tools/stripe-active-subscribers-tool.js';
import { stripeAgent } from '../agents/stripe-agent.js';

// Input schema for the workflow
const ActiveSubscribersWorkflowInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  growthPeriodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to look back for growth metrics calculation'),
  limit: z
    .number()
    .optional()
    .default(100)
    .describe('Maximum number of subscriptions to fetch from Stripe'),
});

// Output schema for the workflow
const ActiveSubscribersWorkflowOutputSchema = z.object({
  totalActiveSubscriptions: z.number().describe('Total number of active subscriptions'),
  uniqueActiveCustomers: z.number().describe('Number of unique active customers'),
  statusBreakdown: z
    .record(z.string(), z.number())
    .describe('Count of subscriptions by status'),
  growth: z.object({
    newSubscriptions: z.number().describe('New subscriptions in the growth period'),
    existingSubscriptions: z.number().describe('Subscriptions created before the growth period'),
    growthRate: z.number().describe('Growth rate percentage'),
    periodDays: z.number().describe('Growth period in days'),
  }),
  planBreakdown: z.array(z.object({
    planId: z.string(),
    planName: z.string().optional(),
    count: z.number(),
    currency: z.string(),
    interval: z.string(),
  })).describe('Breakdown of active subscriptions by plan'),
  filters: z.object({
    includeTrialSubscriptions: z.boolean(),
    currency: z.string().optional(),
  }),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the analysis'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Step 1: Fetch subscriptions from Stripe MCP server (reused pattern)
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data from Stripe using MCP server',
  inputSchema: ActiveSubscribersWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
    growthPeriodDays: z.number().describe('Growth period for metrics'),
  }),
  
  execute: async ({ inputData }) => {
    const { includeTrialSubscriptions, currency, growthPeriodDays, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe for active subscribers analysis...`);
      
      // Use Stripe agent to fetch subscription data via MCP tools
      const query = `Use the stripe_list_subscriptions tool to fetch exactly ${limit} subscriptions from Stripe.
        Parameters to use:
        - limit: ${limit}
        - Include all subscription statuses (active, trialing, past_due, canceled, etc.)
        ${currency ? `- Filter results by currency: ${currency}` : ''}
        
        Use the stripe_list_subscriptions tool and return the subscription data exactly as received.`;
      
      const response = await stripeAgent.generate([
        { role: 'user', content: query }
      ]);
      
      console.log('Agent response:', JSON.stringify(response, null, 2));
      
      // Extract subscription data from agent response
      let subscriptions = [];
      
      if (response.text) {
        // Look for JSON array in the response text
        const jsonMatch = response.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            subscriptions = JSON.parse(jsonMatch[0]);
            console.log('Successfully parsed subscription data from agent response');
          } catch (parseError) {
            console.error('Failed to parse subscription JSON:', parseError);
          }
        }
      }
      
      // Fallback: check other possible locations
      if (subscriptions.length === 0) {
        if (response.toolResults && Array.isArray(response.toolResults)) {
          subscriptions = response.toolResults;
        } else if (response.toolCalls && Array.isArray(response.toolCalls)) {
          for (const toolCall of response.toolCalls) {
            if (toolCall.result && toolCall.result.data) {
              subscriptions = subscriptions.concat(toolCall.result.data);
            }
          }
        } else if (response.steps && Array.isArray(response.steps)) {
          for (const step of response.steps) {
            if (step.toolCalls) {
              for (const toolCall of step.toolCalls) {
                if (toolCall.result && toolCall.result.data) {
                  subscriptions = subscriptions.concat(toolCall.result.data);
                }
              }
            }
          }
        }
      }
      
      console.log('Extracted subscriptions:', subscriptions?.length || 0);
      
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error(`No subscription data retrieved from Stripe. Agent response: ${JSON.stringify(response)}. Check Stripe API connectivity and STRIPE_SECRET_KEY configuration.`);
      }

      console.log(`Successfully fetched ${subscriptions.length} subscriptions from Stripe`);

      return {
        subscriptions,
        totalFetched: subscriptions.length,
        currency,
        includeTrialSubscriptions,
        growthPeriodDays,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured and Stripe MCP server is accessible.`);
    }
  },
});

// Step 2: Analyze active subscribers using our tool
const analyzeActiveSubscribersStep = createStep({
  id: 'analyze-active-subscribers',
  description: 'Analyze active subscriber metrics from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
    growthPeriodDays: z.number().describe('Growth period for metrics'),
  }),
  outputSchema: ActiveSubscribersWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, includeTrialSubscriptions, growthPeriodDays } = inputData;

    try {
      console.log(`Analyzing active subscribers from ${subscriptions.length} subscriptions...`);

      // Use our active subscribers analysis tool
      const analysisResult = await stripeActiveSubscribersTool.execute({
        context: {
          subscriptions,
          currency,
          includeTrialSubscriptions,
          growthPeriodDays,
        },
        runtimeContext: {} as any,
      });

      console.log(`Active subscribers analysis complete: ${analysisResult.totalActiveSubscriptions} active subscriptions from ${analysisResult.uniqueActiveCustomers} unique customers`);

      return {
        ...analysisResult,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to analyze active subscribers: ${errorMessage}`);
    }
  },
});

// Create the active subscribers workflow
export const activeSubscribersWorkflow = createWorkflow({
  id: 'active-subscribers-workflow',
  description: 'Fetch Stripe subscription data and analyze active subscriber metrics including counts, growth, and plan distribution',
  inputSchema: ActiveSubscribersWorkflowInputSchema,
  outputSchema: ActiveSubscribersWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, analyzeActiveSubscribersStep],
})
  .then(fetchSubscriptionsStep)
  .then(analyzeActiveSubscribersStep)
  .commit();