import { describe, it, expect } from 'vitest';
import { stripeChurnRateTool } from '../../../src/mastra/tools/stripe-churn-rate-tool.js';
import type { StripeSubscription } from '../../../src/types/subscription-types.js';

describe('stripeChurnRateTool', () => {
  const createMockSubscription = (
    id: string,
    customerId: string,
    status: string,
    createdDaysAgo: number,
    canceledDaysAgo?: number,
    unitAmount: number = 2000,
    currency: string = 'usd'
  ): StripeSubscription => {
    const now = Math.floor(Date.now() / 1000);
    const created = now - (createdDaysAgo * 24 * 60 * 60);
    const canceledAt = canceledDaysAgo !== undefined 
      ? now - (canceledDaysAgo * 24 * 60 * 60)
      : undefined;
    
    return {
      id,
      status: status as any,
      customer: customerId,
      current_period_start: created,
      current_period_end: created + (30 * 24 * 60 * 60),
      created,
      cancel_at_period_end: false,
      canceled_at: canceledAt,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            id: `si_${id}`,
            price: {
              id: `price_${id}`,
              nickname: `Plan ${id}`,
              unit_amount: unitAmount,
              currency,
              recurring: {
                interval: 'month',
                interval_count: 1,
              },
            },
            quantity: 1,
          },
        ],
      },
    };
  };

  it('should calculate churn rate correctly', async () => {
    const subscriptions = [
      // Customers at start (created before 30 days ago)
      createMockSubscription('1', 'cus_1', 'active', 60),
      createMockSubscription('2', 'cus_2', 'canceled', 60, 10), // Churned in period
      createMockSubscription('3', 'cus_3', 'canceled', 60, 25), // Churned in period
      createMockSubscription('4', 'cus_4', 'active', 60),
      createMockSubscription('5', 'cus_5', 'active', 60),
      // New customer (created within period - not counted in start total)
      createMockSubscription('6', 'cus_6', 'active', 15),
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.totalCustomersAtStart).toBe(5); // cus_1 through cus_5
    expect(result.churnedCustomersCount).toBe(2); // cus_2 and cus_3
    expect(result.churnRate).toBe(40); // 2/5 * 100 = 40%
    expect(result.retentionRate).toBe(60); // 100 - 40 = 60%
    expect(result.newCustomersInPeriod).toBe(1); // cus_6
    expect(result.churnedNewCustomers).toBe(0); // none of the new customers churned
  });

  it('should handle zero churn', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 60),
      createMockSubscription('2', 'cus_2', 'active', 60),
      createMockSubscription('3', 'cus_3', 'active', 60),
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.churnRate).toBe(0);
    expect(result.retentionRate).toBe(100);
    expect(result.churnedCustomersCount).toBe(0);
  });

  it('should filter by currency when specified', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 60, undefined, 2000, 'usd'),
      createMockSubscription('2', 'cus_2', 'canceled', 60, 10, 2000, 'usd'), // USD churned
      createMockSubscription('3', 'cus_3', 'canceled', 60, 10, 3000, 'eur'), // EUR churned (filtered out)
      createMockSubscription('4', 'cus_4', 'active', 60, undefined, 3000, 'eur'), // EUR active (filtered out)
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, currency: 'usd', periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.totalCustomersAtStart).toBe(2); // cus_1 and cus_2 (USD only)
    expect(result.churnedCustomersCount).toBe(1); // Only cus_2 churned
    expect(result.churnRate).toBe(50); // 1/2 * 100
  });

  it('should group churned subscriptions by reason', async () => {
    const subscriptions = [
      {
        ...createMockSubscription('1', 'cus_1', 'canceled', 60, 10),
        cancel_at_period_end: true, // Scheduled cancellation
      },
      {
        ...createMockSubscription('2', 'cus_2', 'canceled', 60, 15),
        cancel_at_period_end: false, // Immediate cancellation
      },
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.reasonBreakdown).toEqual({
      scheduled_cancellation: 1,
      immediate_cancellation: 1,
    });
  });

  it('should create plan breakdown for churned subscriptions', async () => {
    const subscriptions = [
      {
        ...createMockSubscription('1', 'cus_1', 'canceled', 60, 10, 2000),
        items: {
          data: [
            {
              id: 'si_1',
              price: {
                id: 'price_basic',
                nickname: 'Basic Plan',
                unit_amount: 2000,
                currency: 'usd',
                recurring: {
                  interval: 'month' as const,
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      },
      {
        ...createMockSubscription('2', 'cus_2', 'canceled', 60, 15, 2000),
        items: {
          data: [
            {
              id: 'si_2',
              price: {
                id: 'price_basic',
                nickname: 'Basic Plan',
                unit_amount: 2000,
                currency: 'usd',
                recurring: {
                  interval: 'month' as const,
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      },
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.planBreakdown).toHaveLength(1);
    expect(result.planBreakdown[0]).toMatchObject({
      planId: 'price_basic',
      planName: 'Basic Plan',
      churnedCount: 2,
      currency: 'usd',
      interval: 'month',
    });
  });

  it('should handle no customers at start', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 10), // Created within period
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.totalCustomersAtStart).toBe(0);
    expect(result.churnRate).toBe(0);
    expect(result.retentionRate).toBe(100);
    expect(result.newCustomersInPeriod).toBe(1);
  });

  it('should calculate new business churn rate', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 10), // New, still active
      createMockSubscription('2', 'cus_2', 'canceled', 15, 5), // New, churned
      createMockSubscription('3', 'cus_3', 'active', 20), // New, still active
    ];

    const result = await stripeChurnRateTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.totalCustomersAtStart).toBe(0); // No customers before period
    expect(result.newCustomersInPeriod).toBe(3); // All 3 are new
    expect(result.churnedNewCustomers).toBe(1); // cus_2 churned
    expect(result.churnRate).toBe(33.33); // 1/3 * 100
    expect(result.explanation).toContain('New business churn rate');
  });

  it('should throw error when no subscriptions provided', async () => {
    await expect(
      stripeChurnRateTool.execute({
        context: { subscriptions: [] },
        runtimeContext: {} as any,
      })
    ).rejects.toThrow('No subscription data provided');
  });
});