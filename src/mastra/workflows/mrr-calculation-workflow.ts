import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeMRRTool } from '../tools/stripe-mrr-tool.js';
import { mcpClient } from '../mcp/mcp-client.js';

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

// Output schema for the raw analysis (without explanation)
const RawMRRAnalysisSchema = z.object({
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
  filters: z.object({
    includeTrialSubscriptions: z.boolean(),
    currency: z.string().optional(),
  }),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Final output schema for the workflow (with human-readable explanation)
const MRRWorkflowOutputSchema = RawMRRAnalysisSchema.extend({
  explanation: z.string().describe('Human-readable explanation of the calculation methodology'),
});

// Step 1: Fetch subscriptions directly from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data directly from Stripe using MCP tools',
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
      console.log(`Fetching up to ${limit} subscriptions from Stripe for MRR calculation...`);
      
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

// Step 2: Calculate MRR using our calculation tool (raw data only)
const calculateMRRStep = createStep({
  id: 'calculate-mrr',
  description: 'Calculate Monthly Recurring Revenue from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    includeTrialSubscriptions: z.boolean().describe('Whether trial subscriptions should be included'),
  }),
  outputSchema: RawMRRAnalysisSchema,

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

      // Return raw analysis data without explanation
      const { explanation: _, ...rawAnalysis } = mrrResult;

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
      throw new Error(`Failed to calculate MRR: ${errorMessage}`);
    }
  },
});

// Step 3: Generate human-readable explanation using agent
const generateExplanationStep: any = createStep({
  id: 'generate-explanation',
  description: 'Generate human-readable explanation of the MRR calculation',
  inputSchema: RawMRRAnalysisSchema,
  outputSchema: MRRWorkflowOutputSchema,

  execute: async ({ inputData }): Promise<any> => {
    try {
      console.log('Generating human-readable explanation for MRR calculation...');

      // Create a summary of the raw analysis data
      const analysisData = inputData;
      const summary = `
Monthly Recurring Revenue (MRR) Analysis Results:
- Total MRR: $${analysisData.totalMRR} ${analysisData.currency.toUpperCase()}
- Active Subscriptions: ${analysisData.activeSubscriptions}
- Subscription Breakdown: ${analysisData.breakdown.length} individual subscriptions
- Average Revenue Per Subscription: $${(analysisData.totalMRR / analysisData.activeSubscriptions).toFixed(2)}
- Filters Applied: ${JSON.stringify(analysisData.filters)}
- Subscriptions Fetched: ${analysisData.subscriptionsFetched}
- Calculated At: ${analysisData.calculatedAt}

Breakdown by Billing Interval:
${analysisData.breakdown.reduce((acc: any, item: any) => {
  acc[item.billingInterval] = (acc[item.billingInterval] || 0) + 1;
  return acc;
}, {})}
      `;

      // Get the stripe agent from MCP client  
      const agent: any = await import('../agents/stripe-agent.js').then(m => m.stripeAgent);
      
      // Use the agent to generate a human-readable explanation
      const response: any = await agent.generate([
        { 
          role: 'user', 
          content: `Please provide a clear, business-friendly explanation of this Monthly Recurring Revenue (MRR) analysis. Focus on key insights and trends that would be valuable for business decision-making:

${summary}

Generate a concise but comprehensive explanation that covers:
1. Overall revenue health and what the MRR indicates about the business
2. Subscription distribution patterns and billing preferences
3. Average revenue insights and customer value
4. Key metrics and their business implications
5. Any notable insights from the data that could inform strategy`
        }
      ]);

      const explanation: string = response.text || 'MRR analysis completed successfully.';
      
      console.log('Generated explanation for MRR calculation');

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
        explanation: `MRR calculation completed. Total Monthly Recurring Revenue is $${inputData.totalMRR} ${inputData.currency.toUpperCase()} from ${inputData.activeSubscriptions} active subscriptions, with an average revenue per subscription of $${(inputData.totalMRR / inputData.activeSubscriptions).toFixed(2)}.`,
      };
    }
  },
});

// Create the MRR calculation workflow
export const mrrCalculationWorkflow: any = createWorkflow({
  id: 'mrr-calculation-workflow',
  description: 'Fetch Stripe subscription data, calculate Monthly Recurring Revenue (MRR), and generate human-readable insights',
  inputSchema: MRRWorkflowInputSchema,
  outputSchema: MRRWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateMRRStep, generateExplanationStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateMRRStep)
  .then(generateExplanationStep)
  .commit();