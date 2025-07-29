import { describe, it, expect } from 'vitest';
import {
  normalizeBillingPeriodToMonthly,
  isSubscriptionActiveForMRR,
  calculateSubscriptionMRR,
  getBillingIntervalDescription,
  calculateUniqueCustomerCount,
  calculateARPU,
} from '../../src/utils/subscription-calculations.js';
import type { StripeSubscription } from '../../src/types/subscription-types.js';

describe('normalizeBillingPeriodToMonthly', () => {
  it('should handle daily billing correctly', () => {
    const result = normalizeBillingPeriodToMonthly(100, 'day', 1);
    expect(result.normalizedMonthlyAmount).toBe(3044); // 100 * 30.44
    expect(result.originalAmount).toBe(100);
    expect(result.originalInterval).toBe('day');
    expect(result.originalIntervalCount).toBe(1);
  });

  it('should handle weekly billing correctly', () => {
    const result = normalizeBillingPeriodToMonthly(100, 'week', 1);
    expect(result.normalizedMonthlyAmount).toBe(433); // 100 * 4.33
  });

  it('should handle monthly billing correctly', () => {
    const result = normalizeBillingPeriodToMonthly(100, 'month', 1);
    expect(result.normalizedMonthlyAmount).toBe(100); // No conversion needed
  });

  it('should handle yearly billing correctly', () => {
    const result = normalizeBillingPeriodToMonthly(1200, 'year', 1);
    expect(result.normalizedMonthlyAmount).toBe(100); // 1200 / 12
  });

  it('should handle custom interval counts', () => {
    const result = normalizeBillingPeriodToMonthly(600, 'month', 3);
    expect(result.normalizedMonthlyAmount).toBe(200); // 600 / 3
  });

  it('should throw error for unsupported interval', () => {
    expect(() => {
      normalizeBillingPeriodToMonthly(100, 'hour' as any, 1);
    }).toThrow('Unsupported billing interval: hour');
  });

  it('should round results to 2 decimal places', () => {
    const result = normalizeBillingPeriodToMonthly(333, 'day', 1);
    expect(result.normalizedMonthlyAmount).toBe(10136.52); // Properly rounded
  });
});

describe('isSubscriptionActiveForMRR', () => {
  const createMockSubscription = (status: string): StripeSubscription => ({
    id: 'sub_1',
    status: status as any,
    customer: 'cus_1',
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: 1640995200,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    items: { data: [] },
  });

  it('should consider active subscriptions as active', () => {
    const subscription = createMockSubscription('active');
    expect(isSubscriptionActiveForMRR(subscription)).toBe(true);
  });

  it('should consider past_due subscriptions as active', () => {
    const subscription = createMockSubscription('past_due');
    expect(isSubscriptionActiveForMRR(subscription)).toBe(true);
  });

  it('should not consider canceled subscriptions as active', () => {
    const subscription = createMockSubscription('canceled');
    expect(isSubscriptionActiveForMRR(subscription)).toBe(false);
  });

  it('should not consider trialing subscriptions as active by default', () => {
    const subscription = createMockSubscription('trialing');
    expect(isSubscriptionActiveForMRR(subscription)).toBe(false);
  });

  it('should consider trialing subscriptions as active when flag is true', () => {
    const subscription = createMockSubscription('trialing');
    expect(isSubscriptionActiveForMRR(subscription, true)).toBe(true);
  });

  it('should not consider incomplete subscriptions as active', () => {
    const subscription = createMockSubscription('incomplete');
    expect(isSubscriptionActiveForMRR(subscription)).toBe(false);
  });
});

describe('calculateSubscriptionMRR', () => {
  const createMockSubscription = (items: any[]): StripeSubscription => ({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: 1640995200,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    items: { data: items },
  });

  it('should calculate MRR for monthly subscription', () => {
    const subscription = createMockSubscription([
      {
        id: 'si_1',
        price: {
          id: 'price_1',
          unit_amount: 2000,
          currency: 'usd',
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ]);

    const mrr = calculateSubscriptionMRR(subscription);
    expect(mrr).toBe(20); // $20.00
  });

  it('should calculate MRR for yearly subscription', () => {
    const subscription = createMockSubscription([
      {
        id: 'si_1',
        price: {
          id: 'price_1',
          unit_amount: 24000, // $240.00 per year
          currency: 'usd',
          recurring: {
            interval: 'year',
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ]);

    const mrr = calculateSubscriptionMRR(subscription);
    expect(mrr).toBe(20); // $240 / 12 = $20
  });

  it('should handle multiple items in a subscription', () => {
    const subscription = createMockSubscription([
      {
        id: 'si_1',
        price: {
          id: 'price_1',
          unit_amount: 1000,
          currency: 'usd',
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 2,
      },
      {
        id: 'si_2',
        price: {
          id: 'price_2',
          unit_amount: 500,
          currency: 'usd',
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ]);

    const mrr = calculateSubscriptionMRR(subscription);
    expect(mrr).toBe(25); // (10 * 2) + (5 * 1) = $25
  });

  it('should skip items without unit_amount', () => {
    const subscription = createMockSubscription([
      {
        id: 'si_1',
        price: {
          id: 'price_1',
          unit_amount: null,
          currency: 'usd',
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ]);

    const mrr = calculateSubscriptionMRR(subscription);
    expect(mrr).toBe(0);
  });

  it('should skip items without recurring pricing', () => {
    const subscription = createMockSubscription([
      {
        id: 'si_1',
        price: {
          id: 'price_1',
          unit_amount: 1000,
          currency: 'usd',
          recurring: null,
        },
        quantity: 1,
      },
    ]);

    const mrr = calculateSubscriptionMRR(subscription);
    expect(mrr).toBe(0);
  });
});

describe('getBillingIntervalDescription', () => {
  it('should return simple interval for count of 1', () => {
    expect(getBillingIntervalDescription('month', 1)).toBe('month');
    expect(getBillingIntervalDescription('year', 1)).toBe('year');
  });

  it('should return compound description for count > 1', () => {
    expect(getBillingIntervalDescription('month', 3)).toBe('3-month');
    expect(getBillingIntervalDescription('week', 2)).toBe('2-week');
  });

  it('should handle missing interval count', () => {
    expect(getBillingIntervalDescription('month')).toBe('month');
  });
});

describe('calculateUniqueCustomerCount', () => {
  const createMockSubscription = (customerId: string): StripeSubscription => ({
    id: `sub_${customerId}`,
    status: 'active',
    customer: customerId,
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: 1640995200,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    items: { data: [] },
  });

  it('should count unique customers correctly', () => {
    const subscriptions = [
      createMockSubscription('cus_1'),
      createMockSubscription('cus_2'),
      createMockSubscription('cus_3'),
    ];
    
    expect(calculateUniqueCustomerCount(subscriptions)).toBe(3);
  });

  it('should handle duplicate customers correctly', () => {
    const subscriptions = [
      createMockSubscription('cus_1'),
      createMockSubscription('cus_1'), // Duplicate customer
      createMockSubscription('cus_2'),
    ];
    
    expect(calculateUniqueCustomerCount(subscriptions)).toBe(2);
  });

  it('should handle empty subscription array', () => {
    expect(calculateUniqueCustomerCount([])).toBe(0);
  });

  it('should handle subscriptions without customer field', () => {
    const subscriptionWithoutCustomer = {
      ...createMockSubscription('cus_1'),
      customer: undefined as any,
    };
    
    const subscriptions = [
      subscriptionWithoutCustomer,
      createMockSubscription('cus_2'),
    ];
    
    expect(calculateUniqueCustomerCount(subscriptions)).toBe(1);
  });
});

describe('calculateARPU', () => {
  it('should calculate ARPU correctly', () => {
    const totalMRR = 100;
    const customerCount = 4;
    
    expect(calculateARPU(totalMRR, customerCount)).toBe(25);
  });

  it('should handle zero customers gracefully', () => {
    const totalMRR = 100;
    const customerCount = 0;
    
    expect(calculateARPU(totalMRR, customerCount)).toBe(0);
  });

  it('should round result to 2 decimal places', () => {
    const totalMRR = 100;
    const customerCount = 3;
    
    expect(calculateARPU(totalMRR, customerCount)).toBe(33.33); // 100/3 = 33.333...
  });

  it('should handle zero MRR', () => {
    const totalMRR = 0;
    const customerCount = 5;
    
    expect(calculateARPU(totalMRR, customerCount)).toBe(0);
  });
});