import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 50 },
    { duration: '40s', target: 150 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'], // login burst allowing rate limiter checks
    http_req_duration: ['p(95)<800'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';

export default function () {
  const userNum = Math.floor(Math.random() * 500) + 1;
  const payload = JSON.stringify({
    email: `student_${userNum}@test.campus.edu`,
    password: 'password123',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-client-ip': `10.10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/auth/login`, payload, params);

  check(res, {
    'status is 200 or 401/429': (r) => r.status === 200 || r.status === 401 || r.status === 429,
  });

  sleep(Math.random() * 3 + 1);
}
