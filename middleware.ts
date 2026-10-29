/**
 * Vercel Edge Middleware for Shareable Event Pages
 *
 * Intercepts requests to /events/:slug and social crawlers to inject:
 * 1. Open Graph (og:title, og:description, og:image, og:url, og:type)
 * 2. Twitter Card tags
 * 3. schema.org/Event JSON-LD structured metadata
 */

const BOT_USER_AGENTS = [
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'slackbot',
  'discordbot',
  'googlebot',
  'bingbot',
  'duckduckbot',
  'applebot',
  'yandexbot',
];

export const config = {
  matcher: ['/events/:slug*'],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
  const isBot = BOT_USER_AGENTS.some((bot) => userAgent.includes(bot));

  // Extract slug from /events/:slug
  const match = url.pathname.match(/^\/events\/([^/?#]+)/);
  if (!match) {
    return;
  }

  const slug = match[1];
  const apiUrl = process.env.API_BASE_URL || 'https://eventora-api-p35a.onrender.com';

  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${slug}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Eventora-Edge-Middleware/1.0',
      },
    });

    if (!res.ok) {
      return;
    }

    const json = await res.json();
    const event = json.event || json;

    if (!event || !event.title) {
      return;
    }

    // Only inject full HTML SSR tags for crawlers/bots; let standard users load SPA directly
    if (isBot) {
      const title = `${event.title} | Eventora`;
      const description = event.description
        ? event.description.length > 160
          ? `${event.description.slice(0, 157)}...`
          : event.description
        : 'Discover and register for campus events on Eventora.';
      const eventUrl = url.href;
      const imageUrl = event.cover_image_url || event.imageUrl || 'https://eventora.org/og-default.png';

      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.title,
        description: event.description || '',
        url: eventUrl,
        startDate: event.starts_at || event.startsAt,
        endDate: event.ends_at || event.endsAt,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode:
          event.format === 'online'
            ? 'https://schema.org/OnlineEventAttendanceMode'
            : event.format === 'hybrid'
            ? 'https://schema.org/MixedEventAttendanceMode'
            : 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: event.venue_name || event.venueName || 'Campus Venue',
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'IN',
          },
        },
        image: [imageUrl],
        organizer: {
          '@type': 'Organization',
          name: event.organizer_name || event.organizerName || 'Campus Organizer',
          url: 'https://eventora.org',
        },
        offers: {
          '@type': 'Offer',
          price: event.pricing_type === 'paid' ? 'Paid' : '0.00',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
          url: eventUrl,
        },
      };

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(eventUrl)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${escapeHtml(eventUrl)}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <!-- Schema.org Event JSON-LD -->
  <script type="application/ld+json">
    ${JSON.stringify(jsonLd)}
  </script>
</head>
<body>
  <h1>${escapeHtml(event.title)}</h1>
  <p>${escapeHtml(description)}</p>
  <p><a href="${escapeHtml(eventUrl)}">View Event Details on Eventora</a></p>
</body>
</html>`;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }
  } catch {
    // On any fetch or parsing error, continue to SPA
  }

  return;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
