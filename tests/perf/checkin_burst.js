import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics for Phase 6 Non-Negotiables
export const acceptedScans = new Counter('accepted_scans');
export const duplicateScans = new Counter('duplicate_scans');
export const errorScans = new Counter('error_scans');
export const scanLatency = new Trend('scan_latency');

export const options = {
  scenarios: {
    checkin_burst: {
      executor: 'constant-arrival-rate',
      rate: 300, // 300 scans / second burst
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 150,
    },
  },
  thresholds: {
    // p95 scan response time < 300ms under heavy burst
    'http_req_duration': ['p(95)<300'],
    // Scan error rate < 5%
    'http_req_failed': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const EVENT_ID = __ENV.EVENT_ID || '00000000-0000-0000-0000-000000000001';
const STAFF_AUTH_TOKEN = __ENV.STAFF_AUTH_TOKEN || 'session_token_perf_test';

export default function () {
  const token = `TCK_PERF_BURST_${Date.now()}_${__VU}_${__ITER}`;

  const payload = JSON.stringify({
    token: `https://eventora.campus.edu/t/${token.padEnd(43, '0').slice(0, 43)}`,
    deviceId: `turnstile-gate-${__VU}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${STAFF_AUTH_TOKEN}`,
      'X-CSRF-Token': 'csrf-token-perf',
    },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/events/${EVENT_ID}/check-in/scan`, payload, params);
  scanLatency.add(Date.now() - startTime);

  if (res.status === 200) {
    const body = res.json();
    if (body.outcome === 'ACCEPTED') {
      acceptedScans.add(1);
    } else if (body.outcome === 'DUPLICATE') {
      duplicateScans.add(1);
    }
  } else if (res.status === 400 || res.status === 403 || res.status === 429) {
    // Expected client status codes for rate limit or unassigned
    check(res, {
      'status is expected client code': (r) => [400, 403, 429].includes(r.status),
    });
  } else {
    errorScans.add(1);
  }
}
