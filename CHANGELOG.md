# Changelog

## [1.2.0] - 2026-03-29

### Added
- **CLI mode** — run CodeMax from the terminal or CI/CD without an MCP client. `codemax-mcp audit <path> [options]`
- **SARIF output** — `--format sarif` produces SARIF 2.1.0 output compatible with GitHub Code Scanning, VS Code, and other tools.
- **Git diff-aware scanning** — `--diff` flag limits scanning to files changed in git (staged + unstaged), dramatically faster on large codebases.
- **CI mode** — `--ci` flag exits with code 1 if health score falls below threshold (default 70, configurable via `--threshold`).
- **GitHub Actions ready** — pipe SARIF output to `github/codeql-action/upload-sarif` for PR-level code scanning.

### New Files
- `server.json` — Official MCP Registry metadata for discoverability
- `smithery.yaml` — Smithery marketplace configuration
- `glama.json` — Glama directory listing
- `CONTRIBUTING.md` — Development setup, guidelines, and architecture principles
- `SECURITY.md` — Security policy, scope, and vulnerability reporting
- `CODE_OF_CONDUCT.md` — Contributor Covenant
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Structured bug report form
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form
- `.github/pull_request_template.md` — PR template
- `.github/dependabot.yml` — Automated dependency updates
- `.editorconfig` — Consistent editor formatting
- `.gitattributes` — Line ending normalization

### Changed
- **Renamed npm package** from `codemax` to `codemax-mcp` (the name `codemax` was already taken on npm by another package)
- **Entry point** now dispatches between MCP server mode (default) and CLI mode (when arguments are passed)
- **Version** is now read dynamically from `package.json` — single source of truth
- **Top-level error handler** — fatal errors are caught and reported to stderr instead of crashing silently
- Added `types` and `exports` fields to `package.json` for TypeScript consumers
- Added `mcpName` field for Official MCP Registry
- Added `publishConfig` for clean npm publishing
- `collectFiles`, `scanFrontend`, `scanBackend`, and `runFullStackAudit` now accept an optional file filter for diff-aware scanning

---

## [1.1.0] - 2026-03-29

### Added
- **Issue lifecycle ledger** — persistent tracking of every issue across scans with deterministic fingerprinting. Issues transition through `open → fixed → regressed` automatically.
- **Living REPORT.md** — auto-generated Markdown report at `.codemax/REPORT.md` with health dashboard, trend graphs, open issues with evidence, fix log, regression history, and API contract map. Readable by any developer without running CodeMax.
- **Health trend tracking** — audit snapshots stored over time, showing health score progression across up to 50 scans.
- **Regression detection** — previously fixed issues that reappear are automatically flagged as regressions with full history.
- **Fix logging** — `log_fix` tool to document *how* an issue was resolved, recorded in the ledger and REPORT.md.
- **Issue acknowledgment** — `acknowledge_issue` tool to mark intentional/acceptable issues so they don't clutter action items.

### New Tools (4)
- `get_history` — audit trail with health trend, issue lifecycle, and scan statistics
- `log_fix` — manually document how an issue was resolved
- `acknowledge_issue` — mark issues as intentional/acceptable
- `get_report` — read the generated `.codemax/REPORT.md`

### Changed
- `full_stack_audit` now automatically persists results to `.codemax/ledger.json` and generates `.codemax/REPORT.md`
- Audit summary now includes a "Changes Since Last Scan" section showing new issues, fixes, and regressions
- Auto-adds `.codemax/` to project `.gitignore`

---

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
