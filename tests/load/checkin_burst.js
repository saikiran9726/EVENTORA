import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 50 },
    { duration: '30s', target: 150 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<400'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';
const EVENT_ID = __ENV.EVENT_ID || '00000000-0000-0000-0000-000000000001';

export default function () {
  const token = `https://eventora.campus.edu/t/opaque-token-sample-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    token,
  });

  const res = http.post(`${BASE_URL}/api/v1/events/${EVENT_ID}/check-in/scan`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'handled check-in scan': (r) => r.status === 200 || r.status === 401 || r.status === 404,
  });

  sleep(Math.random() * 2 + 0.5);
}
