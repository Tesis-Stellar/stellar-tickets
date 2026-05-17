export type ResaleLimitType = 'FIXED_PRICE' | 'PERCENTAGE';

export type ResalePolicyInput = {
  enabled: boolean;
  limitType: ResaleLimitType;
  maxPriceAmount?: number | null;
  maxPricePercent?: number | null;
  resaleStartsAt?: Date | null;
  resaleEndsAt?: Date | null;
  blockHoursBeforeEvent: number;
  platformFeePercent: number;
  organizerFeePercent: number;
};

export type ResalePolicyEvaluationInput = {
  policy: ResalePolicyInput;
  originalPriceAmount: number;
  requestedPriceAmount?: number | null;
  eventStartsAt: Date;
  now?: Date;
};

export type ResalePolicySnapshot = {
  enabled: boolean;
  limitType: ResaleLimitType;
  originalPriceAmount: number;
  maxPriceAmount: number | null;
  maxPricePercent: number | null;
  resaleStartsAt: string | null;
  resaleEndsAt: string | null;
  resaleDeadline: string | null;
  blockHoursBeforeEvent: number;
  platformFeePercent: number;
  organizerFeePercent: number;
  sellerReceivesPercent: number;
};

export type ResalePolicyEvaluation =
  | { ok: true; snapshot: ResalePolicySnapshot }
  | { ok: false; status: number; error: string; snapshot: ResalePolicySnapshot };

export function defaultResalePolicy(): ResalePolicyInput {
  return {
    enabled: true,
    limitType: 'PERCENTAGE',
    maxPriceAmount: null,
    maxPricePercent: 150,
    resaleStartsAt: null,
    resaleEndsAt: null,
    blockHoursBeforeEvent: 6,
    platformFeePercent: 3,
    organizerFeePercent: 5,
  };
}

function computeMaxPriceAmount(policy: ResalePolicyInput, originalPriceAmount: number): number | null {
  if (policy.limitType === 'FIXED_PRICE') return policy.maxPriceAmount ?? null;
  if (policy.maxPricePercent == null) return null;
  return Math.round((originalPriceAmount * policy.maxPricePercent) / 100);
}

function computeDeadline(policy: ResalePolicyInput, eventStartsAt: Date): Date | null {
  const blockDeadline = new Date(eventStartsAt.getTime() - policy.blockHoursBeforeEvent * 60 * 60 * 1000);
  if (!policy.resaleEndsAt) return blockDeadline;
  return new Date(Math.min(policy.resaleEndsAt.getTime(), blockDeadline.getTime()));
}

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function evaluateResalePolicy(input: ResalePolicyEvaluationInput): ResalePolicyEvaluation {
  const now = input.now ?? new Date();
  const policy = input.policy;
  const maxPriceAmount = computeMaxPriceAmount(policy, input.originalPriceAmount);
  const resaleDeadline = computeDeadline(policy, input.eventStartsAt);
  const snapshot: ResalePolicySnapshot = {
    enabled: policy.enabled,
    limitType: policy.limitType,
    originalPriceAmount: input.originalPriceAmount,
    maxPriceAmount,
    maxPricePercent: policy.maxPricePercent ?? null,
    resaleStartsAt: toIso(policy.resaleStartsAt),
    resaleEndsAt: toIso(policy.resaleEndsAt),
    resaleDeadline: toIso(resaleDeadline),
    blockHoursBeforeEvent: policy.blockHoursBeforeEvent,
    platformFeePercent: policy.platformFeePercent,
    organizerFeePercent: policy.organizerFeePercent,
    sellerReceivesPercent: Math.max(0, 100 - policy.platformFeePercent - policy.organizerFeePercent),
  };

  if (!policy.enabled) {
    return { ok: false, status: 403, error: 'La reventa no está habilitada para este evento', snapshot };
  }
  if (policy.resaleStartsAt && now < policy.resaleStartsAt) {
    return { ok: false, status: 409, error: 'La ventana de reventa aún no ha iniciado', snapshot };
  }
  if (resaleDeadline && now > resaleDeadline) {
    return { ok: false, status: 409, error: 'La ventana de reventa ya finalizó para este evento', snapshot };
  }
  if (maxPriceAmount != null && input.requestedPriceAmount != null && input.requestedPriceAmount > maxPriceAmount) {
    return { ok: false, status: 409, error: 'El precio de reventa supera el máximo permitido para este evento', snapshot };
  }

  return { ok: true, snapshot };
}
