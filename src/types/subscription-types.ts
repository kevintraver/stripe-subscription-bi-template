export interface StripeSubscription {
  id: string;
  status: 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'paused';
  current_period_start: number;
  current_period_end: number;
  customer: string;
  items: {
    data: Array<{
      id: string;
      price: {
        id: string;
        nickname?: string;
        unit_amount: number | null;
        currency: string;
        recurring: {
          interval: 'day' | 'week' | 'month' | 'year';
          interval_count: number;
        } | null;
      };
      quantity: number;
    }>;
  };
  created: number;
  cancel_at_period_end: boolean;
  canceled_at?: number | null;
  trial_start: number | null;
  trial_end: number | null;
}

export interface MRRCalculationResult {
  totalMRR: number;
  currency: string;
  activeSubscriptions: number;
  breakdown: {
    subscriptionId: string;
    customerMRR: number;
    planName?: string;
    billingInterval: string;
  }[];
  calculatedAt: string;
  explanation: string;
}

export interface BillingPeriodNormalization {
  originalAmount: number;
  originalInterval: string;
  originalIntervalCount: number;
  normalizedMonthlyAmount: number;
}