import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeChurnRateTool } from '../tools/stripe-churn-rate-tool.js';
import { stripeAgent } from '../agents/stripe-agent.js';

// Input schema for the workflow
const ChurnRateWorkflowInputSchema = z.object({
  periodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to analyze for churn (default: 30)'),
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
const ChurnRateWorkflowOutputSchema = z.object({
  churnRate: z.number().describe('Customer churn rate as a percentage'),
  churnedCustomersCount: z.number().describe('Number of unique customers who churned'),
  totalCustomersAtStart: z.number().describe('Total unique customers at the start of the period'),
  newCustomersInPeriod: z.number().describe('Number of new customers acquired during the period'),
  churnedNewCustomers: z.number().describe('Number of new customers who churned in the same period'),
  churnedSubscriptionsCount: z.number().describe('Total number of subscriptions that were canceled'),
  reasonBreakdown: z
    .record(z.string(), z.number())
    .describe('Breakdown of churned subscriptions by cancellation reason'),
  planBreakdown: z
    .array(
      z.object({
        planId: z.string(),
        planName: z.string().optional(),
        churnedCount: z.number(),
        currency: z.string(),
        interval: z.string(),
      })
    )
    .describe('Breakdown of churned subscriptions by plan'),
  period: z.object({
    startDate: z.string().describe('ISO date string for period start'),
    endDate: z.string().describe('ISO date string for period end'),
    days: z.number().describe('Number of days in the period'),
  }),
  retentionRate: z.number().describe('Customer retention rate (100 - churn rate)'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the calculation'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Step 1: Fetch subscriptions from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data from Stripe using MCP server',
  inputSchema: ChurnRateWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    periodDays: z.number().describe('Period for churn analysis'),
  }),
  
  execute: async ({ inputData }) => {
    const { periodDays, currency, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe for churn rate analysis...`);
      
      // Calculate the date range for fetching subscriptions
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (periodDays + 90)); // Fetch extra to ensure we capture all relevant data
      
      // Use Stripe agent to fetch subscription data via MCP tools
      const query = `Use the stripe_list_subscriptions tool to fetch exactly ${limit} subscriptions from Stripe.
        Parameters to use:
        - limit: ${limit}
        - Include all subscription statuses (active, canceled, past_due, etc.)
        - created: { gte: ${Math.floor(startDate.getTime() / 1000)} }
        ${currency ? `- Filter results by currency: ${currency}` : ''}
        
        Use the stripe_list_subscriptions tool and return the subscription data exactly as received, including canceled subscriptions.`;
      
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
        periodDays,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured and Stripe MCP server is accessible.`);
    }
  },
});

// Step 2: Calculate churn rate using our calculation tool
const calculateChurnRateStep = createStep({
  id: 'calculate-churn-rate',
  description: 'Calculate customer churn rate from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    periodDays: z.number().describe('Period for churn analysis'),
  }),
  outputSchema: ChurnRateWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, periodDays } = inputData;

    try {
      console.log(`Calculating churn rate from ${subscriptions.length} subscriptions over ${periodDays} days...`);

      // Use our churn rate calculation tool
      const churnResult = await stripeChurnRateTool.execute({
        context: {
          subscriptions,
          currency,
          periodDays,
        },
        runtimeContext: {} as any,
      });

      console.log(`Churn rate calculation complete: ${churnResult.churnRate}% (${churnResult.churnedCustomersCount} churned out of ${churnResult.totalCustomersAtStart} customers)`);

      return {
        ...churnResult,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate churn rate: ${errorMessage}`);
    }
  },
});

// Create the churn rate calculation workflow
export const churnRateWorkflow = createWorkflow({
  id: 'churn-rate-workflow',
  description: 'Fetch Stripe subscription data and calculate customer churn rate over a specified period',
  inputSchema: ChurnRateWorkflowInputSchema,
  outputSchema: ChurnRateWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateChurnRateStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateChurnRateStep)
  .commit();