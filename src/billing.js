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

export async function reconcilePendingBillingOrders({ orders = [], storage, getStatus }) {
  const summary = { checked: 0, confirmed: 0, updated: 0, errors: [] };
  for (const order of orders) {
    const orderId = String(order.id || '');
    const intentId = String(order.intentId || order.allscale_intent_id || '');
    const currentStatus = Number(order.status);
    if (!orderId || !intentId || currentStatus === 20 || currentStatus < 0) continue;
    summary.checked += 1;
    try {
      const remote = await getStatus(intentId);
      if (Number(remote.status) === 20) {
        await storage.confirmAllScalePayment({
          intentId,
          webhookId: `poll:${intentId}`,
          nonce: crypto.randomUUID(),
          payload: { source: 'server-reconciliation', request_id: remote.requestId || '' }
        });
        await storage.updateBillingOrder(orderId, { requestId: remote.requestId || '' });
        summary.confirmed += 1;
      } else {
        await storage.updateBillingOrder(orderId, { status: remote.status, requestId: remote.requestId || '' });
      }
      summary.updated += 1;
    } catch (error) {
      summary.errors.push({ orderId, error: error.message });
    }
  }
  return summary;
}
