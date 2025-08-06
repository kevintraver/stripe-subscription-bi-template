import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeActiveSubscribersTool } from '../tools/stripe-active-subscribers-tool.js';
import { mcpClient } from '../mcp/mcp-client.js';

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

// Output schema for the raw analysis (without explanation)
const RawAnalysisOutputSchema = z.object({
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
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Final output schema for the workflow (with human-readable explanation)
const ActiveSubscribersWorkflowOutputSchema = RawAnalysisOutputSchema.extend({
  explanation: z.string().describe('Human-readable explanation of the analysis'),
});

// Step 1: Fetch subscriptions directly from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data directly from Stripe using MCP tools',
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
        growthPeriodDays,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch subscriptions from Stripe: ${errorMessage}. Ensure STRIPE_SECRET_KEY is configured and Stripe MCP server is accessible.`);
    }
  },
});

// Step 2: Analyze active subscribers using our tool (raw data only)
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
  outputSchema: RawAnalysisOutputSchema,

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

      // Return raw analysis data without explanation
      const { explanation: _, ...rawAnalysis } = analysisResult;

      return {
        ...rawAnalysis,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to analyze active subscribers: ${errorMessage}`);
    }
  },
});

// Step 3: Generate human-readable explanation using agent
const generateExplanationStep = createStep({
  id: 'generate-explanation',
  description: 'Generate human-readable explanation of the active subscribers analysis',
  inputSchema: RawAnalysisOutputSchema,
  outputSchema: ActiveSubscribersWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    try {
      console.log('Generating human-readable explanation for active subscribers analysis...');

      // Create a summary of the raw analysis data
      const analysisData = inputData;
      const summary = `
Active Subscribers Analysis Results:
- Total Active Subscriptions: ${analysisData.totalActiveSubscriptions}
- Unique Active Customers: ${analysisData.uniqueActiveCustomers}
- Growth Rate: ${analysisData.growth.growthRate}% over ${analysisData.growth.periodDays} days
- New Subscriptions: ${analysisData.growth.newSubscriptions}
- Status Breakdown: ${JSON.stringify(analysisData.statusBreakdown)}
- Plan Breakdown: ${analysisData.planBreakdown.length} different plans
- Filters Applied: ${JSON.stringify(analysisData.filters)}
- Subscriptions Fetched: ${analysisData.subscriptionsFetched}
- Calculated At: ${analysisData.calculatedAt}
      `;

      // Get the stripe agent from MCP client  
      const agent = await import('../agents/stripe-agent.js').then(m => m.stripeAgent);
      
      // Use the agent to generate a human-readable explanation
      const response = await agent.generate([
        { 
          role: 'user', 
          content: `Please provide a clear, business-friendly explanation of this active subscribers analysis. Focus on key insights and trends that would be valuable for business decision-making:

${summary}

Generate a concise but comprehensive explanation that covers:
1. Overall subscription health
2. Growth trends and what they indicate
3. Customer distribution patterns
4. Key metrics and their business implications
5. Any notable insights from the data`
        }
      ]);

      const explanation = response.text || 'Analysis completed successfully.';
      
      console.log('Generated explanation for active subscribers analysis');

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
        explanation: `Active subscribers analysis completed. Found ${inputData.totalActiveSubscriptions} active subscriptions from ${inputData.uniqueActiveCustomers} unique customers with a ${inputData.growth.growthRate}% growth rate over the last ${inputData.growth.periodDays} days.`,
      };
    }
  },
});

// Create the active subscribers workflow
export const activeSubscribersWorkflow = createWorkflow({
  id: 'active-subscribers-workflow',
  description: 'Fetch Stripe subscription data, analyze active subscriber metrics, and generate human-readable insights',
  inputSchema: ActiveSubscribersWorkflowInputSchema,
  outputSchema: ActiveSubscribersWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, analyzeActiveSubscribersStep, generateExplanationStep],
})
  .then(fetchSubscriptionsStep)
  .then(analyzeActiveSubscribersStep)
  .then(generateExplanationStep)
  .commit();