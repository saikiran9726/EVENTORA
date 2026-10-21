import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '45s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';
const EVENT_ID = __ENV.EVENT_ID || '00000000-0000-0000-0000-000000000001';

export default function () {
  const payload = JSON.stringify({
    kind: 'venue',
    message: `Load test latency sample at ${Date.now()}`,
    severity: 'important',
  });

  const res = http.post(`${BASE_URL}/api/v1/events/${EVENT_ID}/alerts`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'alert dispatched or auth checked': (r) =>
      r.status === 200 || r.status === 201 || r.status === 401 || r.status === 403,
  });

  sleep(Math.random() * 2 + 1);
}
