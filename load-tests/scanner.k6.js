import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders, headers, requiredEnv } from './lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400, 409));

export const options = {
  scenarios: {
    scanner_controlled: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 30),
      timeUnit: '1m',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 5),
      maxVUs: Number(__ENV.MAX_VUS || 10),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:scanner}': ['p(95)<800'],
  },
};

const scannerToken = __ENV.SCANNER_TOKEN || '';
const scannerEmail = __ENV.SCANNER_EMAIL || '';
const scannerPassword = __ENV.SCANNER_PASSWORD || '';
const qrToken = __ENV.SCAN_QR_TOKEN || '';

export function setup() {
  if (scannerToken) return { token: scannerToken };

  if (scannerEmail && scannerPassword) {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: scannerEmail, password: scannerPassword }),
      { headers: headers(), tags: { name: 'scanner_login' } },
    );
    if (res.status !== 200 || !res.json('accessToken')) {
      throw new Error(`Scanner login failed with status ${res.status}`);
    }
    return { token: String(res.json('accessToken')) };
  }

  requiredEnv('SCANNER_TOKEN');
  return { token: '' };
}

export default function (data) {
  const body = qrToken
    ? { qrToken }
    : { qrToken: 'invalid-load-test-token' };

  const res = http.post(
    `${BASE_URL}/api/admin/scan`,
    JSON.stringify(body),
    { headers: authHeaders(data.token), tags: { name: 'scanner' } },
  );

  check(res, {
    'scanner returns expected status': (response) =>
      qrToken ? [200, 409].includes(response.status) : response.status === 400,
  });

  sleep(1);
}
