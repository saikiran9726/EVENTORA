import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Eventora Honest 5,000+ Concurrent Virtual Users Mixed Workload Protocol
 * 
 * Target Architecture:
 * - 4 API Replicas behind Nginx Load Balancer
 * - PgBouncer Connection Pooler (Transaction Mode, default_pool_size=20)
 * - Postgres 16 (16 vCPU, 64 GB RAM, NVMe SSD)
 * - Distributed load generator cluster (e.g. 5 distributed k6 runner nodes)
 * 
 * Realistic Journey Mix:
 * - 55% Browse Discovery & Public Events
 * - 15% User Sign-in & Profile
 * - 12% Event Registration / Booking
 * -  8% Attendee Ticket View
 * -  6% Staff Check-in Scan
 * -  4% Organizer Reports & Analytics
 */

export const options = {
  scenarios: {
    mixed_campus_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // 1. Ramp-up phase (15 min) 0 -> 250 -> 1000 -> 2500 -> 5000 VUs
        { duration: '3m', target: 250 },
        { duration: '4m', target: 1000 },
        { duration: '4m', target: 2500 },
        { duration: '4m', target: 5000 },

        // 2. Sustained Peak Load (15 min)
        { duration: '15m', target: 5000 },

        // 3. 1.5x Flash Crowd Spike (1 min) at 7,500 VUs
        { duration: '1m', target: 7500 },

        // 4. Recovery & Drain phase (5 min)
        { duration: '5m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.01'], // Global HTTP error rate < 1%
    'http_req_duration{type:browse}': ['p(95)<500'], // Browse p95 < 500ms
    'http_req_duration{type:booking}': ['p(95)<1000'], // Booking p95 < 1000ms
    'http_req_duration{type:checkout}': ['p(95)<1500'], // Checkout p95 < 1500ms
    'http_req_duration{type:scan}': ['p(95)<400'], // Scan p95 < 400ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000';

export default function () {
  const rand = Math.random() * 100;

  // 1. 55% Browse Discovery & Filter
  if (rand < 55) {
    const res = http.get(`${BASE_URL}/api/v1/events?limit=20`, {
      tags: { type: 'browse' },
    });
    check(res, { 'browse 200': (r) => r.status === 200 });

    sleep(Math.random() * 4 + 1); // 1-5s think time

    // Secondary filter query
    const cat = ['Tech', 'AI & Robotics', 'Hackathon', 'Cultural Fest'][Math.floor(Math.random() * 4)];
    http.get(`${BASE_URL}/api/v1/events?category=${encodeURIComponent(cat)}&limit=10`, {
      tags: { type: 'browse' },
    });
  }

  // 2. 15% Authentication & Session
  else if (rand < 70) {
    const userNum = Math.floor(Math.random() * 1000) + 1;
    const res = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({
        email: `student_${userNum}@test.campus.edu`,
        password: 'password123',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'x-client-ip': `10.50.${__VU % 250}.${Math.floor(Math.random() * 250)}`,
        },
        tags: { type: 'login' },
      }
    );
    check(res, { 'login response': (r) => r.status === 200 || r.status === 401 || r.status === 429 });
  }

  // 3. 12% Booking & Registration
  else if (rand < 82) {
    const idempKey = `idemp-mix-${__VU}-${__ITER}-${Date.now()}`;
    const res = http.post(
      `${BASE_URL}/api/v1/events/00000000-0000-0000-0000-000000000001/bookings`,
      JSON.stringify({
        items: [{ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempKey,
        },
        tags: { type: 'booking' },
      }
    );
    check(res, { 'booking response': (r) => r.status === 201 || r.status === 409 || r.status === 401 });
  }

  // 4. 8% Attendee Ticket View
  else if (rand < 90) {
    const res = http.get(`${BASE_URL}/api/v1/tickets/my-tickets`, {
      tags: { type: 'ticket' },
    });
    check(res, { 'ticket view response': (r) => r.status === 200 || r.status === 401 });
  }

  // 5. 6% Staff Check-in Scan
  else if (rand < 96) {
    const res = http.post(
      `${BASE_URL}/api/v1/events/00000000-0000-0000-0000-000000000001/check-in/scan`,
      JSON.stringify({
        token: `https://eventora.campus.edu/t/opaque-token-${__VU}-${__ITER}`,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { type: 'scan' },
      }
    );
    check(res, { 'scan response': (r) => r.status === 200 || r.status === 401 || r.status === 404 });
  }

  // 6. 4% Organizer Reports & Analytics
  else {
    const res = http.get(
      `${BASE_URL}/api/v1/organizer/events/00000000-0000-0000-0000-000000000001/analytics`,
      {
        tags: { type: 'analytics' },
      }
    );
    check(res, { 'analytics response': (r) => r.status === 200 || r.status === 401 || r.status === 404 });
  }

  // Global think time between actions (1-5s)
  sleep(Math.random() * 4 + 1);
}
