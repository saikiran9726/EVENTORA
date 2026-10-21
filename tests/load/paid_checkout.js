import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 30 },
    { duration: '30s', target: 100 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'], // checkout p95 < 1.5s
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';

export default function () {
  const bookingId = `bkg-load-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    amountPaise: 25000,
    currency: 'INR',
  });

  const res = http.post(`${BASE_URL}/api/v1/bookings/${bookingId}/checkout`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'checkout handled gracefully': (r) => r.status === 200 || r.status === 401 || r.status === 404,
  });

  sleep(Math.random() * 3 + 1);
}
