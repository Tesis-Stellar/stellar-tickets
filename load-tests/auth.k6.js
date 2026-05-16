import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, headers, requiredEnv } from './lib/config.js';

export const options = {
  scenarios: {
    login_controlled: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 10),
      timeUnit: '1m',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 5),
      maxVUs: Number(__ENV.MAX_VUS || 10),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:login}': ['p(95)<3000'],
  },
};

const email = requiredEnv('LOAD_TEST_EMAIL');
const password = requiredEnv('LOAD_TEST_PASSWORD');

export default function () {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: headers(), tags: { name: 'login' } },
  );

  check(res, {
    'login returns 200': (response) => response.status === 200,
    'login returns access token': (response) => Boolean(response.json('accessToken')),
  });

  sleep(1);
}
