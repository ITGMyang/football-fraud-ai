export const BILLING_PLANS = Object.freeze([
  Object.freeze({ id: 'day', name: '24-Hour Pass', amountCents: 299, durationHours: 24, recommended: false }),
  Object.freeze({ id: 'week', name: 'Weekly Pass', amountCents: 1199, durationHours: 7 * 24, recommended: false }),
  Object.freeze({ id: 'month', name: 'Monthly Pass', amountCents: 2999, durationHours: 30 * 24, recommended: true })
]);

export function billingPlan(planId) {
  return BILLING_PLANS.find((plan) => plan.id === String(planId || '')) || null;
}

export function publicBillingPlans() {
  return BILLING_PLANS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    price: (plan.amountCents / 100).toFixed(2),
    currency: 'USDT',
    durationHours: plan.durationHours,
    recommended: plan.recommended
  }));
}

export function billingAccess(entitlement = {}, now = Date.now()) {
  const validUntil = Date.parse(entitlement?.validUntil || entitlement?.valid_until || '');
  if (Number.isFinite(validUntil) && validUntil > now) {
    return {
      tier: 'paid',
      active: true,
      planId: entitlement.planId || entitlement.plan_id || '',
      validUntil: new Date(validUntil).toISOString(),
      freePredictionUsed: Boolean(entitlement.freePredictionUsed ?? entitlement.free_prediction_used)
    };
  }
  const freePredictionUsed = Boolean(entitlement?.freePredictionUsed ?? entitlement?.free_prediction_used);
  return {
    tier: freePredictionUsed ? 'locked' : 'free',
    active: false,
    planId: '',
    validUntil: '',
    freePredictionUsed
  };
}
