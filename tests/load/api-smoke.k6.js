import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, authHeaders, headers } from '../../load-tests/lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400, 401, 403, 404, 409));

export const options = {
  scenarios: {
    'LOAD-API-01': {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<=0.01'],
  },
};

function login(email, password, tagName) {
  if (!email || !password) return null;
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: headers(), tags: { name: tagName, kind: 'authenticated' } },
  );
  check(res, { [`${tagName} login returns 200`]: (r) => r.status === 200 && Boolean(r.json('accessToken')) });
  return res.status === 200 ? String(res.json('accessToken')) : null;
}

export function setup() {
  return {
    userToken: __ENV.USER_TOKEN || login(__ENV.USER_EMAIL, __ENV.USER_PASSWORD, 'user_login'),
    scannerToken: __ENV.SCANNER_TOKEN || login(__ENV.SCANNER_EMAIL, __ENV.SCANNER_PASSWORD, 'scanner_login'),
    eventSlug: __ENV.EVENT_SLUG || '',
    scanQrToken: __ENV.SCAN_QR_TOKEN || '',
    checkoutMode: __ENV.CHECKOUT_GUARD || 'empty-cart',
  };
}

export default function (data) {
  group('LOAD-API-01 public reads', () => {
    const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health', kind: 'public' } });
    check(health, { 'health returns 200': (res) => res.status === 200 });

    const events = http.get(`${BASE_URL}/api/events`, { tags: { name: 'events_list', kind: 'public' } });
    check(events, { 'events list returns 200': (res) => res.status === 200 });

    if (data.eventSlug) {
      const detail = http.get(`${BASE_URL}/api/events/${data.eventSlug}`, {
        tags: { name: 'event_detail', kind: 'public' },
      });
      check(detail, { 'event detail returns 200': (res) => res.status === 200 });
    }
  });

  if (data.userToken) {
    group('LOAD-API-01 authenticated reads and safe checkout guard', () => {
      const inventory = http.get(`${BASE_URL}/api/tickets`, {
        headers: authHeaders(data.userToken),
        tags: { name: 'inventory', kind: 'authenticated' },
      });
      check(inventory, { 'inventory returns 200': (res) => res.status === 200 });

      const cart = http.get(`${BASE_URL}/api/cart`, {
        headers: authHeaders(data.userToken),
        tags: { name: 'cart', kind: 'authenticated' },
      });
      check(cart, { 'cart returns 200': (res) => res.status === 200 });

      if (data.checkoutMode === 'empty-cart' && cart.status === 200 && Array.isArray(cart.json()) && cart.json().length === 0) {
        const preview = http.post(`${BASE_URL}/api/checkout/preview`, JSON.stringify({}), {
          headers: authHeaders(data.userToken),
          tags: { name: 'checkout_preview_empty', kind: 'authenticated' },
        });
        check(preview, { 'empty checkout preview is rejected safely': (res) => res.status === 400 });

        const confirm = http.post(`${BASE_URL}/api/checkout/confirm`, JSON.stringify({ paymentMethod: 'CARD' }), {
          headers: authHeaders(data.userToken),
          tags: { name: 'checkout_confirm_empty', kind: 'authenticated' },
        });
        check(confirm, { 'empty checkout confirm is rejected safely': (res) => res.status === 400 });
      }
    });
  }

  const scannerSampleEvery = Number(__ENV.SCANNER_SAMPLE_EVERY || 3);
  if (data.scannerToken && (__ITER % scannerSampleEvery === 0)) {
    group('LOAD-API-01 scanner guard', () => {
      const body = data.scanQrToken ? { qrToken: data.scanQrToken } : { qrToken: 'invalid-load-api-01-token' };
      const scan = http.post(`${BASE_URL}/api/admin/scan`, JSON.stringify(body), {
        headers: authHeaders(data.scannerToken),
        tags: { name: 'scanner', kind: 'scanner' },
      });
      check(scan, {
        'scanner returns controlled status': (res) =>
          data.scanQrToken ? [200, 409].includes(res.status) : res.status === 400,
      });
    });
  }

  sleep(1);
}
