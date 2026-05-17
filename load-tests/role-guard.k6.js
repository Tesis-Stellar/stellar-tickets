import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders, headers, requiredEnv } from './lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 403));

export const options = {
  scenarios: {
    role_guards: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 12),
      timeUnit: '1m',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 4),
      maxVUs: Number(__ENV.MAX_VUS || 8),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:role_guard_cart_items}': ['p(95)<1500'],
    'http_req_duration{name:role_guard_checkout_preview}': ['p(95)<1500'],
    'http_req_duration{name:role_guard_checkout_confirm}': ['p(95)<1500'],
    'http_req_duration{name:role_guard_wallet_challenge}': ['p(95)<1500'],
    'http_req_duration{name:role_guard_wallet_patch}': ['p(95)<1500'],
  },
};

const testWallet = __ENV.TEST_WALLET || 'GC5DPWEAIL6KIPBB7D7NGSAGKTUFEBJATSZVVQLCZ2SVLT2RR3HJOFDQ';

function login(email, password, label) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: headers(), tags: { name: `${label}_login` } },
  );
  if (res.status !== 200 || !res.json('accessToken')) {
    throw new Error(`${label} login failed with status ${res.status}`);
  }
  return String(res.json('accessToken'));
}

function resolveToken(role) {
  const upper = role.toUpperCase();
  const token = __ENV[`${upper}_TOKEN`];
  if (token) return token;

  const email = __ENV[`${upper}_EMAIL`];
  const password = __ENV[`${upper}_PASSWORD`];
  if (email && password) return login(email, password, role);

  requiredEnv(`${upper}_TOKEN`);
  return '';
}

export function setup() {
  return {
    roles: [
      { label: 'admin', token: resolveToken('admin') },
      { label: 'staff', token: resolveToken('staff') },
    ],
  };
}

export default function (data) {
  const role = data.roles[__ITER % data.roles.length];
  const auth = authHeaders(role.token);
  const roleTag = { role: role.label };

  const cart = http.post(
    `${BASE_URL}/api/cart/items`,
    JSON.stringify({ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 }),
    { headers: auth, tags: { name: 'role_guard_cart_items', ...roleTag } },
  );
  check(cart, { 'cart add is forbidden for operational roles': (res) => res.status === 403 });

  const preview = http.post(`${BASE_URL}/api/checkout/preview`, JSON.stringify({}), {
    headers: auth,
    tags: { name: 'role_guard_checkout_preview', ...roleTag },
  });
  check(preview, { 'checkout preview is forbidden for operational roles': (res) => res.status === 403 });

  const confirm = http.post(
    `${BASE_URL}/api/checkout/confirm`,
    JSON.stringify({ paymentMethod: 'CARD', idempotencyKey: `role-guard-${role.label}-${__VU}-${__ITER}` }),
    { headers: auth, tags: { name: 'role_guard_checkout_confirm', ...roleTag } },
  );
  check(confirm, { 'checkout confirm is forbidden for operational roles': (res) => res.status === 403 });

  const challenge = http.post(
    `${BASE_URL}/api/wallet/challenge`,
    JSON.stringify({ walletAddress: testWallet }),
    { headers: auth, tags: { name: 'role_guard_wallet_challenge', ...roleTag } },
  );
  check(challenge, { 'wallet challenge is forbidden for operational roles': (res) => res.status === 403 });

  const patchWallet = http.patch(
    `${BASE_URL}/api/users/me/wallet`,
    JSON.stringify({ walletAddress: testWallet, challengeId: 'load-test-challenge', signature: 'load-test-signature' }),
    { headers: auth, tags: { name: 'role_guard_wallet_patch', ...roleTag } },
  );
  check(patchWallet, { 'wallet patch is forbidden for operational roles': (res) => res.status === 403 });

  sleep(1);
}
