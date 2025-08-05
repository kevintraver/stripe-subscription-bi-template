import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { stripeMRRExpansionTool } from '../tools/stripe-mrr-expansion-tool.js';
import { stripeAgent } from '../agents/stripe-agent.js';

// Input schema for the workflow
const MRRExpansionWorkflowInputSchema = z.object({
  periodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to analyze for MRR expansion (default: 30)'),
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
const MRRExpansionWorkflowOutputSchema = z.object({
  expansionMRR: z.number().describe('Total MRR expansion amount in currency base units'),
  expansionRate: z.number().describe('MRR expansion rate as a percentage of starting MRR'),
  totalUpgrades: z.number().describe('Number of subscription upgrades detected'),
  totalDowngrades: z.number().describe('Number of subscription downgrades detected (for context)'),
  netExpansion: z.number().describe('Net expansion (expansion - contraction) in currency base units'),
  averageExpansionPerUpgrade: z.number().describe('Average MRR increase per upgrade'),
  currency: z.string().describe('Primary currency for the calculation'),
  period: z.object({
    startDate: z.string().describe('ISO date string for period start'),
    endDate: z.string().describe('ISO date string for period end'),
    days: z.number().describe('Number of days in the period'),
  }),
  expansionBreakdown: z
    .array(
      z.object({
        subscriptionId: z.string(),
        customerId: z.string(),
        oldMRR: z.number(),
        newMRR: z.number(),
        expansionAmount: z.number(),
        changeType: z.enum(['upgrade', 'quantity_increase', 'plan_change']),
        planDetails: z.object({
          oldPlan: z.string().optional(),
          newPlan: z.string().optional(),
          oldQuantity: z.number().optional(),
          newQuantity: z.number().optional(),
        }),
        changeDate: z.string(),
      })
    )
    .describe('Detailed breakdown of MRR expansion by subscription'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the MRR expansion calculation'),
  subscriptionsFetched: z.number().describe('Total number of subscriptions fetched from Stripe'),
});

// Step 1: Fetch subscriptions from Stripe MCP server
const fetchSubscriptionsStep = createStep({
  id: 'fetch-subscriptions',
  description: 'Fetch subscription data from Stripe using MCP server for MRR expansion analysis',
  inputSchema: MRRExpansionWorkflowInputSchema,
  outputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    periodDays: z.number().describe('Number of days to analyze for expansion'),
  }),
  
  execute: async ({ inputData }) => {
    const { periodDays, currency, limit } = inputData;
    
    try {
      console.log(`Fetching up to ${limit} subscriptions from Stripe for MRR expansion analysis...`);
      
      // Use Stripe agent to fetch subscription data via MCP tools
      // Need to fetch active subscriptions and recent modifications for expansion analysis
      const query = `Use the stripe_list_subscriptions tool to fetch exactly ${limit} subscriptions from Stripe.
        Parameters to use:
        - limit: ${limit}
        - status: "active" (focus on active subscriptions for expansion analysis)
        ${currency ? `- Filter results by currency: ${currency}` : ''}
        
        Use the stripe_list_subscriptions tool and return the subscription data exactly as received.
        For MRR expansion analysis, we need active subscriptions to identify upgrades, plan changes, and quantity increases.`;
      
      const response = await stripeAgent.generate([
        { role: 'user', content: query }
      ]);
      
      console.log('Agent response for MRR expansion subscriptions fetch:', JSON.stringify(response, null, 2));
      
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
            if ('result' in toolCall && toolCall.result && typeof toolCall.result === 'object' && 'data' in toolCall.result) {
              subscriptions = subscriptions.concat((toolCall.result as any).data);
            }
          }
        } else if (response.steps && Array.isArray(response.steps)) {
          for (const step of response.steps) {
            if (step.toolCalls) {
              for (const toolCall of step.toolCalls) {
                if ('result' in toolCall && toolCall.result && typeof toolCall.result === 'object' && 'data' in toolCall.result) {
                  subscriptions = subscriptions.concat((toolCall.result as any).data);
                }
              }
            }
          }
        }
      }
      
      console.log('Extracted subscriptions for MRR expansion:', subscriptions?.length || 0);
      
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error(`No subscription data retrieved from Stripe. Agent response: ${JSON.stringify(response)}. Check Stripe API connectivity and STRIPE_SECRET_KEY configuration.`);
      }

      console.log(`Successfully fetched ${subscriptions.length} subscriptions from Stripe for MRR expansion analysis`);

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

// Step 2: Calculate MRR expansion using our calculation tool
const calculateMRRExpansionStep = createStep({
  id: 'calculate-mrr-expansion',
  description: 'Calculate MRR expansion from subscription upgrades and plan changes in fetched data',
  inputSchema: z.object({
    subscriptions: z.array(z.any()).describe('Array of Stripe subscription objects'),
    totalFetched: z.number().describe('Total number of subscriptions fetched'),
    currency: z.string().optional().describe('Currency filter applied'),
    periodDays: z.number().describe('Number of days to analyze for expansion'),
  }),
  outputSchema: MRRExpansionWorkflowOutputSchema,

  execute: async ({ inputData }) => {
    const { subscriptions, totalFetched, currency, periodDays } = inputData;

    try {
      console.log(`Calculating MRR expansion from ${subscriptions.length} subscriptions...`);
      console.log(`Parameters: period=${periodDays}days, currency=${currency || 'all'}`);

      // Use our MRR expansion calculation tool
      const expansionResult = await stripeMRRExpansionTool.execute({
        context: {
          subscriptions,
          currency,
          periodDays,
        },
        runtimeContext: {} as any,
      });

      console.log(`MRR Expansion calculation complete:`);
      console.log(`  - Expansion MRR: $${expansionResult.expansionMRR}`);
      console.log(`  - Expansion Rate: ${expansionResult.expansionRate}%`);
      console.log(`  - Total Upgrades: ${expansionResult.totalUpgrades}`);
      console.log(`  - Average Expansion per Upgrade: $${expansionResult.averageExpansionPerUpgrade}`);
      console.log(`  - Net Expansion: $${expansionResult.netExpansion}`);

      return {
        ...expansionResult,
        subscriptionsFetched: totalFetched,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate MRR expansion: ${errorMessage}`);
    }
  },
});

// Create the MRR expansion workflow
export const mrrExpansionWorkflow = createWorkflow({
  id: 'mrr-expansion-workflow',
  description: 'Fetch Stripe subscription data and calculate MRR expansion from subscription upgrades and plan changes to higher tiers',
  inputSchema: MRRExpansionWorkflowInputSchema,
  outputSchema: MRRExpansionWorkflowOutputSchema,
  steps: [fetchSubscriptionsStep, calculateMRRExpansionStep],
})
  .then(fetchSubscriptionsStep)
  .then(calculateMRRExpansionStep)
  .commit();