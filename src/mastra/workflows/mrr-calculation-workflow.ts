import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeMRRTool } from '../tools/stripe-mrr-tool.js';
import { stripeAgent } from '../agents/stripe-agent.js';

// Input schema for the workflow
const MRRWorkflowInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  limit: z
    .number()
    .optional()
    .default(100)
    .describe('Maximum number of subscriptions to fetch from Stripe'),
});

// Output schema for the workflow
const MRRWorkflowOutputSchema = z.object({
  totalMRR: z.number().describe('Total Monthly Recurring Revenue in currency base units (e.g., dollars)'),
  currency: z.string().describe('Primary currency for the calculation'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  breakdown: z.array(z.object({
    subscriptionId: z.string(),
    customerMRR: z.number(),
    planName: z.string().optional(),
    billingInterval: z.string(),
  })).describe('Detailed breakdown of MRR by subscription'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the calculation methodology'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Step 1: Fetch subscriptions from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data from Stripe using MCP server',
  inputSchema: MRRWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
  }),
  
  execute: async ({ inputData }) => {
    const { includeTrialSubscriptions, currency, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe...`);
      
      // Use Stripe agent to fetch subscription data via MCP tools
      const query = `Use the stripe_list_subscriptions tool to fetch exactly ${limit} subscriptions from Stripe.
        Parameters to use:
        - limit: ${limit}
        - status: "active"${includeTrialSubscriptions ? ' (include all active subscriptions including trials)' : ''}
        ${currency ? `- Filter results by currency: ${currency}` : ''}
        
        Use the stripe_list_subscriptions tool and return the subscription data exactly as received.`;
      
      const response = await stripeAgent.generate([
        { role: 'user', content: query }
      ]);
      
      console.log('Agent response:', JSON.stringify(response, null, 2));
      
      // Extract subscription data from agent response
      // The agent returns the subscription data in the text response as JSON
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
            // Use type assertion to access result property that exists at runtime
            const toolCallWithResult = toolCall as any;
            if (toolCallWithResult.result && toolCallWithResult.result.data) {
              subscriptions = subscriptions.concat(toolCallWithResult.result.data);
            }
          }
        } else if (response.steps && Array.isArray(response.steps)) {
          for (const step of response.steps) {
            if (step.toolCalls) {
              for (const toolCall of step.toolCalls) {
                // Use type assertion to access result property that exists at runtime
                const toolCallWithResult = toolCall as any;
                if (toolCallWithResult.result && toolCallWithResult.result.data) {
                  subscriptions = subscriptions.concat(toolCallWithResult.result.data);
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
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured and Stripe MCP server is accessible.`);
    }
  },
});

// Step 2: Calculate MRR using our calculation tool
const calculateMRRStep = createStep({
  id: 'calculate-mrr',
  description: 'Calculate Monthly Recurring Revenue from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
  }),
  outputSchema: MRRWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, includeTrialSubscriptions } = inputData;

    try {
      console.log(`Calculating MRR from ${subscriptions.length} subscriptions...`);

      // Use our MRR calculation tool
      const mrrResult = await stripeMRRTool.execute({
        context: {
          subscriptions,
          currency,
          includeTrialSubscriptions,
        },
        runtimeContext: {} as any,
      });

      console.log(`MRR calculation complete: $${mrrResult.totalMRR} from ${mrrResult.activeSubscriptions} active subscriptions`);

      return {
        ...mrrResult,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate MRR: ${errorMessage}`);
    }
  },
});

// Create the MRR calculation workflow
export const mrrCalculationWorkflow = createWorkflow({
  id: 'mrr-calculation-workflow',
  description: 'Fetch Stripe subscription data and calculate Monthly Recurring Revenue (MRR)',
  inputSchema: MRRWorkflowInputSchema,
  outputSchema: MRRWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateMRRStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateMRRStep)
  .commit();