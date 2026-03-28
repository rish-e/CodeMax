# CodeMax

**The full-stack MCP that sees what single-side tools miss.**

[![npm](https://img.shields.io/npm/v/codemax)](https://www.npmjs.com/package/codemax)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![Tools](https://img.shields.io/badge/MCP_Tools-9-purple)]()

---

CodeMax bridges the gap between frontend and backend analysis. It scans both sides of your stack, cross-references API contracts, and surfaces the issues that neither side can detect alone.

Built to work alongside [UIMax](https://github.com/prembobby39-gif/uimax-mcp) (frontend analysis) and [BackendMax](https://github.com/rish-e/backend-max) (backend analysis) — or completely standalone.

```
┌─────────────────────────────────────────────────┐
│                  MCP Client                     │
│          (Claude Code, Cursor, etc.)            │
└────────────┬──────────┬──────────┬──────────────┘
             │          │          │
        MCP Protocol    │     MCP Protocol
             │          │          │
     ┌───────▼──┐  ┌────▼─────┐  ┌▼──────────┐
     │  UIMax   │  │ CodeMax  │  │BackendMax │
     │(frontend)│  │(bridge)  │  │ (backend) │
     └──────────┘  └──┬───┬──┘  └───────────┘
                      │   │
              imports  │   │  imports
              core/    │   │  core/
                      ▼   ▼
            ┌──────────────────────┐
            │  Cross-Stack Engine  │
            │  - Contract analysis │
            │  - Issue correlation │
            │  - Health scoring    │
            │  - Dependency mapping│
            └──────────────────────┘
```

---

## Quick Start

### Claude Code

```bash
claude mcp add codemax -- npx -y codemax
```

### Manual Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "codemax": {
      "command": "npx",
      "args": ["-y", "codemax"]
    }
  }
}
```

### From Source

```bash
git clone https://github.com/rish-e/codemax.git
cd codemax
npm install && npm run build
```

```json
{
  "mcpServers": {
    "codemax": {
      "command": "node",
      "args": ["/path/to/codemax/dist/index.js"]
    }
  }
}
```

---

## What It Finds

CodeMax detects cross-stack issues that frontend-only or backend-only tools structurally cannot see:

| Issue | What happens | Example |
|-------|-------------|---------|
| **Phantom Calls** | Frontend calls an endpoint that doesn't exist | `fetch('/api/users')` but no `/api/users` route handler |
| **Dead Endpoints** | Backend exposes a route nobody calls | `GET /api/admin/stats` with zero frontend consumers |
| **Method Mismatch** | Frontend sends POST, backend expects GET | Form submit uses POST but route only exports GET |
| **Field Drift** | Frontend expects fields the backend doesn't return | Destructures `data.avatar` but API returns `data.image` |
| **Auth Gaps** | One side assumes auth, the other doesn't | Frontend sends Bearer token but backend never checks it |
| **Missing Validation** | POST/PUT with no input validation | Backend accepts any payload with no Zod/schema check |
| **Over-Fetching** | Backend returns 50 fields, frontend uses 3 | Wastes bandwidth and may leak sensitive data |
| **N+1 API Calls** | Frontend fetches list then each item separately | List endpoint + N detail calls in a loop |
| **Env Drift** | Code references vars not defined in .env | `process.env.API_KEY` but no `API_KEY` in .env |
| **Prefix Issues** | Client code uses non-public env vars | `process.env.SECRET` in a React component (always undefined) |

---

## Tools

### Full Analysis

| Tool | Description |
|------|-------------|
| `full_stack_audit` | Comprehensive analysis — scans both sides, cross-references contracts, scores health across 6 dimensions. The complete picture. |
| `health_check` | Quick pulse check — health grade (A-F) with top 5 issues. Faster than a full audit. |

### Cross-Stack

| Tool | Description |
|------|-------------|
| `check_contracts` | Compare every frontend API call against every backend route. Find phantom calls, dead endpoints, and mismatches. |
| `trace_issue` | Given a bug or error message, determine which layer owns it — frontend, backend, or cross-stack. |
| `map_dependencies` | Map all connections between frontend files and backend routes. Find orphans and phantoms. |
| `check_env` | Cross-reference .env files against actual usage in frontend and backend code. |

### Individual Scans

| Tool | Description |
|------|-------------|
| `scan_frontend` | All frontend API calls — fetch, axios, SWR, React Query, server actions. Error handling & auth status per call. |
| `scan_backend` | All backend routes — Next.js, Express, server actions. Auth, validation, and error handling status per route. |
| `detect_project` | Project structure report — frameworks, monorepo, ORM, paths, package manager, env files. |

---

## How It Works

### 1. Project Detection

CodeMax auto-detects your project structure:

- **Monorepo?** Checks for `turbo.json`, `pnpm-workspace.yaml`, `lerna.json`, workspace configs
- **Frontend framework?** Next.js (App/Pages), React, Vue, Svelte, Angular
- **Backend framework?** Next.js API, Server Actions, Express, Fastify, tRPC, GraphQL
- **ORM?** Prisma, Drizzle, TypeORM, Sequelize
- **Layer boundaries?** Identifies which directories are frontend, backend, and shared

### 2. Dual Scanning

The frontend scanner finds every API call:
```
fetch('/api/users')           → GET /api/users (fetch)
axios.post('/api/posts')      → POST /api/posts (axios)
useSWR('/api/dashboard')      → GET /api/dashboard (swr)
useQuery(['posts'])           → GET (react-query)
createUser(formData)          → POST server-action:createUser
```

The backend scanner finds every route handler:
```
app/api/users/route.ts        → GET /api/users, POST /api/users
app/api/users/[id]/route.ts   → GET /api/users/:param
pages/api/auth.ts             → GET,POST /api/auth
server.ts (Express)           → router.get('/api/...'), router.post('/api/...')
actions.ts ('use server')     → server-action:createUser
```

### 3. Contract Analysis

The bridge engine cross-references both sides:

```
Frontend Calls          Backend Routes
──────────────          ──────────────
GET /api/users    ───►  GET /api/users       ✓ matched
POST /api/posts   ───►  (nothing)            ✗ phantom call!
(nothing)         ◄───  GET /api/admin       ✗ dead endpoint
POST /api/auth    ───►  GET /api/auth        ✗ method mismatch!
```

### 4. Health Scoring

Six dimensions, weighted and combined into a single grade:

```
API Contracts    [████████░░] 80/100  — 1 phantom call, 2 mismatches
Error Handling   [██████░░░░] 60/100  — 4/10 calls missing try/catch
Security         [█████████░] 90/100  — 1 unprotected mutation
Performance      [██████████] 100/100 — no anti-patterns
Data Flow        [███████░░░] 70/100  — 2 field mismatches
Environment      [█████████░] 95/100  — 1 missing env var

Overall: B (78/100)
```

---

## Example Output

### `full_stack_audit`

```
# Full-Stack Audit Report — Grade: B (78/100)

Project: /home/user/my-app
Stack: Next.js (App Router) + Next.js API Routes + prisma
Scanned: 42 frontend files, 18 backend files in 1.2s

## Overview
- 12 frontend API calls found
- 8 backend routes found
- 7 matched contracts
- 1 phantom call (frontend → nowhere)
- 1 dead endpoint (backend → unused)

## Top Issues (6 total)
- [CRITICAL] Frontend calls non-existent endpoint: GET /api/analytics
  Create the backend route handler or fix the frontend URL.
- [HIGH] Frontend expects fields [avatar, role] but backend doesn't return them
  Add the missing fields to the backend response or update the frontend.
- [HIGH] Unprotected mutation: POST /api/comments
  Add authentication middleware or session check.
- [MEDIUM] No error handling: GET /api/dashboard
  Add try/catch or .catch() and show a user-friendly error message.
- [MEDIUM] Over-fetching: GET /api/users — backend returns 15 fields, frontend uses 4
  Use field selection or a DTO to return only needed fields.
- [LOW] Unused endpoint: DELETE /api/legacy-users
  Remove if unused, or document the external consumer.
```

---

## Supported Stacks

### Frontend
- Next.js 13+ (App Router)
- Next.js (Pages Router)
- React (CRA, Vite)
- Vue / Nuxt
- Svelte / SvelteKit
- Angular

### Backend
- Next.js API Routes (App + Pages)
- Next.js Server Actions
- Express
- Fastify
- tRPC
- GraphQL (Apollo, Yoga)

### Data Fetching
- `fetch()`
- `axios`
- `useSWR`
- `useQuery` / `useMutation` (React Query / TanStack)
- Server Actions (`"use server"`)

### ORM Detection
- Prisma
- Drizzle
- TypeORM
- Sequelize

### Monorepo Support
- Turborepo
- pnpm workspaces
- Yarn workspaces
- Lerna
- Nx

---

## The Ecosystem

CodeMax is part of a three-MCP ecosystem:

| MCP | Focus | Tools |
|-----|-------|-------|
| [**UIMax**](https://github.com/prembobby39-gif/uimax-mcp) | Frontend — screenshots, accessibility, Lighthouse, code analysis | 34 tools |
| [**BackendMax**](https://github.com/rish-e/backend-max) | Backend — route scanning, security audit, Prisma, error handling | 20 tools |
| **CodeMax** | Cross-stack — contract verification, issue tracing, health scoring | 9 tools |

Use any combination:
- **UIMax alone** — pure frontend analysis
- **BackendMax alone** — pure backend analysis
- **CodeMax alone** — cross-stack analysis with built-in frontend + backend scanners
- **All three** — maximum coverage, each MCP focuses on what it does best

---

## Configuration

CodeMax works zero-config out of the box. It auto-detects everything.

For advanced cases, you can create a `.codemaxrc.json`:

```json
{
  "frontendPaths": ["packages/web/src"],
  "backendPaths": ["packages/api/src"],
  "sharedPaths": ["packages/shared"],
  "ignore": ["**/*.test.ts", "**/__mocks__/**"],
  "severity": {
    "phantom-call": "critical",
    "dead-endpoint": "low",
    "over-fetching": "medium"
  }
}
```

---

## Development

```bash
git clone https://github.com/rish-e/codemax.git
cd codemax
npm install
npm run build
npm test
```

### Project Structure

```
src/
├── index.ts                    # Entry point (stdio transport)
├── server.ts                   # MCP server + 9 tool registrations
├── types.ts                    # Shared type definitions
├── analyzers/
│   ├── project-detector.ts     # Framework, monorepo, ORM detection
│   ├── frontend-scanner.ts     # API call extraction (fetch, axios, SWR, etc.)
│   ├── backend-scanner.ts      # Route extraction (Next.js, Express, etc.)
│   └── env-analyzer.ts         # Environment variable cross-referencing
├── bridge/
│   ├── orchestrator.ts         # Full audit coordination
│   ├── contract-analyzer.ts    # Frontend ↔ backend contract comparison
│   ├── correlator.ts           # Cross-stack issue detection
│   └── health-scorer.ts        # 6-dimension health scoring
├── utils/
│   └── helpers.ts              # URL normalization, scoring, formatting
└── __tests__/
    ├── helpers.test.ts          # Unit tests for utilities
    ├── project-detector.test.ts # Project detection tests
    ├── contract-analyzer.test.ts# Contract analysis tests
    └── scanners.test.ts         # Frontend + backend scanner tests
```

---

## Safety

CodeMax is read-only static analysis:

- **Never executes code** — pure AST parsing and regex matching
- **Never reads .env values** — only checks variable names exist
- **Never modifies files** — zero writes to your codebase
- **Never sends data externally** — everything stays local
- **Caps scan scope** — 5,000 files max, 1MB per file, 15 directory levels

---

## Contributing

Contributions welcome. [Open an issue](https://github.com/rish-e/codemax/issues) or submit a PR.

### Roadmap

- [x] Core contract analysis engine
- [x] Next.js (App + Pages router) support
- [x] Express support
- [x] Server Actions support
- [x] Environment variable cross-referencing
- [x] Health scoring (6 dimensions)
- [ ] GraphQL schema ↔ query contract analysis
- [ ] tRPC router ↔ client contract analysis
- [ ] Auto-fix engine (generate patches for common issues)
- [ ] Watch mode (incremental analysis on file change)
- [ ] HTML report generation
- [ ] Prisma schema ↔ API response field validation
- [ ] CORS configuration verification
- [ ] Deep integration with UIMax + BackendMax core APIs

---

## License

[MIT](LICENSE)
