# Contributing to CodeMax

Thanks for your interest in contributing to CodeMax. This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/rish-e/codemax.git
cd codemax
npm install --ignore-scripts
npm run build
npm test
```

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9

### Project Structure

```
src/
  index.ts                    # Entry point (MCP server + CLI dispatcher)
  cli.ts                      # CLI mode (audit, --format, --diff, --ci)
  server.ts                   # MCP server with 13 tool registrations
  types.ts                    # Shared type definitions
  analyzers/
    project-detector.ts       # Framework, monorepo, ORM detection
    frontend-scanner.ts       # API call extraction (fetch, axios, SWR, etc.)
    backend-scanner.ts        # Route extraction (Next.js, Express, etc.)
    env-analyzer.ts           # Environment variable cross-referencing
  bridge/
    orchestrator.ts           # Full audit coordination + ledger integration
    contract-analyzer.ts      # Frontend-backend contract comparison
    correlator.ts             # Cross-stack issue detection
    health-scorer.ts          # 6-dimension health scoring
  formatters/
    sarif.ts                  # SARIF output (GitHub Code Scanning compatible)
  tools/
    ledger-manager.ts         # Issue lifecycle tracking
    report-writer.ts          # Living REPORT.md generation
  utils/
    helpers.ts                # URL normalization, scoring, formatting
```

### Key Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Type-check without emitting |
| `npm run dev` | Watch mode for TypeScript compilation |

## What We Welcome

- **Bug fixes** with a test that reproduces the bug
- **New framework support** (scanners for additional frontend/backend frameworks)
- **Improved detection patterns** (better regex, fewer false positives)
- **Documentation improvements** (README, inline docs, examples)
- **Performance improvements** (faster scanning, lower memory usage)
- **New output formats** (HTML reports, JUnit XML, etc.)

## What Needs Discussion First

Open an issue before working on:

- **New MCP tools** (must serve the cross-stack analysis mission)
- **Breaking changes** to the tool API or output formats
- **Major architectural changes** (new dependencies, restructuring modules)
- **Opinionated features** (severity thresholds, default config values)

## Pull Request Guidelines

1. **Fork and branch** — create a feature branch from `main`
2. **Keep PRs focused** — one feature or fix per PR
3. **Add tests** — every new feature or bug fix should have a test
4. **All tests must pass** — `npm test` must exit cleanly
5. **Type-check must pass** — `npm run lint` must exit cleanly
6. **Write clear descriptions** — explain what changed and why

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add Vue 3 Composition API scanner support
fix: normalize dynamic route segments in URL matching
docs: add Windsurf installation instructions
test: add contract analysis edge case for optional params
```

## Testing

CodeMax uses [Vitest](https://vitest.dev/) for testing. Tests live alongside source code in `src/__tests__/`.

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run src/__tests__/contract-analyzer.test.ts

# Run tests matching a pattern
npx vitest run -t "phantom call"

# Watch mode
npm run test:watch
```

### Writing Tests

- Use temporary directories (`fs.mkdtempSync`) for tests that need file system fixtures
- Clean up temp directories in `afterEach`
- Mock data should use the factory functions (see `ledger.test.ts` for examples)
- Test both the happy path and error cases

## Code Style

- **TypeScript strict mode** is enabled
- **ESM modules** — use `.js` extensions in imports (TypeScript + ESM convention)
- **Functional core** — scanners and analyzers are pure functions where possible
- **No `console.log`** in production code — use `process.stderr.write` for debug output
- **No `process.exit`** in library code — only in the CLI entry point

## Architecture Principles

1. **Read-only** — CodeMax never modifies the scanned project's files
2. **Zero config** — auto-detection should handle common setups without configuration
3. **Deterministic** — same input should produce the same output (except timestamps)
4. **Graceful degradation** — if a scanner can't parse a file, skip it and continue
5. **Cross-stack focus** — features should bridge frontend and backend, not duplicate what single-side tools do

## Questions?

Open a [discussion](https://github.com/rish-e/codemax/discussions) or reach out via [issues](https://github.com/rish-e/codemax/issues).
