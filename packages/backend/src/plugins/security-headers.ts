import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export const securityHeadersPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onSend', async (_req, reply, payload) => {
    // 1. Strict Content Security Policy (No inline script execution allowed)
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"
    );

    // 2. Strict Transport Security (HSTS)
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // 3. MIME sniffing protection
    reply.header('X-Content-Type-Options', 'nosniff');

    // 4. Clickjacking frame denial
    reply.header('X-Frame-Options', 'DENY');

    // 5. Referrer Policy
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 6. Permissions Policy (Camera permitted for QR scanner UI only; camera=(self))
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');

    // 7. Cross-Origin Opener & Resource Policies
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    return payload;
  });
});
