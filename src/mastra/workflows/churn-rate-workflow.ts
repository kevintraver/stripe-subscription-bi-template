import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeChurnRateTool } from '../tools/stripe-churn-rate-tool.js';
import { mcpClient } from '../mcp/mcp-client.js';

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

// Output schema for the raw analysis (without explanation)
const RawChurnAnalysisSchema = z.object({
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
  filters: z.object({
    periodDays: z.number(),
    currency: z.string().optional(),
  }),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Final output schema for the workflow (with human-readable explanation)
const ChurnRateWorkflowOutputSchema = RawChurnAnalysisSchema.extend({
  explanation: z.string().describe('Human-readable explanation of the calculation'),
});

// Step 1: Fetch subscriptions directly from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data directly from Stripe using MCP tools',
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
      
      // Get available tools from MCP client
      const tools = await mcpClient.getTools();
      console.log('Available MCP tools:', Object.keys(tools || {}));
      
      if (!tools || !tools['stripe_list_subscriptions']) {
        console.error('Available tools:', Object.keys(tools || {}));
        throw new Error('stripe_list_subscriptions tool not available. Ensure Stripe MCP server is configured with STRIPE_SECRET_KEY.');
      }

      // Calculate the date range for fetching subscriptions
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (periodDays + 90)); // Fetch extra to ensure we capture all relevant data

      // Fetch both active and canceled subscriptions separately since 'all' status doesn't work
      const allSubscriptions = [];
      const statusesToFetch = ['active', 'canceled'];
      
      for (const status of statusesToFetch) {
        console.log(`Fetching ${status} subscriptions from Stripe...`);
        
        // Build parameters for the Stripe API call
        const params: any = {
          limit: limit,
          status: status, // Fetch specific status (active or canceled)
          created: { gte: Math.floor(startDate.getTime() / 1000) }, // Include historical data for churn analysis
        };

        // Add currency filter if specified
        if (currency) {
          params.currency = currency;
        }

        // Call stripe_list_subscriptions tool via tools
        console.log(`Calling stripe_list_subscriptions with params for ${status}:`, params);
        const stripeTool = tools['stripe_list_subscriptions'];
        const result = await stripeTool.execute({ context: params });
        
        console.log(`Stripe MCP tool result for ${status}:`, JSON.stringify(result, null, 2));

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
        
        if (Array.isArray(subscriptions) && subscriptions.length > 0) {
          console.log(`Successfully fetched ${subscriptions.length} ${status} subscriptions`);
          allSubscriptions.push(...subscriptions);
        } else {
          console.log(`No ${status} subscriptions found or unable to parse response`);
        }
      }
      
      // Use the combined subscriptions
      const subscriptions = allSubscriptions;

      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error(`No subscription data retrieved from Stripe. Check Stripe API connectivity and STRIPE_SECRET_KEY configuration.`);
      }

      console.log(`Successfully fetched ${subscriptions.length} total subscriptions from Stripe (combined active and canceled)`);

      // DEBUG: Log sample of fetched subscriptions to understand the data structure
      console.log('=== SUBSCRIPTION DATA DEBUG ===');
      console.log(`Total subscriptions: ${subscriptions.length}`);
      
      const activeCount = subscriptions.filter(sub => sub.status === 'active').length;
      const canceledCount = subscriptions.filter(sub => sub.status === 'canceled').length;
      console.log(`Active: ${activeCount}, Canceled: ${canceledCount}`);
      
      // Show sample canceled subscriptions to check for canceled_at field
      const canceledSubs = subscriptions.filter(sub => sub.status === 'canceled').slice(0, 3);
      if (canceledSubs.length > 0) {
        console.log('Sample canceled subscriptions:');
        for (const sub of canceledSubs) {
          console.log(`  - ID: ${sub.id}, Customer: ${sub.customer}, Status: ${sub.status}`);
          console.log(`    Created: ${sub.created ? new Date(sub.created * 1000).toISOString() : 'null'}`);
          console.log(`    Canceled at: ${sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : 'null'}`);
          console.log(`    Current status: ${sub.status}`);
        }
      } else {
        console.log('No canceled subscriptions found in fetched data');
      }
      
      // Show sample active subscriptions for comparison
      const activeSubs = subscriptions.filter(sub => sub.status === 'active').slice(0, 3);
      if (activeSubs.length > 0) {
        console.log('Sample active subscriptions:');
        for (const sub of activeSubs) {
          console.log(`  - ID: ${sub.id}, Customer: ${sub.customer}, Status: ${sub.status}`);
          console.log(`    Created: ${sub.created ? new Date(sub.created * 1000).toISOString() : 'null'}`);
        }
      }
      console.log('=== END DEBUG ===');

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

// Step 2: Calculate churn rate using our calculation tool (raw data only)
const calculateChurnRateStep = createStep({
  id: 'calculate-churn-rate',
  description: 'Calculate customer churn rate from fetched subscription data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    periodDays: z.number().describe('Period for churn analysis'),
  }),
  outputSchema: RawChurnAnalysisSchema,

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

      // Return raw analysis data without explanation
      const { explanation: _, ...rawAnalysis } = churnResult;

      return {
        ...rawAnalysis,
        filters: {
          periodDays,
          currency,
        },
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate churn rate: ${errorMessage}`);
    }
  },
});

// Step 3: Generate human-readable explanation using agent
const generateExplanationStep: any = createStep({
  id: 'generate-explanation',
  description: 'Generate human-readable explanation of the churn rate analysis',
  inputSchema: RawChurnAnalysisSchema,
  outputSchema: ChurnRateWorkflowOutputSchema,

  execute: async ({ inputData }): Promise<any> => {
    try {
      console.log('Generating human-readable explanation for churn rate analysis...');

      // Create a summary of the raw analysis data
      const analysisData = inputData;
      const summary = `
Customer Churn Rate Analysis Results:
- Churn Rate: ${analysisData.churnRate}%
- Retention Rate: ${analysisData.retentionRate}%
- Analysis Period: ${analysisData.period.days} days (${new Date(analysisData.period.startDate).toLocaleDateString()} to ${new Date(analysisData.period.endDate).toLocaleDateString()})

Customer Metrics:
- Total Customers at Start: ${analysisData.totalCustomersAtStart}
- Churned Customers: ${analysisData.churnedCustomersCount}
- New Customers Acquired: ${analysisData.newCustomersInPeriod}
- New Customers Who Churned: ${analysisData.churnedNewCustomers}

Subscription Metrics:
- Total Churned Subscriptions: ${analysisData.churnedSubscriptionsCount}
- Subscriptions Fetched: ${analysisData.subscriptionsFetched}

Churn Breakdown by Reason:
${Object.entries(analysisData.reasonBreakdown).map(([reason, count]) => `- ${reason}: ${count} subscriptions`).join('\n')}

Churn Breakdown by Plan:
${analysisData.planBreakdown.slice(0, 5).map(plan => `- ${plan.planName || plan.planId} (${plan.interval}): ${plan.churnedCount} subscriptions`).join('\n')}
${analysisData.planBreakdown.length > 5 ? `... and ${analysisData.planBreakdown.length - 5} more plans` : ''}

Filters Applied: ${JSON.stringify(analysisData.filters)}
Calculated At: ${analysisData.calculatedAt}
      `;

      // Get the stripe agent from MCP client  
      const agent: any = await import('../agents/stripe-agent.js').then(m => m.stripeAgent);
      
      // Use the agent to generate a human-readable explanation
      const response: any = await agent.generate([
        { 
          role: 'user', 
          content: `Please provide a clear, business-friendly explanation of this customer churn rate analysis. Focus on key insights and trends that would be valuable for business decision-making:

${summary}

Generate a concise but comprehensive explanation that covers:
1. Overall customer retention health and what the churn rate indicates about the business
2. Analysis of customer acquisition vs retention patterns
3. Insights from churn reasons and their business implications
4. Plan-specific churn patterns and what they reveal about product-market fit
5. Strategic recommendations for reducing churn and improving retention
6. Early warning indicators and proactive measures based on the data`
        }
      ]);

      const explanation: string = response.text || 'Churn rate analysis completed successfully.';
      
      console.log('Generated explanation for churn rate analysis');

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
        explanation: `Churn rate analysis completed. Customer churn rate is ${inputData.churnRate}% over ${inputData.period.days} days, with ${inputData.churnedCustomersCount} customers churning out of ${inputData.totalCustomersAtStart} total customers at period start. Retention rate: ${inputData.retentionRate}%.`,
      };
    }
  },
});

// Create the churn rate calculation workflow
export const churnRateWorkflow: any = createWorkflow({
  id: 'churn-rate-workflow',
  description: 'Fetch Stripe subscription data, calculate customer churn rate over a specified period, and generate human-readable insights',
  inputSchema: ChurnRateWorkflowInputSchema,
  outputSchema: ChurnRateWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateChurnRateStep, generateExplanationStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateChurnRateStep)
  .then(generateExplanationStep)
  .commit();