import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeMRRTool } from '../tools/stripe-mrr-tool.js';

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
  
  execute: async ({ inputData, runtimeContext }) => {
    const { includeTrialSubscriptions, currency, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe...`);
      
      // For now, we'll expect the subscription data to be provided via runtimeContext
      // In a real implementation, this step would use Stripe MCP tools through an agent
      // that has access to the MCP tools and can call them directly
      
      const subscriptions = (runtimeContext as any)?.subscriptions;
      
      if (!subscriptions || !Array.isArray(subscriptions)) {
        throw new Error('No subscription data available. This workflow step expects subscription data to be provided via runtimeContext.subscriptions from Stripe MCP tools.');
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
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured.`);
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