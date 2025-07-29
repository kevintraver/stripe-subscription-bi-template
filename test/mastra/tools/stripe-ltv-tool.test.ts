import { describe, it, expect } from 'vitest';
import { stripeLTVTool } from '../../../src/mastra/tools/stripe-ltv-tool.js';
import type { StripeSubscription } from '../../../src/types/subscription-types.js';

describe('stripeLTVTool', () => {
  const createMockSubscription = (
    id: string,
    customerId: string,
    unitAmount: number,
    status: string = 'active',
    canceledAt?: number
  ): StripeSubscription => ({
    id,
    status: status as any,
    customer: customerId,
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: 1640995200,
    canceled_at: canceledAt || null,
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
              interval: 'month',
              interval_count: 1,
            },
          },
          quantity: 1,
        },
      ],
    },
  });

  it('should calculate LTV correctly with realistic data', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month active subscription
      createMockSubscription('2', 'cus_2', 3000), // $30/month active subscription
      createMockSubscription('3', 'cus_3', 4000), // $40/month active subscription
      createMockSubscription('4', 'cus_4', 1000, 'canceled', 1643673600), // $10/month churned subscription
    ];

    const result = await stripeLTVTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.ltv).toBeGreaterThan(0);
    expect(result.arpu).toBeGreaterThan(0);
    expect(result.churnRate).toBeGreaterThanOrEqual(0);
    expect(result.retentionRate).toBeGreaterThanOrEqual(0);
    expect(result.monthsToChurn).toBeGreaterThan(0);
    expect(result.currency).toBe('usd');
    expect(result.dependencyResults.arpu).toBeDefined();
    expect(result.dependencyResults.churnRate).toBeDefined();
    expect(result.explanation).toContain('LTV calculated');
  });

  it('should handle zero churn scenario', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000),
      createMockSubscription('2', 'cus_2', 3000),
    ];

    const result = await stripeLTVTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    // With no churned customers, LTV should be very high (capped)
    expect(result.ltv).toBeGreaterThan(1000);
    expect(result.churnRate).toBe(0);
    expect(result.retentionRate).toBe(100);
    expect(result.explanation).toContain('No customer churn detected');
  });

  it('should pass correct parameters to calculate LTV', async () => {
    const subscriptions = [createMockSubscription('1', 'cus_1', 2000)];

    const result = await stripeLTVTool.execute({
      context: {
        subscriptions,
        includeTrialSubscriptions: true,
        churnPeriodDays: 60,
        currency: 'usd',
      },
      runtimeContext: {} as any,
    });

    expect(result.ltv).toBeGreaterThan(0);
    expect(result.currency).toBe('usd');
  });

  it('should throw error when no subscriptions provided', async () => {
    await expect(
      stripeLTVTool.execute({
        context: { subscriptions: [] },
        runtimeContext: {} as any,
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should include comprehensive explanation', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000),
      createMockSubscription('2', 'cus_2', 3000, 'canceled', 1643673600),
    ];

    const result = await stripeLTVTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.explanation).toContain('LTV calculated using formula');
    expect(result.explanation).toContain('ARPU');
    expect(result.explanation).toContain('average total revenue expected');
    expect(result.explanation).toContain('customer lifetime');
  });

  it('should handle currency filtering', async () => {
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

    const result = await stripeLTVTool.execute({
      context: { subscriptions, currency: 'usd' },
      runtimeContext: {} as any,
    });

    expect(result.currency).toBe('usd');
    expect(result.explanation).toContain('Filtered to USD currency only');
  });
});