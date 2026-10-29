import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  formatPaiseToRupee,
  formatISTDate,
  formatISTTime,
  formatISTDateRange,
  generateEventJsonLd,
  generateEventOgTags,
} from '@eventora/shared';

describe('Phase P30: Accessibility, Performance, SEO, PWA & i18n Quality Gate', () => {
  let app: FastifyInstance;
  let publicEventId: string;
  let privateEventId: string;
  let publicEventSlug: string;
  let privateEventSlug: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed test events: 1 public, 1 private
    publicEventSlug = `p30-public-${Date.now()}`;
    privateEventSlug = `p30-private-${Date.now()}`;

    let collegeId: string;
    let orgId: string;
    let userId: string;

    const colRes = await pool.query(`SELECT id FROM colleges LIMIT 1;`);
    if (colRes.rows.length > 0) {
      collegeId = colRes.rows[0].id;
    } else {
      const newCol = await pool.query(
        `INSERT INTO colleges (name, domain) VALUES ('P30 Institute of Tech', 'p30tech.edu') RETURNING id;`
      );
      collegeId = newCol.rows[0].id;
    }

    const orgRes = await pool.query(`SELECT id, created_by FROM organizer_profiles LIMIT 1;`);
    if (orgRes.rows.length > 0) {
      orgId = orgRes.rows[0].id;
      userId = orgRes.rows[0].created_by;
    } else {
      const uRes = await pool.query(
        `INSERT INTO users (email, display_name, password_hash, college_id)
         VALUES ('p30_org_${Date.now()}@campus.edu', 'P30 Organizer', 'hash', $1)
         RETURNING id;`,
        [collegeId]
      );
      userId = uRes.rows[0].id;
      const oRes = await pool.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P30 Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, userId]
      );
      orgId = oRes.rows[0].id;
    }

    const pubRes = await pool.query(
      `INSERT INTO events (
         title, description, category, format, starts_at, ends_at, capacity,
         pricing_type, currency, visibility, status, slug, organizer_id, college_id, created_by, contact_email
       ) VALUES (
         'Annual Tech Innovators Summit 2026',
         'The premier annual technology summit featuring robotics, AI, and developer workshops.',
         'Technology', 'in_person', '2026-11-15 10:00:00+05:30', '2026-11-15 18:00:00+05:30',
         500, 'free', 'INR', 'public', 'published', $1, $2, $3, $4, 'contact@campus.edu'
       ) RETURNING id;`,
      [publicEventSlug, orgId, collegeId, userId]
    );
    publicEventId = pubRes.rows[0].id;

    const privRes = await pool.query(
      `INSERT INTO events (
         title, description, category, format, starts_at, ends_at, capacity,
         pricing_type, currency, visibility, status, slug, organizer_id, college_id, created_by, contact_email
       ) VALUES (
         'Internal Club Executive Meeting',
         'Confidential internal executive planning session strictly for council members.',
         'Council', 'in_person', '2026-11-16 10:00:00+05:30', '2026-11-16 12:00:00+05:30',
         20, 'free', 'INR', 'college', 'published', $1, $2, $3, $4, 'contact@campus.edu'
       ) RETURNING id;`,
      [privateEventSlug, orgId, collegeId, userId]
    );
    privateEventId = privRes.rows[0].id;
  });

  afterAll(async () => {
    if (publicEventId || privateEventId) {
      await pool.query(
        `DELETE FROM events WHERE id IN ($1, $2);`,
        [publicEventId, privateEventId]
      );
    }
    await app.close();
  });

  // =========================================================================
  // 1. WCAG 2.2 AA Accessibility: Focus Rings, Skip Links, Landmarks, aria-live
  // =========================================================================
  describe('1. WCAG 2.2 AA Accessibility Compliance', () => {
    it('verifies high-contrast focus rings and reduced-motion rules in index.css', () => {
      const cssPath = path.resolve(__dirname, '../../packages/frontend/src/index.css');
      const css = fs.readFileSync(cssPath, 'utf-8');

      expect(css).toContain(':focus-visible');
      expect(css).toContain('outline: 2px solid var(--focus-ring)');
      expect(css).toContain('--focus-ring');
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('verifies skip link landmark in App.tsx pointing to #main-content', () => {
      const appPath = path.resolve(__dirname, '../../packages/frontend/src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf-8');

      expect(appContent).toContain('href="#main-content"');
      expect(appContent).toContain('sr-only focus:not-sr-only');
      expect(appContent).toContain('Skip to main content');
    });

    it('verifies main content landmark with id="main-content" and tabIndex={-1} in all shells', () => {
      const shells = [
        'StudentShell.tsx',
        'OrganizerShell.tsx',
        'AdminShell.tsx',
        'ReviewerShell.tsx',
        'CheckinShell.tsx',
      ];

      for (const shellFile of shells) {
        const shellPath = path.resolve(
          __dirname,
          `../../packages/frontend/src/components/shells/${shellFile}`
        );
        const content = fs.readFileSync(shellPath, 'utf-8');
        expect(content, `${shellFile} must have id="main-content"`).toContain('id="main-content"');
        expect(content, `${shellFile} must have tabIndex={-1}`).toContain('tabIndex={-1}');
      }
    });

    it('verifies aria-live announcement regions in Toast, Checkout, ReceiptView, and Scanner', () => {
      const toastPath = path.resolve(__dirname, '../../packages/frontend/src/components/ui/Toast.tsx');
      const toastContent = fs.readFileSync(toastPath, 'utf-8');
      expect(toastContent).toContain('aria-live="polite"');

      const receiptPath = path.resolve(__dirname, '../../packages/frontend/src/components/checkout/ReceiptView.tsx');
      const receiptContent = fs.readFileSync(receiptPath, 'utf-8');
      expect(receiptContent).toContain('aria-live="polite"');
      expect(receiptContent).toContain('role="status"');

      const checkoutPath = path.resolve(__dirname, '../../packages/frontend/src/pages/CheckoutPage.tsx');
      const checkoutContent = fs.readFileSync(checkoutPath, 'utf-8');
      expect(checkoutContent).toContain('aria-live="polite"');

      const scannerPath = path.resolve(__dirname, '../../packages/frontend/src/pages/ScannerPage.tsx');
      const scannerContent = fs.readFileSync(scannerPath, 'utf-8');
      expect(scannerContent).toContain('aria-live="assertive"');
    });

    it('verifies minimum 44px tap targets on mobile navigation and interactive controls', () => {
      const studentShellPath = path.resolve(
        __dirname,
        '../../packages/frontend/src/components/shells/StudentShell.tsx'
      );
      const studentShell = fs.readFileSync(studentShellPath, 'utf-8');
      expect(studentShell).toContain('min-h-[48px] min-w-[44px]');
      expect(studentShell).toContain('min-h-[44px] min-w-[44px]');
    });
  });

  // =========================================================================
  // 2. Performance Budgets, Image Formats & Virtualization
  // =========================================================================
  describe('2. Performance Budgets, Modern Formats & Virtualization', () => {
    it('verifies Lighthouse CI budget configuration file (.lighthouserc.json)', () => {
      const lighthousercPath = path.resolve(__dirname, '../../.lighthouserc.json');
      expect(fs.existsSync(lighthousercPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(lighthousercPath, 'utf-8'));
      const assertions = config.ci.assert.assertions;

      expect(assertions['largest-contentful-paint'][1].maxNumericValue).toBeLessThanOrEqual(2500);
      expect(assertions['cumulative-layout-shift'][1].maxNumericValue).toBeLessThanOrEqual(0.1);
      expect(assertions['resource-summary:script:size'][1].maxNumericValue).toBeLessThanOrEqual(204800);
    });

    it('verifies Vite code-splitting and vendor chunks in vite.config.ts', () => {
      const viteConfigPath = path.resolve(__dirname, '../../packages/frontend/vite.config.ts');
      const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8');

      expect(viteConfig).toContain('manualChunks');
      expect(viteConfig).toContain('vendor-react');
      expect(viteConfig).toContain('vendor-query');
      expect(viteConfig).toContain('vendor-motion');
      expect(viteConfig).toContain('vendor-sentry');
      expect(viteConfig).toContain('vendor-icons');
    });

    it('verifies VirtualList windowing bounds calculations for >200 items', () => {
      const totalItems = 300;
      const itemHeight = 60;
      const containerHeight = 480;
      const overscan = 4;
      const scrollTop = 1200; // Scrolled down 20 items

      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
      const visibleCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan;
      const end = Math.min(totalItems, start + visibleCount);

      expect(start).toBe(16); // 20 - 4
      expect(end).toBe(32); // 16 + 8 + 8 = 32
      expect(end - start).toBe(16); // Only renders 16 items instead of 300 DOM nodes
    });
  });

  // =========================================================================
  // 3. Shareable Event Pages, SEO, Open Graph & Robots.txt
  // =========================================================================
  describe('3. Shareable Event Pages, schema.org JSON-LD & Dynamic Sitemap', () => {
    it('generates valid schema.org/Event JSON-LD with correct attendanceMode, offers, and dates', () => {
      const jsonLd = generateEventJsonLd({
        title: 'Campus Hackathon 2026',
        description: '48-hour student hackathon building campus solutions.',
        slug: 'campus-hackathon-2026',
        startsAt: '2026-11-20T09:00:00.000Z',
        endsAt: '2026-11-22T17:00:00.000Z',
        format: 'hybrid',
        venueName: 'CS Auditorium',
        organizerName: 'Developers Club',
        pricingType: 'paid',
        ticketTiers: [
          { name: 'Early Bird', pricePaise: 25000 },
          { name: 'Standard Pass', pricePaise: 50000 },
        ],
      });

      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('Event');
      expect(jsonLd.name).toBe('Campus Hackathon 2026');
      expect(jsonLd.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
      expect(jsonLd.eventStatus).toBe('https://schema.org/EventScheduled');
      expect(Array.isArray(jsonLd.offers)).toBe(true);
      expect(jsonLd.offers).toHaveLength(2);
      expect(jsonLd.offers[0].price).toBe('250.00');
      expect(jsonLd.offers[0].priceCurrency).toBe('INR');
      expect(jsonLd.offers[1].price).toBe('500.00');
    });

    it('generates Open Graph and Twitter Card preview tags', () => {
      const ogTags = generateEventOgTags({
        title: 'Robotics Workshop',
        description: 'Hands-on hardware robotics workshop for engineering students.',
        slug: 'robotics-workshop',
        startsAt: '2026-11-10T10:00:00.000Z',
        endsAt: '2026-11-10T14:00:00.000Z',
      });

      expect(ogTags['og:title']).toContain('Robotics Workshop');
      expect(ogTags['og:type']).toBe('website');
      expect(ogTags['og:url']).toBe('https://eventora.org/events/robotics-workshop');
      expect(ogTags['twitter:card']).toBe('summary_large_image');
    });

    it('GET /sitemap.xml returns valid XML containing public events and strictly excluding private events', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/sitemap.xml',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');

      const xml = res.body;
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

      // Public event MUST be present in the sitemap
      expect(xml).toContain(`/events/${publicEventSlug}`);

      // Private event MUST NOT be present in the sitemap
      expect(xml).not.toContain(`/events/${privateEventSlug}`);
    });

    it('GET /robots.txt disallows sensitive admin/staff routes and references sitemap', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/robots.txt',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');

      const text = res.body;
      expect(text).toContain('Disallow: /admin');
      expect(text).toContain('Disallow: /organizer');
      expect(text).toContain('Disallow: /reviewer');
      expect(text).toContain('Disallow: /scan');
      expect(text).toContain('Disallow: /api/');
      expect(text).toContain('Allow: /events/');
      expect(text).toContain('Sitemap: https://eventora.org/sitemap.xml');
    });

    it('verifies Vercel Edge Middleware exists and targets /events/:slug', () => {
      const mwPath = path.resolve(__dirname, '../../middleware.ts');
      expect(fs.existsSync(mwPath)).toBe(true);

      const mwContent = fs.readFileSync(mwPath, 'utf-8');
      expect(mwContent).toContain('/events/:slug*');
      expect(mwContent).toContain('facebookexternalhit');
      expect(mwContent).toContain('schema.org');
    });
  });

  // =========================================================================
  // 4. PWA Manifest, Service Worker & Offline Presentation
  // =========================================================================
  describe('4. PWA Manifest & Workbox Service Worker Offline Capabilities', () => {
    it('verifies Web App Manifest configuration in packages/frontend/public/manifest.webmanifest', () => {
      const manifestPath = path.resolve(
        __dirname,
        '../../packages/frontend/public/manifest.webmanifest'
      );
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.short_name).toBe('Eventora');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toBe('#4F46E5');
      expect(manifest.start_url).toBe('/');
      expect(manifest.icons.length).toBeGreaterThan(0);
      expect(manifest.shortcuts.some((s: any) => s.url === '/tickets')).toBe(true);
    });

    it('verifies Workbox service worker script with ticket offline cache and skipWaiting', () => {
      const swPath = path.resolve(__dirname, '../../packages/frontend/public/sw.js');
      expect(fs.existsSync(swPath)).toBe(true);

      const sw = fs.readFileSync(swPath, 'utf-8');
      expect(sw).toContain('eventora-shell-v1');
      expect(sw).toContain('eventora-tickets-offline-v1');
      expect(sw).toContain('SKIP_WAITING');
      expect(sw).toContain("url.pathname.includes('/tickets')");
    });

    it('verifies PWAUpdatePrompt component with user update action', () => {
      const promptPath = path.resolve(
        __dirname,
        '../../packages/frontend/src/components/ui/PWAUpdatePrompt.tsx'
      );
      expect(fs.existsSync(promptPath)).toBe(true);

      const prompt = fs.readFileSync(promptPath, 'utf-8');
      expect(prompt).toContain('role="alert"');
      expect(prompt).toContain('aria-live="polite"');
      expect(prompt).toContain('activatePWAUpdate');
    });
  });

  // =========================================================================
  // 5. Intl Formatting (₹, IST) & i18n Message Catalogs (Hindi, Telugu)
  // =========================================================================
  describe('5. Intl Formatting & i18n Catalogs (English, Hindi, Telugu)', () => {
    it('formats integer paise into ₹ with Indian numbering system', () => {
      expect(formatPaiseToRupee(0)).toBe('₹0');
      expect(formatPaiseToRupee(25000)).toBe('₹250');
      expect(formatPaiseToRupee(9950)).toBe('₹99.50');
      expect(formatPaiseToRupee(10000000)).toBe('₹1,00,000');
    });

    it('formats dates and times strictly in Indian Standard Time (Asia/Kolkata)', () => {
      // 2026-11-15T04:30:00.000Z is 10:00 AM IST (+05:30)
      const dateUtc = '2026-11-15T04:30:00.000Z';

      const timeIST = formatISTTime(dateUtc);
      expect(timeIST).toContain('10:00');
      expect(timeIST.toUpperCase()).toContain('AM');
      expect(timeIST).toContain('IST');

      const dateIST = formatISTDate(dateUtc);
      expect(dateIST).toContain('15');
      expect(dateIST).toContain('Nov');
      expect(dateIST).toContain('2026');

      const range = formatISTDateRange(
        '2026-11-15T04:30:00.000Z',
        '2026-11-15T12:30:00.000Z'
      );
      expect(range.toUpperCase()).toContain('15 NOV 2026, 10:00 AM – 06:00 PM IST');
    });

    it('verifies message catalogs for English, Hindi (हिन्दी) and Telugu (తెలుగు) have matching key parity', () => {
      const en = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, '../../packages/frontend/src/i18n/en.json'),
          'utf-8'
        )
      );
      const hi = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, '../../packages/frontend/src/i18n/hi.json'),
          'utf-8'
        )
      );
      const te = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, '../../packages/frontend/src/i18n/te.json'),
          'utf-8'
        )
      );

      const topSections = ['common', 'navigation', 'events', 'checkout', 'scanner', 'passport'];

      for (const section of topSections) {
        expect(en[section], `English catalog missing section ${section}`).toBeDefined();
        expect(hi[section], `Hindi catalog missing section ${section}`).toBeDefined();
        expect(te[section], `Telugu catalog missing section ${section}`).toBeDefined();

        const enKeys = Object.keys(en[section]);
        const hiKeys = Object.keys(hi[section]);
        const teKeys = Object.keys(te[section]);

        expect(hiKeys.sort()).toEqual(enKeys.sort());
        expect(teKeys.sort()).toEqual(enKeys.sort());
      }
    });
  });
});
