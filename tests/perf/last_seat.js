import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Custom metrics to verify non-negotiables under heavy contention
export const confirmedCount = new Counter('confirmed_bookings');
export const soldOutCount = new Counter('sold_out_409');
export const unexpectedErrors = new Counter('unexpected_errors');

export const options = {
  scenarios: {
    last_seat_rush: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // Exactly 1 booking should be confirmed for the 1 remaining seat
    'confirmed_bookings': ['count==1'],
    // 499 should receive 409 Conflict (Sold Out / Waitlist Offered)
    'sold_out_409': ['count==499'],
    // Zero internal server errors (500) or race corruption
    'unexpected_errors': ['count==0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const EVENT_ID = __ENV.EVENT_ID || '11111111-1111-1111-1111-111111111111';
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID || '22222222-2222-2222-2222-222222222222';

export default function () {
  const vuId = __VU;
  const idempotencyKey = `k6-last-seat-vu-${vuId}-${Date.now()}`;

  const payload = JSON.stringify({
    items: [
      {
        ticketTypeId: TICKET_TYPE_ID,
        quantity: 1,
      },
    ],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      // In realistic testing, each VU has its authenticated session cookie
      'Cookie': `eventora_session=test_session_${vuId}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/events/${EVENT_ID}/bookings`, payload, params);

  if (res.status === 201) {
    confirmedCount.add(1);
    check(res, {
      'status is 201 CONFIRMED': (r) => r.status === 201,
      'has booking id': (r) => JSON.parse(r.body).booking !== undefined,
    });
  } else if (res.status === 409) {
    soldOutCount.add(1);
    check(res, {
      'status is 409 SOLD_OUT': (r) => r.status === 409,
    });
  } else {
    unexpectedErrors.add(1);
    console.error(`VU ${vuId} unexpected response: ${res.status} - ${res.body}`);
  }
}
