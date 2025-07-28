import { describe, it, expect } from 'vitest';
import { stripeMRRTool } from '../../../src/mastra/tools/stripe-mrr-tool.js';

describe('stripeMRRTool', () => {

  const mockSubscriptions = [
    {
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      current_period_start: 1640995200,
      current_period_end: 1643673600,
      created: 1640995200,
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            id: 'si_1',
            price: {
              id: 'price_1',
              unit_amount: 2000, // $20.00
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
      id: 'sub_2',
      status: 'active',
      customer: 'cus_2',
      current_period_start: 1640995200,
      current_period_end: 1672531200,
      created: 1640995200,
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            id: 'si_2',
            price: {
              id: 'price_2',
              unit_amount: 24000, // $240.00
              currency: 'usd',
              recurring: {
                interval: 'year',
                interval_count: 1,
              },
            },
            quantity: 1,
          },
        ],
      },
    },
    {
      id: 'sub_3',
      status: 'trialing',
      customer: 'cus_3',
      current_period_start: 1640995200,
      current_period_end: 1643673600,
      created: 1640995200,
      cancel_at_period_end: false,
      trial_start: 1640995200,
      trial_end: 1641600000,
      items: {
        data: [
          {
            id: 'si_3',
            price: {
              id: 'price_3',
              unit_amount: 1000, // $10.00
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
      id: 'sub_4',
      status: 'canceled',
      customer: 'cus_4',
      current_period_start: 1640995200,
      current_period_end: 1643673600,
      created: 1640995200,
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            id: 'si_4',
            price: {
              id: 'price_4',
              unit_amount: 1500, // $15.00
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

  it('should calculate MRR correctly for active subscriptions', async () => {
    const result = await stripeMRRTool.execute({
      context: {
        subscriptions: mockSubscriptions,
      },
    });

    expect(result.totalMRR).toBe(40); // $20 (monthly) + $20 (yearly/12) = $40
    expect(result.activeSubscriptions).toBe(2);
    expect(result.currency).toBe('usd');
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].subscriptionId).toBe('sub_1');
    expect(result.breakdown[0].customerMRR).toBe(20);
    expect(result.breakdown[1].subscriptionId).toBe('sub_2');
    expect(result.breakdown[1].customerMRR).toBe(20);
  });

  it('should include trial subscriptions when requested', async () => {
    const result = await stripeMRRTool.execute({
      context: { 
        subscriptions: mockSubscriptions,
        includeTrialSubscriptions: true 
      },
    });

    expect(result.totalMRR).toBe(50); // $20 + $20 + $10 = $50
    expect(result.activeSubscriptions).toBe(3);
    expect(result.breakdown).toHaveLength(3);
  });

  it('should filter by currency when specified', async () => {
    const mockMultiCurrencySubscriptions = [
      ...mockSubscriptions,
      {
        id: 'sub_eur',
        status: 'active',
        customer: 'cus_eur',
        current_period_start: 1640995200,
        current_period_end: 1643673600,
        created: 1640995200,
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        items: {
          data: [
            {
              id: 'si_eur',
              price: {
                id: 'price_eur',
                unit_amount: 1800, // €18.00
                currency: 'eur',
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

    const result = await stripeMRRTool.execute({
      context: { 
        subscriptions: mockMultiCurrencySubscriptions,
        currency: 'eur' 
      },
    });

    expect(result.totalMRR).toBe(18);
    expect(result.activeSubscriptions).toBe(1);
    expect(result.currency).toBe('eur');
  });

  it('should handle empty subscription list', async () => {
    await expect(
      stripeMRRTool.execute({
        context: {
          subscriptions: [],
        },
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should handle missing subscription data', async () => {
    await expect(
      stripeMRRTool.execute({
        context: {},
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should handle invalid subscription data format', async () => {
    await expect(
      stripeMRRTool.execute({
        context: {
          subscriptions: 'invalid-data' as any,
        },
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should include proper explanation in output', async () => {
    const result = await stripeMRRTool.execute({
      context: { 
        subscriptions: mockSubscriptions,
        includeTrialSubscriptions: true, 
        currency: 'usd' 
      },
    });

    expect(result.explanation).toContain('MRR calculated by summing');
    expect(result.explanation).toContain('Trial subscriptions included');
    expect(result.explanation).toContain('Filtered to USD currency');
    expect(result.explanation).toContain('Billing periods normalized to monthly');
  });
});