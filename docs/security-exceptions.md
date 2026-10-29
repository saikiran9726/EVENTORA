# Security Exceptions & Deferred Vulnerabilities

This document records temporary user-authorized security audit risk exceptions configured in `package.json` under `pnpm.auditConfig.ignoreGhsas`.

All listed exceptions require breaking major framework or runtime migrations and cannot be resolved via non-breaking patch or minor releases.

- **Authorizing Role**: Repository Owner (`saikiran9726`)
- **Review Policy**: 30-Day Mandatory Review
- **Initial Review Date**: `2026-10-29`
- **Next Review Date**: `2026-11-28`

---

## Active Deferred High-Severity Advisories

| GHSA ID | Package | Installed Version | Patched Version | Deferred Reason | Owner | Next Review Date |
|---|---|---|---|---|---|---|
| **`GHSA-jx2c-rxcm-jvmq`** | `fastify` | `4.29.1` | `>=5.7.2` | Fastify v5 major migration required (breaking changes to plugin encapsulation and hook contracts) | `saikiran9726` | `2026-11-28` |
| **`GHSA-c96f-x56v-gq3h`** | `find-my-way` | `8.2.2` | `>=9.7.0` | Bundled dependency of Fastify 4.x; resolved with Fastify v5 major migration | `saikiran9726` | `2026-11-28` |
| **`GHSA-667r-xxjv-c9mm`** | `fastify` | `4.29.1` | `>=5.12.2` | Fastify v5 major migration required | `saikiran9726` | `2026-11-28` |
| **`GHSA-p68q-wchp-6fh7`** | `fastify` | `4.29.1` | `>=5.12.2` | Fastify v5 major migration required | `saikiran9726` | `2026-11-28` |
| **`GHSA-hwr6-493r-vm6h`** | `fastify` | `4.29.1` | `>=5.12.2` | Fastify v5 major migration required | `saikiran9726` | `2026-11-28` |
| **`GHSA-9q9j-q6p8-xq58`** | `fastify` | `4.29.1` | `>=5.12.2` | Fastify v5 major migration required | `saikiran9726` | `2026-11-28` |
| **`GHSA-mrhx-c7xc-m3w5`** | `zod` | `3.23.8` | `>=4.6.6` | Zod v4 major migration required (breaking schema API changes, incompatible with `@hookform/resolvers@6.0.0` and `fastify-type-provider-zod@2.1.0`) | `saikiran9726` | `2026-11-28` |

---

## Action Plan for Review Date (2026-11-28)

1. **Fastify v5 Migration Sprint**:
   - Upgrade Fastify from `4.29.1` to `>=5.12.2`.
   - Upgrade Fastify plugins (`@fastify/cors`, `@fastify/cookie`, `@fastify/swagger`, `fastify-type-provider-zod`).
   - Re-test all route policy hooks, objectCheck middleware, and SSE stream handlers.
2. **Zod v4 Migration Sprint**:
   - Upgrade Zod from `3.23.8` to `>=4.6.6` once ecosystem adapters (`fastify-type-provider-zod`, `@hookform/resolvers`) release official v4 compatibility bridges.
   - Run full regression tests on `packages/shared/src/form.ts` dynamic schemas.
