import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { BASE_URL, authHeaders, headers, requiredEnv } from './lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400));

export const options = {
  scenarios: {
    checkout_guard_controlled: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 20),
      timeUnit: '1m',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 5),
      maxVUs: Number(__ENV.MAX_VUS || 10),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:cart_read}': ['p(95)<3000'],
    'http_req_duration{name:checkout_preview_empty}': ['p(95)<2500'],
    'http_req_duration{name:checkout_confirm_empty}': ['p(95)<5000'],
  },
};

const checkoutToken = __ENV.CHECKOUT_TOKEN || '';
const checkoutEmail = __ENV.CHECKOUT_EMAIL || '';
const checkoutPassword = __ENV.CHECKOUT_PASSWORD || '';

export function setup() {
  if (checkoutToken) return { token: checkoutToken };

  if (checkoutEmail && checkoutPassword) {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: checkoutEmail, password: checkoutPassword }),
      { headers: headers(), tags: { name: 'checkout_login' } },
    );
    if (res.status !== 200 || !res.json('accessToken')) {
      throw new Error(`Checkout login failed with status ${res.status}`);
    }
    return { token: String(res.json('accessToken')) };
  }

  requiredEnv('CHECKOUT_TOKEN');
  return { token: '' };
}

export default function (data) {
  const cart = http.get(`${BASE_URL}/api/cart`, {
    headers: authHeaders(data.token),
    tags: { name: 'cart_read' },
  });

  const cartIsEmpty = cart.status === 200 && Array.isArray(cart.json()) && cart.json().length === 0;
  check(cart, {
    'cart returns 200': (response) => response.status === 200,
    'cart is empty for non-destructive checkout test': () => cartIsEmpty,
  });

  if (!cartIsEmpty) {
    fail('Checkout guard requires a test user with an empty active cart to avoid creating orders.');
  }

  const preview = http.post(`${BASE_URL}/api/checkout/preview`, JSON.stringify({}), {
    headers: authHeaders(data.token),
    tags: { name: 'checkout_preview_empty' },
  });
  check(preview, {
    'empty checkout preview returns 400': (response) => response.status === 400,
  });

  const confirm = http.post(
    `${BASE_URL}/api/checkout/confirm`,
    JSON.stringify({ paymentMethod: 'CARD', idempotencyKey: `load-empty-${__VU}-${__ITER}` }),
    { headers: authHeaders(data.token), tags: { name: 'checkout_confirm_empty' } },
  );
  check(confirm, {
    'empty checkout confirm returns 400': (response) => response.status === 400,
  });

  sleep(1);
}
