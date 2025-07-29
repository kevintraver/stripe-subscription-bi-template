import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  identifyChurnedCustomers,
  calculateChurnRate,
  groupChurnedByReason,
  calculateUniqueCustomerCount,
  getBillingIntervalDescription,
} from '../../utils/subscription-calculations.js';
import type { StripeSubscription } from '../../types/subscription-types.js';

// Input schema
const ChurnRateInputSchema = z.object({
  periodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to analyze for churn (default: 30)'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  subscriptions: z
    .array(z.any())
    .describe('Array of Stripe subscription objects to analyze for churn'),
});

// Output schema
const ChurnRateOutputSchema = z.object({
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
});

export const stripeChurnRateTool = createTool({
  id: 'stripe-churn-rate-tool',
  description: 'Calculate customer churn rate from provided Stripe subscription data by analyzing cancellations within a specified time period. This tool performs the calculation logic - subscription data should be provided by the agent using Stripe MCP tools.',
  inputSchema: ChurnRateInputSchema,
  outputSchema: ChurnRateOutputSchema,

  execute: async ({ context }) => {
    const { periodDays = 30, currency, subscriptions } = context;
    
    try {
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error('No subscription data provided. This tool requires subscription data to be passed in the subscriptions parameter.');
      }

      // Cast subscriptions to the correct type
      const typedSubscriptions = subscriptions as StripeSubscription[];

      // Calculate period timestamps
      const periodEndTimestamp = Math.floor(Date.now() / 1000);
      const periodStartTimestamp = periodEndTimestamp - (periodDays * 24 * 60 * 60);
      const periodStartDate = new Date(periodStartTimestamp * 1000);
      const periodEndDate = new Date(periodEndTimestamp * 1000);

      // Filter by currency if specified
      const currencyFilteredSubscriptions = currency 
        ? typedSubscriptions.filter(sub => 
            sub.items.data.some(item => item.price.currency === currency.toLowerCase())
          )
        : typedSubscriptions;

      // Get customers at start of period (those with subscriptions created before period start)
      const customersAtStart = new Set<string>();
      const customersAcquiredInPeriod = new Set<string>();
      
      for (const subscription of currencyFilteredSubscriptions) {
        if (subscription.created < periodStartTimestamp) {
          customersAtStart.add(subscription.customer);
        } else if (subscription.created >= periodStartTimestamp && subscription.created <= periodEndTimestamp) {
          customersAcquiredInPeriod.add(subscription.customer);
        }
      }
      
      const totalCustomersAtStart = customersAtStart.size;
      const newCustomersInPeriod = customersAcquiredInPeriod.size;

      // Identify churned customers and subscriptions
      const { churnedCustomers, churnedSubscriptions } = identifyChurnedCustomers(
        currencyFilteredSubscriptions,
        periodStartTimestamp,
        periodEndTimestamp
      );

      // Calculate churn rate
      const churnedCustomersCount = churnedCustomers.size;
      
      // Count how many of the churned customers were new (acquired in the same period)
      let churnedNewCustomers = 0;
      for (const customerId of churnedCustomers) {
        if (customersAcquiredInPeriod.has(customerId)) {
          churnedNewCustomers++;
        }
      }
      
      // Calculate churn rate - use appropriate base depending on business maturity
      let churnRate: number;
      let calculationMethod: string;
      
      if (totalCustomersAtStart > 0) {
        // Traditional churn rate: churned / customers at start
        churnRate = calculateChurnRate(totalCustomersAtStart, churnedCustomersCount);
        calculationMethod = 'traditional';
      } else if (newCustomersInPeriod > 0) {
        // For new businesses: churned new customers / new customers acquired
        churnRate = Math.round((churnedNewCustomers / newCustomersInPeriod) * 100 * 100) / 100;
        calculationMethod = 'new_business';
      } else {
        // No customers at all
        churnRate = 0;
        calculationMethod = 'no_customers';
      }
      
      const retentionRate = Math.round((100 - churnRate) * 100) / 100;

      // Group churned subscriptions by reason
      const reasonBreakdown = groupChurnedByReason(churnedSubscriptions);

      // Create plan breakdown for churned subscriptions
      const planMap = new Map<string, {
        planId: string;
        planName?: string;
        churnedCount: number;
        currency: string;
        interval: string;
      }>();

      for (const subscription of churnedSubscriptions) {
        for (const item of subscription.items.data) {
          const planId = item.price.id;
          const existing = planMap.get(planId);
          
          if (existing) {
            existing.churnedCount++;
          } else {
            planMap.set(planId, {
              planId,
              planName: item.price.nickname || undefined,
              churnedCount: 1,
              currency: item.price.currency,
              interval: item.price.recurring ? 
                getBillingIntervalDescription(
                  item.price.recurring.interval,
                  item.price.recurring.interval_count
                ) : 'unknown',
            });
          }
        }
      }

      const planBreakdown = Array.from(planMap.values()).sort((a, b) => b.churnedCount - a.churnedCount);

      const result = {
        churnRate,
        churnedCustomersCount,
        totalCustomersAtStart,
        newCustomersInPeriod,
        churnedNewCustomers,
        churnedSubscriptionsCount: churnedSubscriptions.length,
        reasonBreakdown,
        planBreakdown,
        period: {
          startDate: periodStartDate.toISOString(),
          endDate: periodEndDate.toISOString(),
          days: periodDays,
        },
        retentionRate,
        calculatedAt: new Date().toISOString(),
        explanation: calculationMethod === 'traditional' 
          ? `Churn rate calculated as ${churnedCustomersCount} churned customers ÷ ${totalCustomersAtStart} total customers at start × 100 = ${churnRate}%. ` +
            `Analysis period: ${periodDays} days (${periodStartDate.toLocaleDateString()} to ${periodEndDate.toLocaleDateString()}). ` +
            `${newCustomersInPeriod} new customers acquired, ${churnedNewCustomers} of them churned. ` +
            `${churnedSubscriptions.length} total subscriptions canceled. Retention rate: ${retentionRate}%. ` +
            `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`
          : calculationMethod === 'new_business'
          ? `New business churn rate: ${churnedNewCustomers} churned new customers ÷ ${newCustomersInPeriod} new customers acquired × 100 = ${churnRate}%. ` +
            `No customers existed at period start (${periodStartDate.toLocaleDateString()}). ` +
            `Analysis period: ${periodDays} days. ${churnedSubscriptions.length} subscriptions canceled. ` +
            `This represents early-stage churn for customers acquired and lost within the same period. ` +
            `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`
          : `No churn rate calculated: No customers at start of period and no new customers acquired. ` +
            `Analysis period: ${periodDays} days (${periodStartDate.toLocaleDateString()} to ${periodEndDate.toLocaleDateString()}). ` +
            `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`,
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate churn rate: ${errorMessage}`);
    }
  },
});