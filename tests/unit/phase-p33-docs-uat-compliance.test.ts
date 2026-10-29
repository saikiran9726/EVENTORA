import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase P33 — Docs, UAT, Go-Live & Payments Compliance Verification', () => {
  const rootDir = path.resolve(__dirname, '../..');

  const requiredDocs = [
    'docs/go-live.md',
    'docs/asvs-l2-checklist.md',
    'docs/risk-register.md',
    'docs/rtm.csv',
    'docs/runbook.md',
    'docs/erd.md',
    'docs/api.md',
  ];

  const complianceSnippet =
    'YouPI-PG describes itself as an experimental research project, not bank/NPCI-approved or production-certified; ' +
    'it detects payments by parsing bank SMS/email alerts, suggests ≤ 20 payment attempts per day per receiving account, ' +
    'and serves one payer at a time per UPI ID. Collecting ticket money this way may raise bank, UPI, ' +
    "payment-aggregator, tax and consumer-protection questions — get qualified advice and your bank's written approval " +
    'before real-money use. Treat it as suitable for small, controlled, organizer-approved events behind the ' +
    'PAYMENT_PROVIDER flag with buyer disclosure and manual reconciliation; for large or public paid events add a licensed gateway ' +
    '(Razorpay/Cashfree/PhonePe PG) as a second adapter.';

  it('1. Verifies all required Phase P33 documentation files exist and are populated', () => {
    for (const doc of requiredDocs) {
      const fullPath = path.join(rootDir, doc);
      expect(fs.existsSync(fullPath), `Document ${doc} should exist on disk`).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content.length, `Document ${doc} should have substantial content`).toBeGreaterThan(500);
    }
  });

  it('2. Verifies exact payments compliance text is present in checklist and UI pages', () => {
    // Normalization helper: normalize whitespace and backticks/code tags
    const clean = (text: string) =>
      text
        .replace(/`PAYMENT_PROVIDER`/g, 'PAYMENT_PROVIDER')
        .replace(/<code[^>]*>PAYMENT_PROVIDER<\/code>/g, 'PAYMENT_PROVIDER')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

    const expectedClean = clean(complianceSnippet);

    // Checklist
    const asvsContent = fs.readFileSync(path.join(rootDir, 'docs/asvs-l2-checklist.md'), 'utf8');
    expect(clean(asvsContent)).toContain(expectedClean);

    // Organizer Dashboard Ledger Tab
    const organizerDashboard = fs.readFileSync(
      path.join(rootDir, 'packages/frontend/src/pages/OrganizerDashboardPage.tsx'),
      'utf8'
    );
    expect(clean(organizerDashboard)).toContain(expectedClean);

    // Create Event Page Paid Section
    const createEventPage = fs.readFileSync(
      path.join(rootDir, 'packages/frontend/src/pages/events/CreateEventPage.tsx'),
      'utf8'
    );
    expect(clean(createEventPage)).toContain(expectedClean);
  });

  it('3. Verifies docs/go-live.md covers the real-device matrix and strict ₹1 safety rules', () => {
    const goLive = fs.readFileSync(path.join(rootDir, 'docs/go-live.md'), 'utf8');

    // Real device testing matrix
    expect(goLive).toMatch(/Android.*Chrome.*camera/i);
    expect(goLive).toMatch(/iOS.*Safari/i);
    expect(goLive).toMatch(/low-end Android/i);
    expect(goLive).toMatch(/3G/i);

    // ₹1 safety rules
    expect(goLive).toMatch(/₹1(\.00)?/);
    expect(goLive).toMatch(/explicit.*permission/i);
    expect(goLive).toMatch(/NEVER by automated agent/i);
    expect(goLive).toMatch(/backup restore rehearsal/i);
    expect(goLive).toMatch(/secrets rotated/i);
    expect(goLive).toMatch(/no seed accounts/i);
    expect(goLive).toMatch(/alerts live/i);
    expect(goLive).toMatch(/rollback tested/i);
    expect(goLive).toMatch(/legal pages live/i);
  });

  it('4. Verifies docs/risk-register.md incorporates YouPI limits, mitigations and RTO/RPO', () => {
    const riskRegister = fs.readFileSync(path.join(rootDir, 'docs/risk-register.md'), 'utf8');

    expect(riskRegister).toMatch(/YouPI-PG/i);
    expect(riskRegister).toMatch(/20 payment attempts/i);
    expect(riskRegister).toMatch(/one payer at a time/i);
    expect(riskRegister).toMatch(/bank SMS\/email/i);
    expect(riskRegister).toMatch(/RPO.*15\s*minutes/i);
    expect(riskRegister).toMatch(/RTO.*1\s*hour/i);
  });

  it('5. Verifies docs/runbook.md specifies on-call schedule, secret rotation, restore evidence and rollback', () => {
    const runbook = fs.readFileSync(path.join(rootDir, 'docs/runbook.md'), 'utf8');

    expect(runbook).toMatch(/on-call/i);
    expect(runbook).toMatch(/credential rotation|secret.*rotation/i);
    expect(runbook).toMatch(/restore rehearsal/i);
    expect(runbook).toMatch(/RTO/i);
    expect(runbook).toMatch(/RPO/i);
    expect(runbook).toMatch(/rollback/i);
  });

  it('6. Verifies docs/rtm.csv tracks all requirements from P01 through P33', () => {
    const rtmContent = fs.readFileSync(path.join(rootDir, 'docs/rtm.csv'), 'utf8');
    const lines = rtmContent.trim().split('\n');

    expect(lines.length).toBeGreaterThanOrEqual(30);
    const headers = lines[0].split(',');
    expect(headers).toEqual([
      'ID',
      'requirement',
      'UI route',
      'API endpoint',
      'tables',
      'policy',
      'test IDs',
      'status',
      'evidence(commit+date)',
    ]);

    expect(rtmContent).toContain('FR-AUTH');
    expect(rtmContent).toContain('FR-EVENT');
    expect(rtmContent).toContain('FR-PAY');
    expect(rtmContent).toContain('FR-CHECKIN');
    expect(rtmContent).toContain('FR-OFFLINE');
    expect(rtmContent).toContain('FR-DOCS-UAT');
  });

  it('7. Verifies docs/erd.md contains comprehensive Mermaid diagram and table catalog', () => {
    const erdContent = fs.readFileSync(path.join(rootDir, 'docs/erd.md'), 'utf8');

    expect(erdContent).toContain('erDiagram');
    expect(erdContent).toContain('COLLEGES');
    expect(erdContent).toContain('USERS');
    expect(erdContent).toContain('EVENTS');
    expect(erdContent).toContain('TICKETS');
    expect(erdContent).toContain('BOOKINGS');
    expect(erdContent).toContain('PAYMENTS');
    expect(erdContent).toContain('OUTBOX');
  });

  it('8. Verifies docs/api.md details the standardized error envelope and route namespaces', () => {
    const apiDoc = fs.readFileSync(path.join(rootDir, 'docs/api.md'), 'utf8');

    expect(apiDoc).toContain('error');
    expect(apiDoc).toContain('code');
    expect(apiDoc).toContain('requestId');
    expect(apiDoc).toContain('/api/v1/auth');
    expect(apiDoc).toContain('/api/v1/events');
    expect(apiDoc).toContain('/api/v1/bookings');
    expect(apiDoc).toContain('/api/v1/payments');
  });
});
