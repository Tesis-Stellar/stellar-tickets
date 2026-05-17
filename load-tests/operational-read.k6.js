import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders, headers, requiredEnv } from './lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400, 404));

export const options = {
  scenarios: {
    operational_read_paths: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 8),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:events_public_read}': ['p(95)<1000'],
    'http_req_duration{name:event_operational_detail}': ['p(95)<1200'],
    'http_req_duration{name:seat_inventory_read}': ['p(95)<1200'],
    'http_req_duration{name:admin_events_read}': ['p(95)<1800'],
    'http_req_duration{name:admin_contracts_read}': ['p(95)<1200'],
    'http_req_duration{name:admin_claims_read}': ['p(95)<1200'],
  },
};

const adminToken = __ENV.ADMIN_TOKEN || '';
const adminEmail = __ENV.ADMIN_EMAIL || '';
const adminPassword = __ENV.ADMIN_PASSWORD || '';
const eventId = __ENV.EVENT_ID || '';

export function setup() {
  if (adminToken) return { token: adminToken };

  if (adminEmail && adminPassword) {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: adminEmail, password: adminPassword }),
      { headers: headers(), tags: { name: 'admin_login' } },
    );
    if (res.status !== 200 || !res.json('accessToken')) {
      throw new Error(`Admin login failed with status ${res.status}`);
    }
    return { token: String(res.json('accessToken')) };
  }

  requiredEnv('ADMIN_TOKEN');
  return { token: '' };
}

export default function (data) {
  const events = http.get(`${BASE_URL}/api/events`, { tags: { name: 'events_public_read' } });
  check(events, { 'public events return 200': (res) => res.status === 200 });

  if (eventId) {
    const detail = http.get(`${BASE_URL}/api/events/${eventId}`, { tags: { name: 'event_operational_detail' } });
    check(detail, { 'event detail is readable': (res) => res.status === 200 || res.status === 404 });

    const seats = http.get(`${BASE_URL}/api/events/${eventId}/seats`, { tags: { name: 'seat_inventory_read' } });
    check(seats, {
      'seat inventory is readable or explicitly unavailable': (res) => res.status === 200 || res.status === 400 || res.status === 404,
    });
  }

  const adminEvents = http.get(`${BASE_URL}/api/admin/events`, {
    headers: authHeaders(data.token),
    tags: { name: 'admin_events_read' },
  });
  check(adminEvents, { 'admin events return 200': (res) => res.status === 200 });

  const contracts = http.get(`${BASE_URL}/api/admin/contracts`, {
    headers: authHeaders(data.token),
    tags: { name: 'admin_contracts_read' },
  });
  check(contracts, { 'admin contracts return 200': (res) => res.status === 200 });

  const claims = http.get(`${BASE_URL}/api/admin/claims`, {
    headers: authHeaders(data.token),
    tags: { name: 'admin_claims_read' },
  });
  check(claims, { 'admin claims return 200': (res) => res.status === 200 });

  sleep(1);
}
