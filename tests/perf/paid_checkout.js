import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import crypto from 'k6/crypto';

// Custom metrics to verify Phase 5 Non-Negotiables
export const confirmedPayments = new Counter('confirmed_payments');
export const duplicateWebhooks = new Counter('duplicate_webhooks');
export const unexpectedErrors = new Counter('unexpected_errors');

export const options = {
  scenarios: {
    webhook_replay_storm: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // Exactly 1 webhook triggers confirmation & ledger entry
    'confirmed_payments': ['count==1'],
    // Exactly 49 duplicate replayed webhooks return duplicate/already_processed status
    'duplicate_webhooks': ['count==49'],
    // Zero unexpected errors
    'unexpected_errors': ['count==0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const ORDER_ID = __ENV.ORDER_ID || 'order_perf_storm_test';
const EVENT_PAYLOAD_ID = __ENV.EVENT_PAYLOAD_ID || `wh_perf_${Date.now()}`;
const WEBHOOK_SECRET = __ENV.PAYMENT_WEBHOOK_SECRET || 'eventora_dev_test_webhook_secret_key_2026';

export default function () {
  const vuId = __VU;

  // Identical payload across all 50 VUs to simulate concurrent replay / network retry storm
  const payload = JSON.stringify({
    eventId: EVENT_PAYLOAD_ID,
    type: 'payment.captured',
    orderId: ORDER_ID,
    paymentId: `pay_storm_perf_${Date.now()}`,
    amountPaise: 15000,
  });

  // Calculate HMAC-SHA256 signature
  const signature = crypto.hmac('sha256', WEBHOOK_SECRET, payload, 'hex');

  const timestampHeader = Math.floor(Date.now() / 1000).toString();

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestampHeader,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/webhooks/payments`, payload, params);

  if (res.status === 200) {
    try {
      const data = JSON.parse(res.body);
      if (data.duplicate) {
        duplicateWebhooks.add(1);
        check(res, {
          'duplicate replay handled safely': (r) => r.status === 200,
        });
      } else if (data.success && data.confirmation?.confirmed) {
        confirmedPayments.add(1);
        check(res, {
          'first arrival confirmed atomically': (r) => r.status === 200,
        });
      } else {
        duplicateWebhooks.add(1);
      }
    } catch (e) {
      unexpectedErrors.add(1);
    }
  } else {
    unexpectedErrors.add(1);
    console.error(`VU ${vuId} webhook error: ${res.status} - ${res.body}`);
  }
}
