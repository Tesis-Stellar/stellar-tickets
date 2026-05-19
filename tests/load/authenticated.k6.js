import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, authHeaders, headers } from '../../load-tests/lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 401, 403));

export const options = {
  scenarios: {
    'LOAD-API-01-authenticated': {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || '3m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<=0.01'],
    'http_req_duration{kind:authenticated}': ['p(95)<2500'],
    'http_req_duration{name:profile}': ['p(95)<1500'],
    'http_req_duration{name:inventory}': ['p(95)<2500'],
    'http_req_duration{name:orders}': ['p(95)<2500'],
  },
};

function login() {
  if (__ENV.USER_TOKEN) return __ENV.USER_TOKEN;
  if (!__ENV.USER_EMAIL || !__ENV.USER_PASSWORD) {
    throw new Error('LOAD-API-01 authenticated requires USER_TOKEN or USER_EMAIL/USER_PASSWORD');
  }

  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: __ENV.USER_EMAIL, password: __ENV.USER_PASSWORD }),
    { headers: headers(), tags: { name: 'login', kind: 'authenticated' } },
  );
  check(response, { 'login 200': (res) => res.status === 200 && Boolean(res.json('accessToken')) });
  return String(response.json('accessToken'));
}

export function setup() {
  return { token: login() };
}

export default function (data) {
  group('LOAD-API-01 Escenario B - usuario autenticado', () => {
    const profile = http.get(`${BASE_URL}/api/users/me`, {
      headers: authHeaders(data.token),
      tags: { name: 'profile', kind: 'authenticated' },
    });
    check(profile, { 'profile 200': (res) => res.status === 200 });

    const inventory = http.get(`${BASE_URL}/api/tickets`, {
      headers: authHeaders(data.token),
      tags: { name: 'inventory', kind: 'authenticated' },
    });
    check(inventory, { 'inventory 200': (res) => res.status === 200 });

    const orders = http.get(`${BASE_URL}/api/orders`, {
      headers: authHeaders(data.token),
      tags: { name: 'orders', kind: 'authenticated' },
    });
    check(orders, { 'orders 200': (res) => res.status === 200 });
  });

  sleep(1);
}
