import { z } from 'zod';

export const MRRInputSchema = z.object({
  includeTrialSubscriptions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include subscriptions currently in trial period'),
  currency: z
    .string()
    .optional()
    .describe('Currency to filter by (e.g., "usd"). If not provided, uses all currencies'),
  asOfDate: z
    .string()
    .optional()
    .describe('Calculate MRR as of specific date (ISO format). Defaults to current date'),
});

export const MRROutputSchema = z.object({
  totalMRR: z.number().describe('Total Monthly Recurring Revenue in base currency units'),
  currency: z.string().describe('Primary currency for the calculation'),
  activeSubscriptions: z.number().describe('Number of active subscriptions included'),
  breakdown: z
    .array(
      z.object({
        subscriptionId: z.string(),
        customerMRR: z.number(),
        planName: z.string().optional(),
        billingInterval: z.string(),
      })
    )
    .describe('Detailed breakdown of MRR by subscription'),
  calculatedAt: z.string().describe('ISO timestamp when calculation was performed'),
  explanation: z.string().describe('Human-readable explanation of the calculation methodology'),
});

export type MRRInput = z.infer<typeof MRRInputSchema>;
export type MRROutput = z.infer<typeof MRROutputSchema>;