import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase P32: k6 Load Test Suite & Threshold Verification', () => {
  const loadDir = path.resolve(__dirname, '../load');

  const requiredScripts = [
    {
      file: 'last_seats.js',
      scenario: 'last_seats (high concurrency booking holds for remaining capacity)',
      expectedThresholds: ['http_req_failed', 'http_req_duration'],
      p95MaxMs: 1000,
    },
    {
      file: 'paid_checkout.js',
      scenario: 'paid_checkout (concurrent checkout order initialization)',
      expectedThresholds: ['http_req_failed', 'http_req_duration'],
      p95MaxMs: 1500,
    },
    {
      file: 'checkin_burst.js',
      scenario: 'checkin_burst (turnstile gate burst arrival scanning)',
      expectedThresholds: ['http_req_failed', 'http_req_duration'],
      p95MaxMs: 400,
    },
    {
      file: 'login_burst.js',
      scenario: 'login_burst (campus morning login rush)',
      expectedThresholds: ['http_req_failed', 'http_req_duration'],
      p95MaxMs: 800,
    },
  ];

  for (const { file, scenario, expectedThresholds, p95MaxMs } of requiredScripts) {
    it(`verifies k6 load test configuration for ${scenario}`, () => {
      const filePath = path.join(loadDir, file);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');

      // Verify options export and stages
      expect(content).toContain('export const options');
      expect(content).toContain('stages:');
      expect(content).toContain('thresholds:');

      // Verify specific threshold metrics
      for (const t of expectedThresholds) {
        expect(content).toContain(t);
      }

      // Check p95 SLA
      const p95Match = content.match(/p\(95\)<(\d+)/);
      expect(p95Match).not.toBeNull();
      if (p95Match) {
        const thresholdVal = parseInt(p95Match[1], 10);
        expect(thresholdVal).toBeLessThanOrEqual(p95MaxMs);
      }

      // Verify HTTP execution
      expect(content).toContain('http.post');
      expect(content).toContain('check(res');
    });
  }
});
