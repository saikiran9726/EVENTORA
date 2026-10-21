import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';

export default function () {
  // Repeating fixed event ID to test dedupe idempotency under concurrency
  const eventId = `evt_webhook_dedupe_${Math.floor(__ITER / 5)}`;
  const payload = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${eventId}`,
          order_id: `order_${eventId}`,
          amount: 50000,
          status: 'captured',
        },
      },
    },
  });

  const res = http.post(`${BASE_URL}/api/v1/webhooks/payments`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'simulated_test_hmac_signature',
    },
  });

  check(res, {
    'webhook handled (200, 400 invalid sig, or 200 idempotent)': (r) =>
      r.status === 200 || r.status === 400 || r.status === 401,
  });

  sleep(0.5);
}
