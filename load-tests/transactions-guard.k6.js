import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders, headers, requiredEnv } from './lib/config.js';

http.setResponseCallback(http.expectedStatuses(200, 400, 403, 409, 503));

export const options = {
  scenarios: {
    transactions_guard_controlled: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 8),
      timeUnit: '1m',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 5),
      maxVUs: Number(__ENV.MAX_VUS || 10),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:submit_missing_intent}': ['p(95)<1000'],
    'http_req_duration{name:submit_classic_missing_xdr}': ['p(95)<800'],
    'http_req_duration{name:transfer_nft_missing_fields}': ['p(95)<1000'],
  },
};

const transactionToken = __ENV.TRANSACTION_TOKEN || '';
const transactionEmail = __ENV.TRANSACTION_EMAIL || '';
const transactionPassword = __ENV.TRANSACTION_PASSWORD || '';

export function setup() {
  if (transactionToken) return { token: transactionToken };

  if (transactionEmail && transactionPassword) {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: transactionEmail, password: transactionPassword }),
      { headers: headers(), tags: { name: 'transactions_login' } },
    );
    if (res.status !== 200 || !res.json('accessToken')) {
      throw new Error(`Transaction login failed with status ${res.status}`);
    }
    return { token: String(res.json('accessToken')) };
  }

  requiredEnv('TRANSACTION_TOKEN');
  return { token: '' };
}

export default function (data) {
  const submit = http.post(`${BASE_URL}/api/transactions/submit`, JSON.stringify({}), {
    headers: authHeaders(data.token),
    tags: { name: 'submit_missing_intent' },
  });
  check(submit, {
    'submit rejects missing intent and XDR': (response) => response.status === 400,
  });

  const submitClassic = http.post(`${BASE_URL}/api/transactions/submit-classic`, JSON.stringify({}), {
    headers: authHeaders(data.token),
    tags: { name: 'submit_classic_missing_xdr' },
  });
  check(submitClassic, {
    'classic submit rejects missing signed XDR': (response) => response.status === 400,
  });

  const transfer = http.post(`${BASE_URL}/api/transactions/transfer-nft`, JSON.stringify({}), {
    headers: authHeaders(data.token),
    tags: { name: 'transfer_nft_missing_fields' },
  });
  check(transfer, {
    'transfer NFT rejects incomplete request or unavailable blockchain config': (response) =>
      response.status === 400 || response.status === 503,
  });

  sleep(1);
}
