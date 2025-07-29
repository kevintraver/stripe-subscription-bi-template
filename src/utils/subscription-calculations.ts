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

/**
 * Groups subscriptions by status and counts them
 */
export function groupSubscriptionsByStatus(subscriptions: StripeSubscription[]): Record<string, number> {
  const statusCounts: Record<string, number> = {};
  
  for (const subscription of subscriptions) {
    const status = subscription.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  
  return statusCounts;
}

/**
 * Counts active subscriptions based on criteria
 */
export function countActiveSubscriptions(
  subscriptions: StripeSubscription[],
  includeTrialSubscriptions: boolean = false
): number {
  return subscriptions.filter(sub => 
    isSubscriptionActiveForMRR(sub, includeTrialSubscriptions)
  ).length;
}

/**
 * Gets subscription growth metrics
 */
export function calculateSubscriptionGrowthMetrics(
  subscriptions: StripeSubscription[],
  daysBack: number = 30
): {
  newSubscriptions: number;
  existingSubscriptions: number;
  growthRate: number;
} {
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);
  
  let newSubscriptions = 0;
  let existingSubscriptions = 0;
  
  for (const subscription of subscriptions) {
    if (subscription.created >= cutoffTimestamp) {
      newSubscriptions++;
    } else {
      existingSubscriptions++;
    }
  }
  
  const previousTotal = existingSubscriptions;
  const growthRate = previousTotal > 0 
    ? Math.round(((newSubscriptions / previousTotal) * 100) * 100) / 100 
    : 0;
  
  return {
    newSubscriptions,
    existingSubscriptions,
    growthRate,
  };
}

/**
 * Identifies churned customers in a given period
 */
export function identifyChurnedCustomers(
  subscriptions: StripeSubscription[],
  periodStartTimestamp: number,
  periodEndTimestamp: number
): {
  churnedCustomers: Set<string>;
  churnedSubscriptions: StripeSubscription[];
} {
  const churnedCustomers = new Set<string>();
  const churnedSubscriptions: StripeSubscription[] = [];
  
  for (const subscription of subscriptions) {
    // Check if subscription was canceled in the period
    if (subscription.status === 'canceled' && 
        subscription.canceled_at && 
        subscription.canceled_at >= periodStartTimestamp && 
        subscription.canceled_at <= periodEndTimestamp) {
      churnedCustomers.add(subscription.customer);
      churnedSubscriptions.push(subscription);
    }
  }
  
  return {
    churnedCustomers,
    churnedSubscriptions,
  };
}

/**
 * Calculates customer churn rate
 */
export function calculateChurnRate(
  totalCustomersAtStart: number,
  churnedCustomersCount: number
): number {
  if (totalCustomersAtStart === 0) {
    return 0;
  }
  
  const churnRate = (churnedCustomersCount / totalCustomersAtStart) * 100;
  return Math.round(churnRate * 100) / 100; // Round to 2 decimal places
}

/**
 * Groups churned subscriptions by cancellation reason
 */
export function groupChurnedByReason(
  churnedSubscriptions: StripeSubscription[]
): Record<string, number> {
  const reasonCounts: Record<string, number> = {};
  
  for (const subscription of churnedSubscriptions) {
    // Stripe doesn't always provide cancellation reasons, so we'll categorize by status and other factors
    let reason = 'unknown';
    
    if (subscription.cancel_at_period_end) {
      reason = 'scheduled_cancellation';
    } else if (subscription.status === 'canceled') {
      reason = 'immediate_cancellation';
    }
    
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  
  return reasonCounts;
}