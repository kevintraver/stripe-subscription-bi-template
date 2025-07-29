import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  isSubscriptionActiveForMRR,
  groupSubscriptionsByStatus,
  countActiveSubscriptions,
  calculateSubscriptionGrowthMetrics,
  calculateUniqueCustomerCount,
} from '../../utils/subscription-calculations.js';
import type { StripeSubscription } from '../../types/subscription-types.js';

// Input schema
const ActiveSubscribersInputSchema = z.object({
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
  subscriptions: z
    .array(z.any())
    .describe('Array of Stripe subscription objects to analyze'),
});

// Output schema
const ActiveSubscribersOutputSchema = z.object({
  totalActiveSubscriptions: z.number().describe('Total number of active subscriptions'),
  uniqueActiveCustomers: z.number().describe('Number of unique active customers'),
  statusBreakdown: z
    .record(z.string(), z.number())
    .describe('Count of subscriptions by status (active, trialing, past_due, etc.)'),
  growth: z.object({
    newSubscriptions: z.number().describe('New subscriptions in the growth period'),
    existingSubscriptions: z.number().describe('Subscriptions created before the growth period'),
    growthRate: z.number().describe('Growth rate percentage'),
    periodDays: z.number().describe('Growth period in days'),
  }),
  planBreakdown: z
    .array(
      z.object({
        planId: z.string(),
        planName: z.string().optional(),
        count: z.number(),
        currency: z.string(),
        interval: z.string(),
      })
    )
    .describe('Breakdown of active subscriptions by plan'),
  filters: z.object({
    includeTrialSubscriptions: z.boolean(),
    currency: z.string().optional(),
  }),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the calculation'),
});

export const stripeActiveSubscribersTool = createTool({
  id: 'stripe-active-subscribers-tool',
  description: 'Analyze active subscriber metrics from provided Stripe subscription data, including counts, status breakdown, growth metrics, and plan distribution. This tool performs the analysis - subscription data should be provided by the agent using Stripe MCP tools.',
  inputSchema: ActiveSubscribersInputSchema,
  outputSchema: ActiveSubscribersOutputSchema,

  execute: async ({ context }) => {
    const { 
      includeTrialSubscriptions = false, 
      currency, 
      growthPeriodDays = 30,
      subscriptions 
    } = context;
    
    try {
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error('No subscription data provided. This tool requires subscription data to be passed in the subscriptions parameter.');
      }

      // Cast subscriptions to the correct type
      const typedSubscriptions = subscriptions as StripeSubscription[];

      // Filter by currency if specified
      const currencyFilteredSubscriptions = currency 
        ? typedSubscriptions.filter(sub => 
            sub.items.data.some(item => item.price.currency === currency.toLowerCase())
          )
        : typedSubscriptions;

      // Get all status counts
      const statusBreakdown = groupSubscriptionsByStatus(currencyFilteredSubscriptions);

      // Count active subscriptions
      const activeSubscriptions = currencyFilteredSubscriptions.filter(sub => 
        isSubscriptionActiveForMRR(sub, includeTrialSubscriptions)
      );
      const totalActiveSubscriptions = activeSubscriptions.length;

      // Count unique active customers
      const uniqueActiveCustomers = calculateUniqueCustomerCount(activeSubscriptions);

      // Calculate growth metrics
      const growth = calculateSubscriptionGrowthMetrics(activeSubscriptions, growthPeriodDays);

      // Create plan breakdown for active subscriptions
      const planMap = new Map<string, {
        planId: string;
        planName?: string;
        count: number;
        currency: string;
        interval: string;
      }>();

      for (const subscription of activeSubscriptions) {
        for (const item of subscription.items.data) {
          const planId = item.price.id;
          const existing = planMap.get(planId);
          
          if (existing) {
            existing.count++;
          } else {
            planMap.set(planId, {
              planId,
              planName: item.price.nickname || undefined,
              count: 1,
              currency: item.price.currency,
              interval: item.price.recurring?.interval || 'unknown',
            });
          }
        }
      }

      const planBreakdown = Array.from(planMap.values()).sort((a, b) => b.count - a.count);

      const result = {
        totalActiveSubscriptions,
        uniqueActiveCustomers,
        statusBreakdown,
        growth: {
          ...growth,
          periodDays: growthPeriodDays,
        },
        planBreakdown,
        filters: {
          includeTrialSubscriptions,
          currency,
        },
        calculatedAt: new Date().toISOString(),
        explanation: `Active subscribers analysis: ${totalActiveSubscriptions} active subscriptions ` +
          `from ${uniqueActiveCustomers} unique customers. ` +
          `Growth: ${growth.newSubscriptions} new subscriptions in last ${growthPeriodDays} days ` +
          `(${growth.growthRate}% growth rate). ` +
          `Status breakdown includes all subscription states. ` +
          `${includeTrialSubscriptions ? 'Trial subscriptions included in active count. ' : 'Trial subscriptions excluded from active count. '}` +
          `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`,
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to analyze active subscribers: ${errorMessage}`);
    }
  },
});