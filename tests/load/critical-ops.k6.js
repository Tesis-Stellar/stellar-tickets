import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, authHeaders, headers } from '../../load-tests/lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400, 401, 403, 404, 409));

export const options = {
  scenarios: {
    'LOAD-API-01-critical-ops': {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<=0.01'],
    'http_req_duration{kind:critical}': ['p(95)<3000'],
  },
};

function login(email, password, label) {
  if (!email || !password) return null;
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: headers(), tags: { name: `${label}_login`, kind: 'critical' } },
  );
  check(response, { [`${label} login 200`]: (res) => res.status === 200 && Boolean(res.json('accessToken')) });
  return response.status === 200 ? String(response.json('accessToken')) : null;
}

export function setup() {
  const userToken = __ENV.USER_TOKEN || login(__ENV.USER_EMAIL, __ENV.USER_PASSWORD, 'user');
  const scannerToken = __ENV.SCANNER_TOKEN || login(__ENV.SCANNER_EMAIL, __ENV.SCANNER_PASSWORD, 'scanner');
  return {
    userToken,
    scannerToken,
    scanQrToken: __ENV.SCAN_QR_TOKEN || '',
    safeCheckoutGuard: __ENV.CHECKOUT_GUARD || 'empty-cart',
  };
}

export default function (data) {
  group('LOAD-API-01 Escenario C - operaciones criticas controladas', () => {
    if (data.userToken && data.safeCheckoutGuard === 'empty-cart') {
      const cart = http.get(`${BASE_URL}/api/cart`, {
        headers: authHeaders(data.userToken),
        tags: { name: 'cart_guard', kind: 'critical' },
      });
      check(cart, { 'cart guard controlled': (res) => res.status === 200 });

      const preview = http.post(`${BASE_URL}/api/checkout/preview`, JSON.stringify({}), {
        headers: authHeaders(data.userToken),
        tags: { name: 'checkout_preview_empty', kind: 'critical' },
      });
      check(preview, { 'empty checkout preview rejected safely': (res) => res.status === 400 });

      const confirm = http.post(`${BASE_URL}/api/checkout/confirm`, JSON.stringify({ paymentMethod: 'CARD' }), {
        headers: authHeaders(data.userToken),
        tags: { name: 'checkout_confirm_empty', kind: 'critical' },
      });
      check(confirm, { 'empty checkout confirm rejected safely': (res) => res.status === 400 });
    }

    if (data.scannerToken) {
      const body = data.scanQrToken ? { qrToken: data.scanQrToken } : { qrToken: 'invalid-load-api-01-token' };
      const scan = http.post(`${BASE_URL}/api/admin/scan`, JSON.stringify(body), {
        headers: authHeaders(data.scannerToken),
        tags: { name: 'scanner_guard', kind: 'critical' },
      });
      check(scan, {
        'scanner controlled status': (res) =>
          data.scanQrToken ? [200, 409].includes(res.status) : res.status === 400,
      });
    }
  });

  sleep(1);
}
