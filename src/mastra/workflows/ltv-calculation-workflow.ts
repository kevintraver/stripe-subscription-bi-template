import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeLTVTool } from '../tools/stripe-ltv-tool.js';
import { stripeAgent } from '../agents/stripe-agent.js';

// Input schema for the workflow
const LTVWorkflowInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period for ARPU calculation'),
  churnPeriodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to analyze for churn rate calculation (default: 30)'),
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
const LTVWorkflowOutputSchema = z.object({
  ltv: z.number().describe('Customer Lifetime Value in currency base units (e.g., dollars)'),
  arpu: z.number().describe('Average Revenue Per User used in calculation'),
  churnRate: z.number().describe('Customer churn rate percentage used in calculation'),
  retentionRate: z.number().describe('Customer retention rate (100 - churn rate)'),
  monthsToChurn: z.number().describe('Average number of months before a customer churns (1 / monthly churn rate)'),
  currency: z.string().describe('Primary currency for the calculation'),
  totalCustomers: z.number().describe('Total number of unique customers analyzed'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  churnedCustomers: z.number().describe('Number of customers that churned in the analysis period'),
  period: z.object({
    startDate: z.string().describe('ISO date string for churn analysis period start'),
    endDate: z.string().describe('ISO date string for churn analysis period end'),
    days: z.number().describe('Number of days in the churn analysis period'),
  }),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the LTV calculation methodology'),
  dependencyResults: z.object({
    arpu: z.any().describe('Full ARPU calculation results'),
    churnRate: z.any().describe('Full churn rate calculation results'),
  }).describe('Detailed results from dependent calculations'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Step 1: Fetch subscriptions from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data from Stripe using MCP server for LTV calculation',
  inputSchema: LTVWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
    churnPeriodDays: z.number().describe('Number of days to analyze for churn rate'),
  }),
  
  execute: async ({ inputData }) => {
    const { includeTrialSubscriptions, currency, limit, churnPeriodDays } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe for LTV calculation...`);
      
      // Use Stripe agent to fetch subscription data via MCP tools
      // Need to fetch both active and canceled subscriptions for churn analysis
      const query = `Use the stripe_list_subscriptions tool to fetch exactly ${limit} subscriptions from Stripe.
        Parameters to use:
        - limit: ${limit}
        - status: "all" (we need both active and canceled subscriptions for LTV calculation)
        ${includeTrialSubscriptions ? '- Include all subscription statuses including trials' : ''}
        ${currency ? `- Filter results by currency: ${currency}` : ''}
        
        Use the stripe_list_subscriptions tool and return the subscription data exactly as received.
        For LTV calculation, we need both active subscriptions (for ARPU) and canceled subscriptions (for churn rate).`;
      
      const response = await stripeAgent.generate([
        { role: 'user', content: query }
      ]);
      
      console.log('Agent response for LTV subscriptions fetch:', JSON.stringify(response, null, 2));
      
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
      
      console.log('Extracted subscriptions for LTV:', subscriptions?.length || 0);
      
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error(`No subscription data retrieved from Stripe. Agent response: ${JSON.stringify(response)}. Check Stripe API connectivity and STRIPE_SECRET_KEY configuration.`);
      }

      console.log(`Successfully fetched ${subscriptions.length} subscriptions from Stripe for LTV calculation`);

      return {
        subscriptions,
        totalFetched: subscriptions.length,
        currency,
        includeTrialSubscriptions,
        churnPeriodDays,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured and Stripe MCP server is accessible.`);
    }
  },
});

// Step 2: Calculate LTV using our calculation tool
const calculateLTVStep = createStep({
  id: 'calculate-ltv',
  description: 'Calculate Customer Lifetime Value from fetched subscription data using ARPU and churn rate',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
    churnPeriodDays: z.number().describe('Number of days to analyze for churn rate'),
  }),
  outputSchema: LTVWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, includeTrialSubscriptions, churnPeriodDays } = inputData;

    try {
      console.log(`Calculating LTV from ${subscriptions.length} subscriptions...`);
      console.log(`Parameters: includeTrials=${includeTrialSubscriptions}, churnPeriod=${churnPeriodDays}days, currency=${currency || 'all'}`);

      // Use our LTV calculation tool which automatically handles ARPU and churn rate dependencies
      const ltvResult = await stripeLTVTool.execute({
        context: {
          subscriptions,
          currency,
          includeTrialSubscriptions,
          churnPeriodDays,
        },
        runtimeContext: {} as any,
      });

      console.log(`LTV calculation complete:`);
      console.log(`  - LTV: $${ltvResult.ltv}`);
      console.log(`  - ARPU: $${ltvResult.arpu}`);
      console.log(`  - Churn Rate: ${ltvResult.churnRate}%`);
      console.log(`  - Average Customer Lifetime: ${ltvResult.monthsToChurn} months`);
      console.log(`  - Active Subscriptions: ${ltvResult.activeSubscriptions}`);
      console.log(`  - Churned Customers: ${ltvResult.churnedCustomers}`);

      return {
        ...ltvResult,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate LTV: ${errorMessage}`);
    }
  },
});

// Create the LTV calculation workflow
export const ltvCalculationWorkflow = createWorkflow({
  id: 'ltv-calculation-workflow',
  description: 'Fetch Stripe subscription data and calculate Customer Lifetime Value (LTV) using ARPU ÷ Churn Rate formula',
  inputSchema: LTVWorkflowInputSchema,
  outputSchema: LTVWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateLTVStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateLTVStep)
  .commit();