import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './lib/config.js';

export const options = {
  scenarios: {
    public_read_paths: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:health}': ['p(95)<300'],
    'http_req_duration{name:events_list}': ['p(95)<1200'],
    'http_req_duration{name:event_detail}': ['p(95)<1500'],
    'http_req_duration{name:nft_metadata}': ['p(95)<500'],
    'http_req_duration{name:nft_qr}': ['p(95)<1000'],
  },
};

const eventSlug = __ENV.EVENT_SLUG || '';
const nftContractAddress = __ENV.NFT_CONTRACT_ADDRESS || '';
const nftTokenId = __ENV.NFT_TOKEN_ID || '';

export default function () {
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(health, { 'health returns 200': (res) => res.status === 200 });

  const events = http.get(`${BASE_URL}/api/events`, { tags: { name: 'events_list' } });
  check(events, { 'events list returns 200': (res) => res.status === 200 });

  if (eventSlug) {
    const detail = http.get(`${BASE_URL}/api/events/${eventSlug}`, { tags: { name: 'event_detail' } });
    check(detail, { 'event detail returns 200': (res) => res.status === 200 });
  }

  if (nftContractAddress && nftTokenId) {
    const metadata = http.get(`${BASE_URL}/api/nft/metadata/${nftContractAddress}/${nftTokenId}`, {
      tags: { name: 'nft_metadata' },
    });
    check(metadata, { 'nft metadata returns 200': (res) => res.status === 200 });

    const qr = http.get(`${BASE_URL}/api/nft/qr/${nftContractAddress}/${nftTokenId}.png`, {
      tags: { name: 'nft_qr' },
    });
    check(qr, { 'nft qr returns png': (res) => res.status === 200 && String(res.headers['Content-Type']).includes('image/png') });
  }

  sleep(1);
}
