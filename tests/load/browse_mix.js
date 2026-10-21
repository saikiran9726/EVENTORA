import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% error rate
    http_req_duration: ['p(95)<500'], // browse p95 < 500ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';

export default function () {
  // 1. Fetch discovery list
  const res = http.get(`${BASE_URL}/api/v1/events?limit=20`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has events': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items || body.events);
      } catch {
        return false;
      }
    },
  });

  // 2. Think time 1-5s
  sleep(Math.random() * 4 + 1);

  // 3. Category filter query
  const catRes = http.get(`${BASE_URL}/api/v1/events?category=Tech&limit=10`);
  check(catRes, {
    'cat status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 3 + 1);
}
