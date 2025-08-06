import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeLTVTool } from '../tools/stripe-ltv-tool.js';
import { mcpClient } from '../mcp/mcp-client.js';

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

// Output schema for the raw calculation (without explanation)
const RawLTVOutputSchema = z.object({
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
  dependencyResults: z.object({
    arpu: z.any().describe('Full ARPU calculation results'),
    churnRate: z.any().describe('Full churn rate calculation results'),
  }).describe('Detailed results from dependent calculations'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Final output schema for the workflow (with human-readable explanation)
const LTVWorkflowOutputSchema = RawLTVOutputSchema.extend({
  explanation: z.string().describe('Human-readable explanation of the LTV calculation methodology'),
});

// Step 1: Fetch subscriptions directly from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data directly from Stripe using MCP tools for LTV calculation',
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
      
      // Get available tools from MCP client
      const tools = await mcpClient.getTools();
      console.log('Available MCP tools:', Object.keys(tools || {}));
      
      if (!tools || !tools['stripe_list_subscriptions']) {
        console.error('Available tools:', Object.keys(tools || {}));
        throw new Error('stripe_list_subscriptions tool not available. Ensure Stripe MCP server is configured with STRIPE_SECRET_KEY.');
      }

      // Build parameters for the Stripe API call
      // For LTV calculation, we need both active and canceled subscriptions
      const params: any = {
        limit: limit,
        status: 'all', // Include all status types for churn analysis
      };

      // Add currency filter if specified
      if (currency) {
        params.currency = currency;
      }

      // Call stripe_list_subscriptions tool via tools
      console.log('Calling stripe_list_subscriptions with params:', params);
      const stripeTool = tools['stripe_list_subscriptions'];
      const result = await stripeTool.execute({ context: params });
      
      console.log('Stripe MCP tool result:', JSON.stringify(result, null, 2));

      // Extract subscriptions from the MCP result
      let subscriptions = [];
      
      // Handle MCP response format with content array
      if (result?.content && Array.isArray(result.content)) {
        for (const contentItem of result.content) {
          if (contentItem.type === 'text' && contentItem.text) {
            try {
              // Parse the JSON string from the text content
              const parsedData = JSON.parse(contentItem.text);
              if (Array.isArray(parsedData)) {
                subscriptions = parsedData;
                break;
              }
            } catch (parseError) {
              console.warn('Failed to parse MCP content as JSON:', parseError);
            }
          }
        }
      }
      
      // Fallback to other possible formats
      if (subscriptions.length === 0) {
        if (result?.data?.data && Array.isArray(result.data.data)) {
          subscriptions = result.data.data;
        } else if (result?.data && Array.isArray(result.data)) {
          subscriptions = result.data;
        } else if (Array.isArray(result)) {
          subscriptions = result;
        }
      }

      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error(`No subscription data retrieved from Stripe. MCP result: ${JSON.stringify(result)}. Check Stripe API connectivity and STRIPE_SECRET_KEY configuration.`);
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

// Step 2: Calculate LTV using our calculation tool (raw data only)
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
  outputSchema: RawLTVOutputSchema,

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

      // Return raw analysis data without explanation
      const { explanation: _, ...rawLTVData } = ltvResult;

      return {
        ...rawLTVData,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate LTV: ${errorMessage}`);
    }
  },
});

// Step 3: Generate human-readable explanation using agent
const generateExplanationStep = createStep({
  id: 'generate-explanation',
  description: 'Generate human-readable explanation of the LTV calculation methodology',
  inputSchema: RawLTVOutputSchema,
  outputSchema: LTVWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    try {
      console.log('Generating human-readable explanation for LTV calculation...');

      // Create a summary of the raw LTV data
      const ltvData = inputData;
      const summary = `
LTV (Customer Lifetime Value) Calculation Results:
- LTV: $${ltvData.ltv}
- ARPU (Average Revenue Per User): $${ltvData.arpu}
- Customer Churn Rate: ${ltvData.churnRate}%
- Customer Retention Rate: ${ltvData.retentionRate}%
- Average Customer Lifetime: ${ltvData.monthsToChurn} months
- Total Customers Analyzed: ${ltvData.totalCustomers}
- Active Subscriptions: ${ltvData.activeSubscriptions}
- Churned Customers: ${ltvData.churnedCustomers}
- Currency: ${ltvData.currency}
- Analysis Period: ${ltvData.period.days} days (${ltvData.period.startDate} to ${ltvData.period.endDate})
- Subscriptions Fetched: ${ltvData.subscriptionsFetched}
- Calculated At: ${ltvData.calculatedAt}

Methodology:
- LTV = ARPU ÷ (Churn Rate / 100)
- ARPU calculated from active subscriptions
- Churn Rate calculated from customers who canceled in the analysis period
      `;

      // Get the stripe agent
      const agent = await import('../agents/stripe-agent.js').then(m => m.stripeAgent);
      
      // Use the agent to generate a human-readable explanation
      const response = await agent.generate([
        { 
          role: 'user', 
          content: `Please provide a clear, business-friendly explanation of this Customer Lifetime Value (LTV) analysis. Focus on key insights and actionable recommendations that would be valuable for business decision-making:

${summary}

Generate a comprehensive explanation that covers:
1. What the LTV metric means and why it's important
2. The calculation methodology used (ARPU ÷ Churn Rate)
3. Key insights from the calculated values
4. What the churn rate and retention rate indicate about customer behavior
5. How the average customer lifetime relates to business planning
6. Actionable recommendations based on these metrics
7. Any notable patterns or concerns in the data`
        }
      ]);

      const explanation = response.text || 'LTV calculation completed successfully.';
      
      console.log('Generated explanation for LTV calculation');

      return {
        ...ltvData,
        explanation,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to generate explanation: ${errorMessage}. Using default explanation.`);
      
      // Return with a basic explanation if agent fails
      return {
        ...inputData,
        explanation: `Customer Lifetime Value calculation completed. LTV is $${inputData.ltv}, calculated using ARPU of $${inputData.arpu} and a churn rate of ${inputData.churnRate}%. This indicates that the average customer has a lifetime value of $${inputData.ltv} over ${inputData.monthsToChurn} months.`,
      };
    }
  },
});

// Create the LTV calculation workflow
export const ltvCalculationWorkflow = createWorkflow({
  id: 'ltv-calculation-workflow',
  description: 'Fetch Stripe subscription data, calculate Customer Lifetime Value (LTV) using ARPU ÷ Churn Rate formula, and generate human-readable insights',
  inputSchema: LTVWorkflowInputSchema,
  outputSchema: LTVWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateLTVStep, generateExplanationStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateLTVStep)
  .then(generateExplanationStep)
  .commit();