import { describe, it, expect } from 'vitest';
import { stripeActiveSubscribersTool } from '../../../src/mastra/tools/stripe-active-subscribers-tool.js';
import type { StripeSubscription } from '../../../src/types/subscription-types.js';

describe('stripeActiveSubscribersTool', () => {
  const createMockSubscription = (
    id: string,
    customerId: string,
    status: string,
    daysAgo: number,
    unitAmount: number = 2000,
    currency: string = 'usd'
  ): StripeSubscription => {
    const createdTimestamp = Math.floor(Date.now() / 1000) - (daysAgo * 24 * 60 * 60);
    
    return {
      id,
      status: status as any,
      customer: customerId,
      current_period_start: createdTimestamp,
      current_period_end: createdTimestamp + (30 * 24 * 60 * 60),
      created: createdTimestamp,
      cancel_at_period_end: false,
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

  it('should analyze active subscribers correctly', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 5),
      createMockSubscription('2', 'cus_2', 'active', 15),
      createMockSubscription('3', 'cus_3', 'past_due', 45),
      createMockSubscription('4', 'cus_4', 'canceled', 60),
      createMockSubscription('5', 'cus_5', 'trialing', 10),
    ];

    const result = await stripeActiveSubscribersTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.totalActiveSubscriptions).toBe(3); // active + past_due
    expect(result.uniqueActiveCustomers).toBe(3);
    expect(result.statusBreakdown).toEqual({
      active: 2,
      past_due: 1,
      canceled: 1,
      trialing: 1,
    });
  });

  it('should calculate growth metrics correctly', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 5),   // New
      createMockSubscription('2', 'cus_2', 'active', 15),  // New
      createMockSubscription('3', 'cus_3', 'active', 45),  // Existing
      createMockSubscription('4', 'cus_4', 'active', 60),  // Existing
    ];

    const result = await stripeActiveSubscribersTool.execute({
      context: { subscriptions, growthPeriodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.growth.newSubscriptions).toBe(2);
    expect(result.growth.existingSubscriptions).toBe(2);
    expect(result.growth.growthRate).toBe(100); // 2/2 * 100
    expect(result.growth.periodDays).toBe(30);
  });

  it('should handle trial subscriptions based on flag', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 5),
      createMockSubscription('2', 'cus_2', 'trialing', 10),
    ];

    // Without trial subscriptions
    const resultWithoutTrials = await stripeActiveSubscribersTool.execute({
      context: { subscriptions, includeTrialSubscriptions: false },
      runtimeContext: {} as any,
    });

    expect(resultWithoutTrials.totalActiveSubscriptions).toBe(1);
    expect(resultWithoutTrials.uniqueActiveCustomers).toBe(1);

    // With trial subscriptions
    const resultWithTrials = await stripeActiveSubscribersTool.execute({
      context: { subscriptions, includeTrialSubscriptions: true },
      runtimeContext: {} as any,
    });

    expect(resultWithTrials.totalActiveSubscriptions).toBe(2);
    expect(resultWithTrials.uniqueActiveCustomers).toBe(2);
  });

  it('should create plan breakdown correctly', async () => {
    const subscriptions = [
      {
        ...createMockSubscription('1', 'cus_1', 'active', 5, 2000),
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
                  interval: 'month',
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      },
      {
        ...createMockSubscription('2', 'cus_2', 'active', 10, 2000),
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
                  interval: 'month',
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      },
      {
        ...createMockSubscription('3', 'cus_3', 'active', 15, 3000),
        items: {
          data: [
            {
              id: 'si_3',
              price: {
                id: 'price_pro',
                nickname: 'Pro Plan',
                unit_amount: 3000,
                currency: 'usd',
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      },
    ];

    const result = await stripeActiveSubscribersTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.planBreakdown).toHaveLength(2);
    expect(result.planBreakdown[0]).toMatchObject({
      planId: 'price_basic',
      planName: 'Basic Plan',
      count: 2,
      currency: 'usd',
      interval: 'month',
    });
    expect(result.planBreakdown[1]).toMatchObject({
      planId: 'price_pro',
      planName: 'Pro Plan',
      count: 1,
      currency: 'usd',
      interval: 'month',
    });
  });

  it('should filter by currency when specified', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 5, 2000, 'usd'),
      createMockSubscription('2', 'cus_2', 'active', 10, 3000, 'eur'),
    ];

    const result = await stripeActiveSubscribersTool.execute({
      context: { subscriptions, currency: 'usd' },
      runtimeContext: {} as any,
    });

    expect(result.totalActiveSubscriptions).toBe(1);
    expect(result.statusBreakdown).toEqual({
      active: 1,
    });
  });

  it('should handle duplicate customers correctly', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 'active', 5),
      createMockSubscription('2', 'cus_1', 'active', 10), // Same customer
      createMockSubscription('3', 'cus_2', 'active', 15),
    ];

    const result = await stripeActiveSubscribersTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.totalActiveSubscriptions).toBe(3);
    expect(result.uniqueActiveCustomers).toBe(2); // Only 2 unique customers
  });

  it('should throw error when no subscriptions provided', async () => {
    await expect(
      stripeActiveSubscribersTool.execute({
        context: { subscriptions: [] },
        runtimeContext: {} as any,
      })
    ).rejects.toThrow('No subscription data provided');
  });
});