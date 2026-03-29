# Security Policy

## Scope

CodeMax is a **read-only static analysis tool**. It is designed with a minimal attack surface:

- **Never executes user code** — pure AST parsing and regex matching
- **Never reads environment variable values** — only checks that variable names exist
- **Never modifies files** in the scanned project (the only writes are to `.codemax/` for its own audit data)
- **Never transmits data externally** — all analysis is local
- **Never accesses the network** — no HTTP requests, no telemetry, no phone-home

### Scan Safety Limits

Built-in caps prevent resource exhaustion:

| Limit | Value |
|-------|-------|
| Max files per scan | 5,000 |
| Max file size | 1 MB |
| Max directory depth | 15 levels |

### LLM Context Considerations

CodeMax output is consumed by MCP clients (Claude Code, Cursor, etc.) and fed into LLM context. Be aware:

- Scan results contain **file paths and code snippets** from the scanned project
- **No secrets or `.env` values** are included — only variable names
- Results stay local to your MCP client session
- The `.codemax/REPORT.md` file is written to disk and could be committed to version control — review it before sharing publicly

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x | Yes |
| < 1.0 | No |

## Reporting a Vulnerability

If you discover a security vulnerability in CodeMax, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Use [GitHub Security Advisories](https://github.com/rish-e/codemax/security/advisories/new) to report privately
3. Or email: **rishi@codemax.dev**

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)
- Your name/handle for credit (optional)

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within 48 hours |
| Assessment | Within 1 week |
| Fix for critical issues | Within 2 weeks |
| Fix for non-critical issues | Next minor release |

### What Qualifies

- Path traversal that could read files outside the project directory
- Code injection through crafted source files that causes CodeMax to execute arbitrary code
- Dependency vulnerabilities in CodeMax's own dependency tree
- Information leakage (secrets, credentials, or sensitive data appearing in output when they shouldn't)

### What Does Not Qualify

- Issues in the scanned project's code (that's what CodeMax is designed to find)
- False positives or false negatives in issue detection (open a regular issue for these)
- Performance issues or resource consumption within the documented limits

## Security Best Practices for Users

1. **Review `.codemax/REPORT.md`** before committing it — it contains code snippets from your project
2. **Add `.codemax/` to `.gitignore`** if your project contains sensitive code (CodeMax does this automatically)
3. **Keep CodeMax updated** — run `npm update codemax-mcp` to get security patches
4. **Audit dependencies** — run `npm audit` periodically on projects that include CodeMax
