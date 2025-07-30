import { describe, it, expect } from 'vitest';
import { stripeMRRExpansionTool } from '../../../src/mastra/tools/stripe-mrr-expansion-tool.js';
import type { StripeSubscription } from '../../../src/types/subscription-types.js';

describe('stripeMRRExpansionTool', () => {
  const createMockSubscription = (
    id: string,
    customerId: string,
    unitAmount: number,
    quantity: number = 1,
    status: string = 'active',
    createdTimestamp?: number
  ): StripeSubscription => ({
    id,
    status: status as any,
    customer: customerId,
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    created: createdTimestamp || 1640995200,
    canceled_at: null,
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
            currency: 'usd',
            recurring: {
              interval: 'month',
              interval_count: 1,
            },
          },
          quantity,
        },
      ],
    },
  });

  it('should detect MRR expansion from high-value new subscriptions', async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - (15 * 24 * 60 * 60); // 15 days ago
    
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month regular subscription
      createMockSubscription('2', 'cus_2', 10000, 1, 'active', recentTimestamp), // $100/month new premium subscription
      createMockSubscription('3', 'cus_3', 3000), // $30/month regular subscription
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.expansionMRR).toBeGreaterThan(0);
    expect(result.totalUpgrades).toBeGreaterThan(0);
    expect(result.expansionRate).toBeGreaterThan(0);
    expect(result.averageExpansionPerUpgrade).toBeGreaterThan(0);
    expect(result.expansionBreakdown).toHaveLength(result.totalUpgrades);
    expect(result.netExpansion).toBe(result.expansionMRR);
  });

  it('should detect quantity-based expansion', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000, 1), // $20/month × 1 = $20
      createMockSubscription('2', 'cus_2', 3000, 5), // $30/month × 5 = $150 (expansion from quantity)
      createMockSubscription('3', 'cus_3', 1000, 1), // $10/month × 1 = $10
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    expect(result.expansionMRR).toBeGreaterThan(0);
    expect(result.totalUpgrades).toBeGreaterThan(0);
    
    // Should have expansion breakdown showing quantity increase
    const quantityExpansion = result.expansionBreakdown.find(
      item => item.changeType === 'quantity_increase'
    );
    expect(quantityExpansion).toBeDefined();
    if (quantityExpansion) {
      expect(quantityExpansion.planDetails.oldQuantity).toBe(1);
      expect(quantityExpansion.planDetails.newQuantity).toBe(5);
    }
  });

  it('should handle no expansion scenario', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month regular subscription
      createMockSubscription('2', 'cus_2', 3000), // $30/month regular subscription
      createMockSubscription('3', 'cus_3', 1000), // $10/month regular subscription
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.expansionMRR).toBe(0);
    expect(result.totalUpgrades).toBe(0);
    expect(result.expansionRate).toBe(0);
    expect(result.averageExpansionPerUpgrade).toBe(0);
    expect(result.expansionBreakdown).toHaveLength(0);
    expect(result.explanation).toContain('No MRR expansion detected');
  });

  it('should filter by currency when specified', async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60); // 10 days ago
    
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 10000, 1, 'active', recentTimestamp), // USD premium subscription
      {
        ...createMockSubscription('2', 'cus_2', 8000, 1, 'active', recentTimestamp),
        items: {
          data: [
            {
              id: 'si_2',
              price: {
                id: 'price_2',
                nickname: 'EUR Plan',
                unit_amount: 8000,
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

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions, currency: 'usd' },
      runtimeContext: {} as any,
    });

    expect(result.currency).toBe('usd');
    expect(result.explanation).toContain('USD currency subscriptions');
    
    // Should only consider USD subscriptions for expansion
    expect(result.expansionBreakdown.every(item => 
      subscriptions.find(sub => sub.id === item.subscriptionId)?.items.data[0].price.currency === 'usd'
    )).toBe(true);
  });

  it('should handle different period lengths', async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - (45 * 24 * 60 * 60); // 45 days ago
    
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 10000, 1, 'active', recentTimestamp), // Premium subscription from 45 days ago
    ];

    const result30Days = await stripeMRRExpansionTool.execute({
      context: { subscriptions, periodDays: 30 },
      runtimeContext: {} as any,
    });

    const result60Days = await stripeMRRExpansionTool.execute({
      context: { subscriptions, periodDays: 60 },
      runtimeContext: {} as any,
    });

    // 60-day period should capture the subscription, 30-day should not
    expect(result30Days.expansionMRR).toBe(0);
    expect(result60Days.expansionMRR).toBeGreaterThan(0);
    expect(result60Days.period.days).toBe(60);
  });

  it('should throw error when no subscriptions provided', async () => {
    await expect(
      stripeMRRExpansionTool.execute({
        context: { subscriptions: [] },
        runtimeContext: {} as any,
      })
    ).rejects.toThrow('No subscription data provided');
  });

  it('should include detailed expansion breakdown', async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60); // 5 days ago
    
    const subscriptions = [
      createMockSubscription('premium1', 'cus_1', 15000, 1, 'active', recentTimestamp), // $150/month premium
      createMockSubscription('quantity2', 'cus_2', 5000, 3), // $50/month × 3 = $150 (quantity expansion)
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    expect(result.expansionBreakdown).toHaveLength(2);
    
    // Check upgrade expansion
    const upgradeExpansion = result.expansionBreakdown.find(
      item => item.changeType === 'upgrade'
    );
    expect(upgradeExpansion).toBeDefined();
    if (upgradeExpansion) {
      expect(upgradeExpansion.subscriptionId).toBe('premium1');
      expect(upgradeExpansion.customerId).toBe('cus_1');
      expect(upgradeExpansion.newMRR).toBeGreaterThan(upgradeExpansion.oldMRR);
      expect(upgradeExpansion.expansionAmount).toBeGreaterThan(0);
    }

    // Check quantity expansion
    const quantityExpansion = result.expansionBreakdown.find(
      item => item.changeType === 'quantity_increase'
    );
    expect(quantityExpansion).toBeDefined();
    if (quantityExpansion) {
      expect(quantityExpansion.subscriptionId).toBe('quantity2');
      expect(quantityExpansion.customerId).toBe('cus_2');
      expect(quantityExpansion.planDetails.newQuantity).toBe(3);
      expect(quantityExpansion.planDetails.oldQuantity).toBe(1);
    }
  });

  it('should calculate expansion rate correctly', async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60); // 10 days ago
    
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000), // $20/month existing
      createMockSubscription('2', 'cus_2', 3000), // $30/month existing  
      createMockSubscription('3', 'cus_3', 10000, 1, 'active', recentTimestamp), // $100/month new premium
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    // Total starting MRR would be around $150 ($20 + $30 + $100)
    // Expansion from the premium plan should be calculated
    expect(result.expansionRate).toBeGreaterThan(0);
    expect(result.expansionRate).toBeLessThan(100); // Should be reasonable percentage
    
    // Average expansion per upgrade should be positive
    expect(result.averageExpansionPerUpgrade).toBeGreaterThan(0);
  });

  it('should handle inactive subscriptions correctly', async () => {
    const subscriptions = [
      createMockSubscription('1', 'cus_1', 2000, 1, 'active'), // Active subscription
      createMockSubscription('2', 'cus_2', 10000, 1, 'canceled'), // Canceled premium subscription
      createMockSubscription('3', 'cus_3', 15000, 1, 'incomplete'), // Incomplete subscription
    ];

    const result = await stripeMRRExpansionTool.execute({
      context: { subscriptions },
      runtimeContext: {} as any,
    });

    // Should only consider active subscriptions for expansion analysis
    expect(result.expansionBreakdown.every(item => {
      const subscription = subscriptions.find(sub => sub.id === item.subscriptionId);
      return subscription?.status === 'active';
    })).toBe(true);
  });
});