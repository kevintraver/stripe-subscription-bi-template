import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeARPUTool } from '../tools/stripe-arpu-tool.js';
import { mcpClient } from '../mcp/mcp-client.js';

// Input schema for the workflow
const ARPUWorkflowInputSchema = z.object({
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

// Output schema for the raw analysis (without explanation)
const RawARPUAnalysisSchema = z.object({
  arpu: z.number().describe('Average Revenue Per User in currency base units (e.g., dollars)'),
  totalMRR: z.number().describe('Total Monthly Recurring Revenue in currency base units (e.g., dollars)'),
  uniqueCustomers: z.number().describe('Number of unique customers included'),
  currency: z.string().describe('Primary currency for the calculation'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  breakdown: z.array(z.object({
    customerId: z.string(),
    subscriptionId: z.string(),
    customerMRR: z.number(),
    planName: z.string().optional(),
    billingInterval: z.string(),
  })).describe('Detailed breakdown of MRR by customer and subscription'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  filters: z.object({
    includeTrialSubscriptions: z.boolean(),
    currency: z.string().optional(),
  }),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Final output schema for the workflow (with human-readable explanation)
const ARPUWorkflowOutputSchema = RawARPUAnalysisSchema.extend({
  explanation: z.string().describe('Human-readable explanation of the calculation methodology'),
});

// Step 1: Fetch subscriptions directly from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data directly from Stripe using MCP tools',
  inputSchema: ARPUWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
  }),
  
  execute: async ({ inputData }) => {
    const { includeTrialSubscriptions, currency, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe for ARPU calculation...`);
      
      // Get available tools from MCP client
      const tools = await mcpClient.getTools();
      console.log('Available MCP tools:', Object.keys(tools || {}));
      
      if (!tools || !tools['stripe_list_subscriptions']) {
        console.error('Available tools:', Object.keys(tools || {}));
        throw new Error('stripe_list_subscriptions tool not available. Ensure Stripe MCP server is configured with STRIPE_SECRET_KEY.');
      }

      // Build parameters for the Stripe API call
      const params: any = {
        limit: limit,
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

// Step 2: Calculate ARPU using our calculation tool (raw data only)
const calculateARPUStep = createStep({
  id: 'calculate-arpu',
  description: 'Calculate Average Revenue Per User from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
  }),
  outputSchema: RawARPUAnalysisSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, includeTrialSubscriptions } = inputData;

    try {
      console.log(`Calculating ARPU from ${subscriptions.length} subscriptions...`);

      // Use our ARPU calculation tool
      const arpuResult = await stripeARPUTool.execute({
        context: {
          subscriptions,
          currency,
          includeTrialSubscriptions,
        },
        runtimeContext: {} as any,
      });

      console.log(`ARPU calculation complete: $${arpuResult.arpu} (MRR: $${arpuResult.totalMRR} ÷ ${arpuResult.uniqueCustomers} customers)`);

      // Return raw analysis data without explanation
      const { explanation: _, ...rawAnalysis } = arpuResult;

      return {
        ...rawAnalysis,
        filters: {
          includeTrialSubscriptions,
          currency,
        },
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate ARPU: ${errorMessage}`);
    }
  },
});

// Step 3: Generate human-readable explanation using agent
const generateExplanationStep: any = createStep({
  id: 'generate-explanation',
  description: 'Generate human-readable explanation of the ARPU calculation',
  inputSchema: RawARPUAnalysisSchema,
  outputSchema: ARPUWorkflowOutputSchema,

  execute: async ({ inputData }): Promise<any> => {
    try {
      console.log('Generating human-readable explanation for ARPU calculation...');

      // Create a summary of the raw analysis data
      const analysisData = inputData;
      const summary = `
Average Revenue Per User (ARPU) Analysis Results:
- ARPU: $${analysisData.arpu} ${analysisData.currency.toUpperCase()}
- Total MRR: $${analysisData.totalMRR} ${analysisData.currency.toUpperCase()}
- Unique Customers: ${analysisData.uniqueCustomers}
- Active Subscriptions: ${analysisData.activeSubscriptions}
- Subscriptions per Customer Ratio: ${(analysisData.activeSubscriptions / analysisData.uniqueCustomers).toFixed(2)}
- Filters Applied: ${JSON.stringify(analysisData.filters)}
- Subscriptions Fetched: ${analysisData.subscriptionsFetched}
- Calculated At: ${analysisData.calculatedAt}

Customer Distribution Analysis:
- Total Revenue Sources: ${analysisData.breakdown.length} subscription line items
- Billing Interval Distribution: ${analysisData.breakdown.reduce((acc: any, item: any) => {
  acc[item.billingInterval] = (acc[item.billingInterval] || 0) + 1;
  return acc;
}, {})}

Revenue Insights:
- Average MRR per Customer: $${(analysisData.totalMRR / analysisData.uniqueCustomers).toFixed(2)}
- Average MRR per Subscription: $${(analysisData.totalMRR / analysisData.activeSubscriptions).toFixed(2)}
      `;

      // Get the stripe agent from MCP client  
      const agent: any = await import('../agents/stripe-agent.js').then(m => m.stripeAgent);
      
      // Use the agent to generate a human-readable explanation
      const response: any = await agent.generate([
        { 
          role: 'user', 
          content: `Please provide a clear, business-friendly explanation of this Average Revenue Per User (ARPU) analysis. Focus on key insights and trends that would be valuable for business decision-making:

${summary}

Generate a concise but comprehensive explanation that covers:
1. Overall customer value assessment and what the ARPU indicates about the business
2. Customer behavior patterns and subscription preferences
3. Revenue distribution and customer concentration insights
4. Comparison of per-customer vs per-subscription metrics and their implications
5. Key business insights that could inform pricing, customer acquisition, or retention strategies`
        }
      ]);

      const explanation: string = response.text || 'ARPU analysis completed successfully.';
      
      console.log('Generated explanation for ARPU calculation');

      return {
        ...analysisData,
        explanation,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to generate explanation: ${errorMessage}. Using default explanation.`);
      
      // Return with a basic explanation if agent fails
      return {
        ...inputData,
        explanation: `ARPU calculation completed. Average Revenue Per User is $${inputData.arpu} ${inputData.currency.toUpperCase()}, calculated from $${inputData.totalMRR} total MRR across ${inputData.uniqueCustomers} unique customers (${inputData.activeSubscriptions} active subscriptions).`,
      };
    }
  },
});

// Create the ARPU calculation workflow
export const arpuCalculationWorkflow: any = createWorkflow({
  id: 'arpu-calculation-workflow',
  description: 'Fetch Stripe subscription data, calculate Average Revenue Per User (ARPU), and generate human-readable insights',
  inputSchema: ARPUWorkflowInputSchema,
  outputSchema: ARPUWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateARPUStep, generateExplanationStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateARPUStep)
  .then(generateExplanationStep)
  .commit();