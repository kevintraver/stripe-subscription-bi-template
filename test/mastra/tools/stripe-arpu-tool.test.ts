import { describe, it, expect } from 'vitest';
import { stripeARPUTool } from '../../../src/mastra/tools/stripe-arpu-tool.js';
import type { StripeSubscription } from '../../../src/types/subscription-types.js';

describe('stripeARPUTool', () => {
  const createMockSubscription = (
    id: string,
    customerId: string,
    unitAmount: number,
    interval: 'month' | 'year' = 'month',
    status: string = 'active'
  ): StripeSubscription => ({
    id,
    status: status as any,
    customer: customerId,
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: 1640995200,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    items: {
      data: [
        {
          id: `si_${id}`,
          price: {
            id: `price_${id}`,
            unit_amount: unitAmount,
            currency: 'usd',
            recurring: {
              interval,
              interval_count: 1,
            },
          },
          quantity: 1,
        },
      ],
    },
  });

  it('should calculate ARPU correctly for multiple customers', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month
      createMockSubscription('2', 'cus_2', 3000), // $30/month
      createMockSubscription('3', 'cus_3', 1000), // $10/month
    ];

    const result = await stripeARPUTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.arpu).toBe(20); // (20 + 30 + 10) / 3 = $20
    expect(result.totalMRR).toBe(60);
    expect(result.uniqueCustomers).toBe(3);
    expect(result.activeSubscriptions).toBe(3);
  });

  it('should handle duplicate customers correctly', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month
      createMockSubscription('2', 'cus_1', 1000), // $10/month (same customer)
      createMockSubscription('3', 'cus_2', 3000), // $30/month
    ];

    const result = await stripeARPUTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.arpu).toBe(30); // (20 + 10 + 30) / 2 = $30 (2 unique customers)
    expect(result.totalMRR).toBe(60);
    expect(result.uniqueCustomers).toBe(2);
    expect(result.activeSubscriptions).toBe(3);
  });

  it('should filter by currency when specified', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // USD subscription
      {
        ...createMockSubscription('2', 'cus_2', 3000),
        items: {
          data: [
            {
              id: 'si_2',
              price: {
                id: 'price_2',
                unit_amount: 3000,
                currency: 'eur', // EUR subscription
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                },
              },
              quantity: 1,
            },
          ],
        },
      } as StripeSubscription,
    ];

    const result = await stripeARPUTool.execute({
      context: { subscriptions, currency: 'usd' },
      runtimeContext: {} as any,
    });

    expect(result.arpu).toBe(20); // Only USD subscription
    expect(result.totalMRR).toBe(20);
    expect(result.uniqueCustomers).toBe(1);
  });

  it('should handle trial subscriptions based on flag', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000, 'month', 'active'),
      createMockSubscription('2', 'cus_2', 3000, 'month', 'trialing'),
    ];

    // Without trial subscriptions
    const resultWithoutTrials = await stripeARPUTool.execute({
      context: { subscriptions, includeTrialSubscriptions: false },
      runtimeContext: {} as any,
    });

    expect(resultWithoutTrials.arpu).toBe(20);
    expect(resultWithoutTrials.uniqueCustomers).toBe(1);

    // With trial subscriptions
    const resultWithTrials = await stripeARPUTool.execute({
      context: { subscriptions, includeTrialSubscriptions: true },
      runtimeContext: {} as any,
    });

    expect(resultWithTrials.arpu).toBe(25); // (20 + 30) / 2
    expect(resultWithTrials.uniqueCustomers).toBe(2);
  });

  it('should return zero ARPU when no active customers', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000, 'month', 'canceled'),
    ];

    const result = await stripeARPUTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.arpu).toBe(0);
    expect(result.totalMRR).toBe(0);
    expect(result.uniqueCustomers).toBe(0);
  });

  it('should throw error when no subscriptions provided', async () => {
    await expect(
      stripeARPUTool.execute({
        context: { subscriptions: [] },
        runtimeContext: {} as any,
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should include detailed breakdown', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000),
      createMockSubscription('2', 'cus_2', 3000),
    ];

    const result = await stripeARPUTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toMatchObject({
      customerId: 'cus_1',
      subscriptionId: '1',
      customerMRR: 20,
      billingInterval: 'month',
    });
    expect(result.breakdown[1]).toMatchObject({
      customerId: 'cus_2',
      subscriptionId: '2',
      customerMRR: 30,
      billingInterval: 'month',
    });
  });
});