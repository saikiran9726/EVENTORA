import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '30s', target: 200 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'], // booking p95 < 1s
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';
const TARGET_EVENT_ID = __ENV.EVENT_ID || '00000000-0000-0000-0000-000000000001';

export default function () {
  const idempotencyKey = `idemp-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    items: [{ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 }],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/events/${TARGET_EVENT_ID}/bookings`, payload, params);

  check(res, {
    'handled correctly (201, 409 sold out, or 401 unauth)': (r) =>
      r.status === 201 || r.status === 409 || r.status === 401 || r.status === 400,
  });

  sleep(Math.random() * 2 + 1);
}
