import type { StripeSubscription, BillingPeriodNormalization } from '../types/subscription-types.js';

/**
 * Normalizes a billing amount to monthly recurring revenue
 * Converts daily, weekly, and yearly billing to monthly equivalent
 */
export function normalizeBillingPeriodToMonthly(
  amount: number,
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number = 1
): BillingPeriodNormalization {
  let normalizedMonthlyAmount: number;

  switch (interval) {
    case 'day':
      // Daily amount × days per month (30.44 average)
      normalizedMonthlyAmount = (amount / intervalCount) * 30.44;
      break;
    case 'week':
      // Weekly amount × weeks per month (4.33 average)
      normalizedMonthlyAmount = (amount / intervalCount) * 4.33;
      break;
    case 'month':
      // Monthly amount (no conversion needed)
      normalizedMonthlyAmount = amount / intervalCount;
      break;
    case 'year':
      // Yearly amount ÷ 12 months
      normalizedMonthlyAmount = amount / (intervalCount * 12);
      break;
    default:
      throw new Error(`Unsupported billing interval: ${interval}`);
  }

  return {
    originalAmount: amount,
    originalInterval: interval,
    originalIntervalCount: intervalCount,
    normalizedMonthlyAmount: Math.round(normalizedMonthlyAmount * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Determines if a subscription should be considered active for MRR calculation
 */
export function isSubscriptionActiveForMRR(
  subscription: StripeSubscription,
  includeTrialSubscriptions: boolean = false
): boolean {
  const activeStatuses = ['active', 'past_due'];
  
  if (includeTrialSubscriptions) {
    activeStatuses.push('trialing');
  }

  return activeStatuses.includes(subscription.status);
}

/**
 * Calculates MRR for a single subscription
 * Note: Stripe amounts are in cents, so we convert to dollars
 */
export function calculateSubscriptionMRR(subscription: StripeSubscription): number {
  let totalMRR = 0;

  for (const item of subscription.items.data) {
    if (!item.price.unit_amount || !item.price.recurring) {
      continue; // Skip one-time charges or items without pricing
    }

    // Convert from cents to dollars
    const itemAmountInDollars = (item.price.unit_amount * item.quantity) / 100;
    const normalization = normalizeBillingPeriodToMonthly(
      itemAmountInDollars,
      item.price.recurring.interval,
      item.price.recurring.interval_count
    );

    totalMRR += normalization.normalizedMonthlyAmount;
  }

  return Math.round(totalMRR * 100) / 100; // Round to 2 decimal places
}

/**
 * Gets a human-readable description of the billing interval
 */
export function getBillingIntervalDescription(
  interval: string,
  intervalCount: number = 1
): string {
  if (intervalCount === 1) {
    return interval;
  }
  return `${intervalCount}-${interval}`;
}

/**
 * Counts unique customers from a list of subscriptions
 */
export function calculateUniqueCustomerCount(subscriptions: StripeSubscription[]): number {
  const uniqueCustomers = new Set<string>();
  
  for (const subscription of subscriptions) {
    if (subscription.customer) {
      uniqueCustomers.add(subscription.customer);
    }
  }
  
  return uniqueCustomers.size;
}

/**
 * Calculates ARPU (Average Revenue Per User) from MRR and customer count
 */
export function calculateARPU(totalMRR: number, customerCount: number): number {
  if (customerCount === 0) {
    return 0;
  }
  
  return Math.round((totalMRR / customerCount) * 100) / 100; // Round to 2 decimal places
}