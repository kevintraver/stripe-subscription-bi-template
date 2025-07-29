import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { stripeARPUTool } from './stripe-arpu-tool.js';
import { stripeChurnRateTool } from './stripe-churn-rate-tool.js';
import type { StripeSubscription } from '../../types/subscription-types.js';

// Input schema
const LTVCalculationInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period for ARPU calculation'),
  churnPeriodDays: z
    .number()
    .optional()
    .default(30)
    .describe('Number of days to analyze for churn rate calculation (default: 30)'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  subscriptions: z
    .array(z.any())
    .describe('Array of Stripe subscription objects to calculate LTV from'),
});

// Output schema
const LTVCalculationOutputSchema = z.object({
  ltv: z.number().describe('Customer Lifetime Value in currency base units (e.g., dollars)'),
  arpu: z.number().describe('Average Revenue Per User used in calculation'),
  churnRate: z.number().describe('Customer churn rate percentage used in calculation'),
  retentionRate: z.number().describe('Customer retention rate (100 - churn rate)'),
  monthsToChurn: z.number().describe('Average number of months before a customer churns (1 / monthly churn rate)'),
  currency: z.string().describe('Primary currency for the calculation'),
  totalCustomers: z.number().describe('Total number of unique customers analyzed'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  churnedCustomers: z.number().describe('Number of customers that churned in the analysis period'),
  period: z.object({
    startDate: z.string().describe('ISO date string for churn analysis period start'),
    endDate: z.string().describe('ISO date string for churn analysis period end'),
    days: z.number().describe('Number of days in the churn analysis period'),
  }),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the LTV calculation methodology'),
  dependencyResults: z.object({
    arpu: z.any().describe('Full ARPU calculation results'),
    churnRate: z.any().describe('Full churn rate calculation results'),
  }).describe('Detailed results from dependent calculations'),
});

export const stripeLTVTool = createTool({
  id: 'stripe-ltv-tool',
  description: 'Calculate Customer Lifetime Value (LTV) from provided Stripe subscription data using the formula: ARPU ÷ (Churn Rate ÷ 100). This tool depends on both ARPU and churn rate calculations and performs the complete LTV analysis. Subscription data should be provided by the agent using Stripe MCP tools.',
  inputSchema: LTVCalculationInputSchema,
  outputSchema: LTVCalculationOutputSchema,

  execute: async ({ context }) => {
    const { 
      includeTrialSubscriptions = false, 
      churnPeriodDays = 30, 
      currency, 
      subscriptions 
    } = context;
    
    try {
      if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        throw new Error('No subscription data provided. This tool requires subscription data to be passed in the subscriptions parameter.');
      }

      // Cast subscriptions to the correct type
      const typedSubscriptions = subscriptions as StripeSubscription[];

      // Step 1: Calculate ARPU using the ARPU tool
      const arpuResult = await stripeARPUTool.execute({
        context: {
          includeTrialSubscriptions,
          currency,
          subscriptions: typedSubscriptions,
        }
      });

      // Step 2: Calculate churn rate using the churn rate tool
      const churnRateResult = await stripeChurnRateTool.execute({
        context: {
          periodDays: churnPeriodDays,
          currency,
          subscriptions: typedSubscriptions,
        }
      });

      // Step 3: Calculate LTV using ARPU ÷ (Churn Rate ÷ 100)
      // Convert churn rate percentage to decimal for calculation
      const churnRateDecimal = churnRateResult.churnRate / 100;
      
      let ltv: number;
      let monthsToChurn: number;
      
      if (churnRateDecimal === 0) {
        // If there's no churn, LTV is theoretically infinite
        // We'll set it to a very high number for practical purposes
        ltv = Number.MAX_SAFE_INTEGER;
        monthsToChurn = Number.MAX_SAFE_INTEGER;
      } else {
        // LTV = ARPU ÷ Monthly Churn Rate
        // Since our churn rate is for the specified period, we need to normalize to monthly
        const monthlyChurnRate = churnRateDecimal * (30 / churnPeriodDays);
        ltv = Math.round((arpuResult.arpu / monthlyChurnRate) * 100) / 100;
        monthsToChurn = Math.round((1 / monthlyChurnRate) * 100) / 100;
      }

      // If LTV is infinite or too large, cap it at a reasonable maximum
      if (!isFinite(ltv) || ltv > 1000000) {
        ltv = 1000000; // Cap at $1M for display purposes
      }
      if (!isFinite(monthsToChurn) || monthsToChurn > 10000) {
        monthsToChurn = 10000; // Cap at 10,000 months for display purposes
      }

      const result = {
        ltv,
        arpu: arpuResult.arpu,
        churnRate: churnRateResult.churnRate,
        retentionRate: churnRateResult.retentionRate,
        monthsToChurn,
        currency: arpuResult.currency,
        totalCustomers: arpuResult.uniqueCustomers + churnRateResult.newCustomersInPeriod,
        activeSubscriptions: arpuResult.activeSubscriptions,
        churnedCustomers: churnRateResult.churnedCustomersCount,
        period: churnRateResult.period,
        calculatedAt: new Date().toISOString(),
        explanation: churnRateDecimal === 0 
          ? `LTV calculation: No customer churn detected in the analysis period, indicating excellent retention. ` +
            `With ARPU of $${arpuResult.arpu} and 0% churn rate, theoretical LTV is infinite. ` +
            `For practical purposes, LTV is set to $${ltv.toLocaleString()}. ` +
            `Analysis based on ${arpuResult.uniqueCustomers} unique customers and ${arpuResult.activeSubscriptions} active subscriptions. ` +
            `Churn analysis period: ${churnPeriodDays} days. ` +
            `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`
          : `LTV calculated using formula: ARPU ÷ Monthly Churn Rate = $${arpuResult.arpu} ÷ ${(churnRateDecimal * (30 / churnPeriodDays) * 100).toFixed(2)}% = $${ltv}. ` +
            `This represents the average total revenue expected from a customer over their lifetime. ` +
            `Average customer lifetime: ${monthsToChurn} months. ` +
            `Based on ${arpuResult.uniqueCustomers} unique customers with ${churnRateResult.churnedCustomersCount} churned customers in ${churnPeriodDays}-day period. ` +
            `Retention rate: ${churnRateResult.retentionRate}%. ` +
            `${currency ? `Filtered to ${currency.toUpperCase()} currency only.` : 'All currencies included.'}`,
        dependencyResults: {
          arpu: arpuResult,
          churnRate: churnRateResult,
        },
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to calculate LTV: ${errorMessage}`);
    }
  },
});