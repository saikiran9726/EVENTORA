import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../../db/index.js';

export const seoRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /sitemap.xml (Public Dynamic Sitemap excluding private events)
  fastify.get(
    '/sitemap.xml',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const rawBase = (process.env.APP_BASE_URL || process.env.BASE_URL || '').trim();
      const baseUrl = rawBase.startsWith('http')
        ? rawBase.replace(/\/+$/, '')
        : 'https://eventora.org';

      // Strictly fetch only PUBLISHED, PUBLIC visibility events
      const query = `
        SELECT slug, created_at, starts_at
        FROM events
        WHERE status = 'published'
          AND visibility = 'public'
        ORDER BY created_at DESC
        LIMIT 5000;
      `;

      const { rows } = await pool.query(query);

      const staticUrls = [
        { loc: `${baseUrl}/`, priority: '1.0', changefreq: 'daily' },
        { loc: `${baseUrl}/discover`, priority: '0.9', changefreq: 'hourly' },
        { loc: `${baseUrl}/calendar`, priority: '0.8', changefreq: 'daily' },
        { loc: `${baseUrl}/privacy`, priority: '0.3', changefreq: 'monthly' },
        { loc: `${baseUrl}/terms`, priority: '0.3', changefreq: 'monthly' },
      ];

      const xmlEntries = [
        ...staticUrls.map(
          (item) => `  <url>
    <loc>${item.loc}</loc>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
        ),
        ...rows.map((row) => {
          const lastMod = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
          return `  <url>
    <loc>${baseUrl}/events/${row.slug}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`;
        }),
      ];

      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlEntries.join('\n')}
</urlset>`;

      reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600, s-maxage=3600')
        .send(sitemapXml);
    }
  );

  // 2. GET /robots.txt
  fastify.get(
    '/robots.txt',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const rawBase = (process.env.APP_BASE_URL || process.env.BASE_URL || '').trim();
      const baseUrl = rawBase.startsWith('http')
        ? rawBase.replace(/\/+$/, '')
        : 'https://eventora.org';
      const robotsTxt = `User-agent: *
Disallow: /admin
Disallow: /admin/
Disallow: /organizer
Disallow: /organizer/
Disallow: /reviewer
Disallow: /reviewer/
Disallow: /scan
Disallow: /scan/
Disallow: /api/
Allow: /
Allow: /events/
Allow: /discover
Allow: /calendar
Allow: /p/

Sitemap: ${baseUrl}/sitemap.xml
`;

      reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'public, max-age=86400, s-maxage=86400')
        .send(robotsTxt);
    }
  );
};
