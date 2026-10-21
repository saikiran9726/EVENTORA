# Eventora — Dependency & Architecture Plan

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf` (Page 10, 26, 46)

---

## 1. Monorepo Dependency Matrix

| Package / Workspace | Core Dependencies | Dev Dependencies | Architecture Role |
| :--- | :--- | :--- | :--- |
| **Root** | Workspace orchestration (`pnpm`) | `vitest`, `@playwright/test`, `@axe-core/playwright`, `typescript`, `eslint` | Monorepo root, CI testing orchestration, cross-cutting linting |
| **`@eventora/shared`** | `zod` | `typescript` | Pure shared schemas, canonical role definitions, design tokens, standard error envelope |
| **`@eventora/frontend`** | `react`, `react-dom`, `clsx`, `tailwind-merge`, `lucide-react`, `framer-motion`, `react-hook-form`, `zod` | `vite`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `typescript` | Responsive React PWA, accessible UI components, role-aware shells |
| **`@eventora/backend`** *(Phase 2)* | `fastify`, `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`, `argon2`, `drizzle-orm`, `pg`, `zod`, `pino` | `drizzle-kit`, `@types/pg`, `typescript`, `tsx` | Fastify Node 20 modular monolith REST API, Drizzle ORM migrations, deny-by-default routing |
| **`@eventora/worker`** *(Phase 2/4)* | `bullmq`, `ioredis`, `drizzle-orm`, `pg`, `pino` | `typescript`, `tsx` | Background async processor, transactional outbox dispatcher, email/certificate jobs |

---

## 2. Dependency Security & Version Locking Policy

1. **Strict Versioning**: Monorepo uses `pnpm-lock.yaml` with frozen lockfile enforcement in CI.
2. **Built Script Approvals**: Only approved binaries (`esbuild`) are permitted execution during `pnpm install` via `.npmrc` configuration.
3. **No Frontend Secrets**: Database connection strings, Argon2 salts, session secrets, and payment simulator HMAC keys are strictly confined to `@eventora/backend` and `@eventora/worker` server-side runtime environments.
4. **Vulnerability Auditing**: `pnpm audit` run regularly to prevent known vulnerable subdependencies.
