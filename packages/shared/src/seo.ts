/**
 * Eventora SEO & Structured Data Utilities
 *
 * Implements schema.org/Event JSON-LD generation and Open Graph / Twitter Card
 * meta tags for shareable public campus event pages.
 */

export interface EventSeoInput {
  title: string;
  description: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  format?: 'in_person' | 'online' | 'hybrid';
  venueName?: string | null;
  venueAddress?: string | null;
  onlineUrl?: string | null;
  imageUrl?: string | null;
  organizerName?: string | null;
  pricingType?: 'free' | 'paid';
  ticketTiers?: Array<{
    name: string;
    pricePaise: number;
    capacity?: number;
  }>;
  status?: string;
  baseUrl?: string;
  visibility?: 'college' | 'public';
}

/**
 * Generates valid schema.org/Event JSON-LD object for Google and structured data crawlers.
 */
export function generateEventJsonLd(event: EventSeoInput): Record<string, any> {
  const baseUrl = event.baseUrl || 'https://eventora.org';
  const eventUrl = `${baseUrl}/events/${event.slug}`;

  // Map attendance mode
  let eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
  if (event.format === 'online') {
    eventAttendanceMode = 'https://schema.org/OnlineEventAttendanceMode';
  } else if (event.format === 'hybrid') {
    eventAttendanceMode = 'https://schema.org/MixedEventAttendanceMode';
  }

  // Map event status
  let eventStatus = 'https://schema.org/EventScheduled';
  if (event.status === 'cancelled') {
    eventStatus = 'https://schema.org/EventCancelled';
  } else if (event.status === 'postponed') {
    eventStatus = 'https://schema.org/EventPostponed';
  }

  // Location configuration
  const location: any[] = [];
  if (event.format !== 'online') {
    location.push({
      '@type': 'Place',
      name: event.venueName || 'Campus Venue',
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.venueAddress || 'Campus Auditorium',
        addressCountry: 'IN',
      },
    });
  }
  if (event.format === 'online' || event.format === 'hybrid') {
    location.push({
      '@type': 'VirtualLocation',
      url: event.onlineUrl || eventUrl,
    });
  }

  // Offers configuration from ticket tiers or default free
  const offers: any[] = [];
  if (event.ticketTiers && event.ticketTiers.length > 0) {
    for (const tier of event.ticketTiers) {
      offers.push({
        '@type': 'Offer',
        name: tier.name,
        price: (tier.pricePaise / 100).toFixed(2),
        priceCurrency: 'INR',
        availability: 'https://schema.org/InStock',
        url: eventUrl,
        validFrom: event.startsAt,
      });
    }
  } else {
    offers.push({
      '@type': 'Offer',
      price: '0.00',
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      url: eventUrl,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.description,
    url: eventUrl,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus,
    eventAttendanceMode,
    location: location.length === 1 ? location[0] : location,
    image: event.imageUrl ? [event.imageUrl] : [`${baseUrl}/og-default.png`],
    organizer: {
      '@type': 'Organization',
      name: event.organizerName || 'Eventora Campus Club',
      url: baseUrl,
    },
    offers: offers.length === 1 ? offers[0] : offers,
  };
}

/**
 * Generates OpenGraph and Twitter Card meta tag key-value pairs for social preview sharing.
 */
export function generateEventOgTags(event: EventSeoInput): Record<string, string> {
  const baseUrl = event.baseUrl || 'https://eventora.org';
  const eventUrl = `${baseUrl}/events/${event.slug}`;
  const image = event.imageUrl || `${baseUrl}/og-default.png`;

  return {
    'og:title': `${event.title} | Eventora`,
    'og:description': event.description.length > 160 ? `${event.description.slice(0, 157)}...` : event.description,
    'og:url': eventUrl,
    'og:type': 'website',
    'og:image': image,
    'og:image:alt': event.title,
    'twitter:card': 'summary_large_image',
    'twitter:title': `${event.title} | Eventora`,
    'twitter:description': event.description.length > 160 ? `${event.description.slice(0, 157)}...` : event.description,
    'twitter:image': image,
  };
}
