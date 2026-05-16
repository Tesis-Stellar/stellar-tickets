export type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export function parseCorsOrigins(value: string | undefined, fallback: string[] = []): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function evaluateRateLimit(input: {
  bucket: RateLimitBucket | undefined;
  now: number;
  windowMs: number;
  max: number;
}): { allowed: true; bucket: RateLimitBucket } | { allowed: false; bucket: RateLimitBucket; retryAfterSeconds: number } {
  const resetAt = input.now + input.windowMs;
  const bucket = !input.bucket || input.bucket.resetAt <= input.now
    ? { count: 0, resetAt }
    : input.bucket;

  const nextBucket = { ...bucket, count: bucket.count + 1 };
  if (nextBucket.count > input.max) {
    return {
      allowed: false,
      bucket: nextBucket,
      retryAfterSeconds: Math.max(1, Math.ceil((nextBucket.resetAt - input.now) / 1000)),
    };
  }

  return { allowed: true, bucket: nextBucket };
}

export function isJwtSecretStrong(secret: string | undefined): boolean {
  return Boolean(secret && secret.length >= 32);
}
