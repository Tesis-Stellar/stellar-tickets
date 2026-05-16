export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function authHeaders(token) {
  return headers({ Authorization: `Bearer ${token}` });
}
