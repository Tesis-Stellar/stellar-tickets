import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL } from '../../load-tests/lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 404));

export const options = {
  scenarios: {
    'LOAD-API-01-public-read': {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 25),
      duration: __ENV.DURATION || '3m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<=0.01'],
    'http_req_duration{kind:public}': ['p(95)<1500'],
    'http_req_duration{name:health}': ['p(95)<300'],
    'http_req_duration{name:events_list}': ['p(95)<1500'],
    'http_req_duration{name:event_detail_marketplace_equivalent}': ['p(95)<1500'],
  },
};

export default function () {
  group('LOAD-API-01 Escenario A - lectura publica', () => {
    const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health', kind: 'public' } });
    check(health, { 'health 200': (res) => res.status === 200 });

    const events = http.get(`${BASE_URL}/api/events`, { tags: { name: 'events_list', kind: 'public' } });
    check(events, { 'events list 200': (res) => res.status === 200 });

    const eventSlug = __ENV.EVENT_SLUG || '';
    if (eventSlug) {
      const detail = http.get(`${BASE_URL}/api/events/${eventSlug}`, {
        tags: { name: 'event_detail_marketplace_equivalent', kind: 'public' },
      });
      check(detail, {
        'event detail 200': (res) => res.status === 200,
        'marketplace data shape controlled': (res) => {
          if (res.status !== 200) return false;
          const body = res.json();
          return Array.isArray(body.live_tickets) || Array.isArray(body.liveTickets) || body.id !== undefined;
        },
      });
    }
  });

  sleep(1);
}
