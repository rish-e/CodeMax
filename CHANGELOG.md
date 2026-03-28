# Changelog

## [1.0.0] - 2026-03-28

### Added
- **Full-stack audit engine** — comprehensive cross-stack analysis with health scoring
- **API contract verification** — phantom calls, dead endpoints, method & field mismatches
- **Issue tracer** — bug attribution across frontend, backend, and cross-stack layers
- **Dependency mapper** — frontend-to-backend connection graph with orphan detection
- **Environment analyzer** — cross-references .env files against frontend & backend usage
- **Health scoring** — 0-100 score across 6 dimensions (contracts, errors, security, performance, data flow, environment)
- **Project detector** — auto-detects frameworks, monorepos, ORMs, and layer boundaries
- **Frontend scanner** — finds fetch, axios, SWR, React Query, and server action calls
- **Backend scanner** — finds Next.js (App + Pages router), Express, and server action handlers

### Supported Frameworks
- **Frontend**: Next.js (App Router, Pages Router), React, Vue, Svelte, Angular
- **Backend**: Next.js API Routes, Next.js Server Actions, Express, Fastify, tRPC, GraphQL
- **ORM**: Prisma, Drizzle, TypeORM, Sequelize
- **Package Managers**: npm, yarn, pnpm, bun

### Tools (9)
- `full_stack_audit` — comprehensive analysis with health score
- `health_check` — quick pulse check with top 5 issues
- `check_contracts` — API contract verification
- `trace_issue` — bug attribution and root cause analysis
- `map_dependencies` — frontend ↔ backend dependency graph
- `scan_frontend` — frontend-only API call analysis
- `scan_backend` — backend-only route analysis
- `check_env` — environment variable cross-referencing
- `detect_project` — project structure detection
