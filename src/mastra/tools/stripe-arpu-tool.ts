import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  calculateSubscriptionMRR,
  calculateUniqueCustomerCount,
  calculateARPU,
  isSubscriptionActiveForMRR,
  getBillingIntervalDescription,
} from '../../utils/subscription-calculations.js';
import type { StripeSubscription } from '../../types/subscription-types.js';

// Input schema that includes both calculation parameters and subscription data
const ARPUCalculationInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  subscriptions: z
    .array(z.any())
    .describe('Array of Stripe subscription objects to calculate ARPU from'),
});

// Output schema
const ARPUCalculationOutputSchema = z.object({
  arpu: z.number().describe('Average Revenue Per User in currency base units (e.g., dollars)'),
  totalMRR: z.number().describe('Total Monthly Recurring Revenue in currency base units (e.g., dollars)'),
  uniqueCustomers: z.number().describe('Number of unique customers included'),
  currency: z.string().describe('Primary currency for the calculation'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  breakdown: z
    .array(
      z.object({
        customerId: z.string(),
        subscriptionId: z.string(),
        customerMRR: z.number(),
        planName: z.string().optional(),
        billingInterval: z.string(),
      })
    )
    .describe('Detailed breakdown of MRR by customer and subscription'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the calculation methodology'),
});

export const stripeARPUTool = createTool({
  id: 'stripe-arpu-tool',
  description: 'Calculate Average Revenue Per User (ARPU) from provided Stripe subscription data, based on Monthly Recurring Revenue divided by number of unique customers. This tool performs the calculation logic - subscription data should be provided by the agent using Stripe MCP tools.',
  inputSchema: ARPUCalculationInputSchema,
  outputSchema: ARPUCalculationOutputSchema,

  execute: async ({ context }) => {
    const { includeTrialSubscriptions = false, currency, subscriptions } = context;
    
    try {
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error('No subscription data provided. This tool requires subscription data to be passed in the subscriptions parameter.');
      }

      // Cast subscriptions to the correct type
      const typedSubscriptions = subscriptions as StripeSubscription[];

      // Filter active subscriptions
      const activeSubscriptions = typedSubscriptions.filter(sub => 
        isSubscriptionActiveForMRR(sub, includeTrialSubscriptions)
      );

      // Filter by currency if specified
      const filteredSubscriptions = currency 
        ? activeSubscriptions.filter(sub => 
            sub.items.data.some(item => item.price.currency === currency.toLowerCase())
          )
        : activeSubscriptions;

      // Calculate MRR for each subscription and build breakdown
      let totalMRR = 0;
      const breakdown = [];
      const primaryCurrency = currency || 'usd'; // Default to USD if not specified

      for (const subscription of filteredSubscriptions) {
        const subscriptionMRR = calculateSubscriptionMRR(subscription);
        totalMRR += subscriptionMRR;

        // Get billing interval for display
        const firstItem = subscription.items.data[0];
        const billingInterval = firstItem?.price?.recurring 
          ? getBillingIntervalDescription(
              firstItem.price.recurring.interval,
              firstItem.price.recurring.interval_count
            )
          : 'unknown';

        breakdown.push({
          customerId: subscription.customer,
          subscriptionId: subscription.id,
          customerMRR: subscriptionMRR,
          billingInterval,
        });
      }

      // Calculate unique customer count
      const uniqueCustomers = calculateUniqueCustomerCount(filteredSubscriptions);

      // Calculate ARPU
      const arpu = calculateARPU(totalMRR, uniqueCustomers);

      // Round total MRR to 2 decimal places
      totalMRR = Math.round(totalMRR * 100) / 100;

      const result = {
        arpu,
        totalMRR,
        uniqueCustomers,
        currency: primaryCurrency,
        activeSubscriptions: filteredSubscriptions.length,
        breakdown,
        calculatedAt: new Date().toISOString(),
        explanation: `ARPU calculated by dividing total MRR ($${totalMRR}) by ${uniqueCustomers} unique customers. ` +
          `Based on ${filteredSubscriptions.length} active subscriptions. ` +
          `Billing periods normalized to monthly: daily rates multiplied by 30.44, ` +
          `weekly by 4.33, yearly divided by 12. ` +
          `${includeTrialSubscriptions ? 'Trial subscriptions included. ' : 'Trial subscriptions excluded. '}` +
          `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`,
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate ARPU: ${errorMessage}`);
    }
  },
});