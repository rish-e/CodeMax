import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  FullStackAuditReport,
  Ledger,
  LedgerEntry,
  LedgerUpdate,
  AuditSnapshot,
  Severity,
} from '../types.js';
import { getLedger, getAuditHistory } from './ledger-manager.js';

// ─── Report Writer ───────────────────────────────────────────────────────────
// Generates a living REPORT.md in .codemax/ that documents:
// - Current health status
// - All discovered issues with evidence
// - Fix history (what was fixed, when, how)
// - Health trend over time
// - Regression alerts
//
// This file is the project's cross-stack audit trail — readable by any
// developer without needing to run CodeMax.

const REPORT_FILE = 'REPORT.md';

export function generateReport(projectPath: string, report: FullStackAuditReport, ledgerUpdate: LedgerUpdate): string {
  const ledger = getLedger(projectPath);
  const history = getAuditHistory(projectPath);

  const sections: string[] = [];

  sections.push(renderHeader(report));
  sections.push(renderHealthDashboard(report));
  sections.push(renderTrendLine(history));
  sections.push(renderLedgerSummary(ledgerUpdate));
  sections.push(renderOpenIssues(ledger));
  sections.push(renderFixLog(ledger));
  sections.push(renderRegressions(ledger));
  sections.push(renderProjectStructure(report));
  sections.push(renderApiMap(report));
  sections.push(renderFooter());

  const content = sections.filter(Boolean).join('\n\n---\n\n');

  // Write to .codemax/REPORT.md
  const reportPath = path.join(projectPath, '.codemax', REPORT_FILE);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content);

  return content;
}

export function getReportPath(projectPath: string): string {
  return path.join(projectPath, '.codemax', REPORT_FILE);
}

// ─── Sections ────────────────────────────────────────────────────────────────

function renderHeader(report: FullStackAuditReport): string {
  const stack = [
    formatFramework(report.project.frontendFramework),
    formatFramework(report.project.backendFramework),
    report.project.orm !== 'none' ? report.project.orm : null,
  ].filter(Boolean).join(' + ');

  return [
    `# CodeMax Audit Report`,
    '',
    `> Auto-generated cross-stack analysis. Last updated: ${formatDate(report.timestamp)}`,
    '',
    `| Property | Value |`,
    `|----------|-------|`,
    `| **Health Grade** | **${report.health.grade}** (${report.health.overall}/100) |`,
    `| **Stack** | ${stack} |`,
    `| **Frontend API Calls** | ${report.frontendCalls.length} |`,
    `| **Backend Routes** | ${report.backendRoutes.length} |`,
    `| **Matched Contracts** | ${report.contracts.matched.length} |`,
    `| **Open Issues** | ${report.issues.length} |`,
    `| **Scan Duration** | ${report.duration}ms |`,
  ].join('\n');
}

function renderHealthDashboard(report: FullStackAuditReport): string {
  const lines: string[] = [];
  lines.push('## Health Dashboard');
  lines.push('');
  lines.push('| Dimension | Score | Status | Details |');
  lines.push('|-----------|-------|--------|---------|');

  for (const [, dim] of Object.entries(report.health.dimensions)) {
    const pct = Math.round((dim.score / dim.maxScore) * 100);
    const bar = scoreBar(dim.score, dim.maxScore);
    const status = pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : pct >= 60 ? 'Needs Work' : pct >= 40 ? 'Poor' : 'Critical';
    lines.push(`| **${dim.name}** | ${bar} ${pct}% | ${status} | ${dim.details} |`);
  }

  return lines.join('\n');
}

function renderTrendLine(history: AuditSnapshot[]): string {
  if (history.length < 2) {
    return [
      '## Health Trend',
      '',
      '_Run more audits to see your health trend over time._',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push('## Health Trend');
  lines.push('');
  lines.push('| Date | Grade | Score | Issues | Phantom | Dead | Contracts |');
  lines.push('|------|-------|-------|--------|---------|------|-----------|');

  // Show last 15 snapshots
  const recent = history.slice(-15);
  for (const snap of recent) {
    const date = formatDate(snap.timestamp);
    const delta = recent.indexOf(snap) > 0
      ? scoreDelta(snap.healthScore, recent[recent.indexOf(snap) - 1].healthScore)
      : '';
    lines.push(
      `| ${date} | ${snap.healthGrade} | ${snap.healthScore}${delta} | ${snap.totalIssues} | ${snap.phantomCalls} | ${snap.deadEndpoints} | ${snap.matchedContracts} |`,
    );
  }

  // Add trend summary
  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    const diff = last.healthScore - first.healthScore;
    lines.push('');
    if (diff > 0) {
      lines.push(`> Health improved by **+${diff} points** over ${recent.length} audits.`);
    } else if (diff < 0) {
      lines.push(`> Health declined by **${diff} points** over ${recent.length} audits.`);
    } else {
      lines.push(`> Health stable at **${last.healthScore}/100** over ${recent.length} audits.`);
    }
  }

  return lines.join('\n');
}

function renderLedgerSummary(update: LedgerUpdate): string {
  const lines: string[] = [];
  lines.push('## Latest Scan Changes');
  lines.push('');

  if (update.newIssues.length === 0 && update.fixedIssues.length === 0 && update.regressions.length === 0) {
    lines.push('_No changes since last scan._');
    return lines.join('\n');
  }

  if (update.newIssues.length > 0) {
    lines.push(`### New Issues (${update.newIssues.length})`);
    for (const issue of update.newIssues) {
      lines.push(`- \`${issue.id}\` [${issue.severity.toUpperCase()}] **${issue.title}**`);
    }
    lines.push('');
  }

  if (update.fixedIssues.length > 0) {
    lines.push(`### Fixed Since Last Scan (${update.fixedIssues.length})`);
    for (const issue of update.fixedIssues) {
      lines.push(`- ~~\`${issue.id}\` ${issue.title}~~ — fixed ${formatDate(issue.fixedAt!)}`);
      if (issue.fixDescription) {
        lines.push(`  How: ${issue.fixDescription}`);
      }
    }
    lines.push('');
  }

  if (update.regressions.length > 0) {
    lines.push(`### Regressions (${update.regressions.length})`);
    for (const issue of update.regressions) {
      lines.push(`- \`${issue.id}\` [REGRESSED] **${issue.title}** — was fixed, now back`);
    }
    lines.push('');
  }

  lines.push(`> **Summary**: ${update.totalOpen} open, ${update.totalFixed} fixed, ${update.totalRegressed} regressed`);

  return lines.join('\n');
}

function renderOpenIssues(ledger: Ledger): string {
  const open = ledger.entries.filter((e) => e.status === 'open' || e.status === 'regressed');

  if (open.length === 0) {
    return [
      '## Open Issues',
      '',
      '_No open issues. Your full-stack integration is clean._',
    ].join('\n');
  }

  // Group by severity
  const bySeverity = groupBy(open, 'severity');
  const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

  const lines: string[] = [];
  lines.push(`## Open Issues (${open.length})`);
  lines.push('');

  for (const severity of severityOrder) {
    const issues = bySeverity[severity];
    if (!issues || issues.length === 0) continue;

    lines.push(`### ${severity.toUpperCase()} (${issues.length})`);
    lines.push('');

    for (const issue of issues) {
      const regressed = issue.status === 'regressed' ? ' **[REGRESSED]**' : '';
      const recurring = issue.occurrences > 1 ? ` (seen ${issue.occurrences}x)` : '';

      lines.push(`#### \`${issue.id}\` ${issue.title}${regressed}${recurring}`);
      lines.push('');
      lines.push(`**Layer**: ${issue.layer} | **Category**: ${issue.category} | **First seen**: ${formatDate(issue.firstSeen)}`);
      lines.push('');
      lines.push(issue.description);
      lines.push('');

      if (issue.evidence.length > 0) {
        lines.push('**Evidence:**');
        for (const ev of issue.evidence) {
          lines.push(`- \`${ev.file}:${ev.line}\` (${ev.side})`);
          if (ev.snippet) {
            lines.push('  ```');
            lines.push(`  ${ev.snippet.split('\n').join('\n  ')}`);
            lines.push('  ```');
          }
        }
        lines.push('');
      }

      lines.push(`**Fix**: ${issue.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderFixLog(ledger: Ledger): string {
  const fixed = ledger.entries
    .filter((e) => e.status === 'fixed' && e.fixedAt)
    .sort((a, b) => (b.fixedAt || '').localeCompare(a.fixedAt || ''));

  if (fixed.length === 0) {
    return [
      '## Fix Log',
      '',
      '_No fixes recorded yet. Issues are automatically marked as fixed when they disappear from subsequent scans, or you can manually log fixes with `log_fix`._',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`## Fix Log (${fixed.length} resolved)`);
  lines.push('');
  lines.push('| ID | Issue | Severity | Fixed | How | First Seen | Occurrences |');
  lines.push('|----|-------|----------|-------|-----|------------|-------------|');

  for (const entry of fixed.slice(0, 30)) {
    const how = entry.fixDescription || '_auto-detected_';
    const hadRegressed = entry.hasRegressed ? ' (had regressed)' : '';
    lines.push(
      `| \`${entry.id}\` | ${entry.title} | ${entry.severity} | ${formatDate(entry.fixedAt!)} | ${how}${hadRegressed} | ${formatDate(entry.firstSeen)} | ${entry.occurrences} |`,
    );
  }

  if (fixed.length > 30) {
    lines.push(`| ... | _${fixed.length - 30} more fixed issues_ | | | | | |`);
  }

  return lines.join('\n');
}

function renderRegressions(ledger: Ledger): string {
  const regressed = ledger.entries.filter((e) => e.hasRegressed);

  if (regressed.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Regression History`);
  lines.push('');
  lines.push('These issues were fixed but came back at some point:');
  lines.push('');

  for (const entry of regressed) {
    const currentStatus = entry.status === 'regressed' ? '**Still regressed**' : entry.status === 'fixed' ? 'Re-fixed' : entry.status;
    lines.push(`- \`${entry.id}\` **${entry.title}** — ${currentStatus}, seen ${entry.occurrences}x total`);
  }

  return lines.join('\n');
}

function renderProjectStructure(report: FullStackAuditReport): string {
  const p = report.project;
  return [
    '## Project Structure',
    '',
    `| | |`,
    `|---|---|`,
    `| **Frontend** | ${formatFramework(p.frontendFramework)} |`,
    `| **Backend** | ${formatFramework(p.backendFramework)} |`,
    `| **ORM** | ${p.orm} |`,
    `| **Monorepo** | ${p.isMonorepo ? 'Yes' : 'No'} |`,
    `| **TypeScript** | ${p.typescript ? 'Yes' : 'No'} |`,
    `| **Package Manager** | ${p.packageManager} |`,
    ...(p.frontendPaths.length > 0 ? [`| **Frontend Paths** | ${p.frontendPaths.map(fp => '`' + path.relative(p.root, fp) + '`').join(', ')} |`] : []),
    ...(p.backendPaths.length > 0 ? [`| **Backend Paths** | ${p.backendPaths.map(fp => '`' + path.relative(p.root, fp) + '`').join(', ')} |`] : []),
  ].join('\n');
}

function renderApiMap(report: FullStackAuditReport): string {
  if (report.contracts.matched.length === 0 && report.contracts.phantomCalls.length === 0 && report.contracts.deadEndpoints.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## API Contract Map');
  lines.push('');
  lines.push(`Contract score: **${report.contracts.score}/100**`);
  lines.push('');

  if (report.contracts.matched.length > 0) {
    lines.push('### Matched Contracts');
    lines.push('');
    lines.push('| Frontend | Method | Backend | Mismatches |');
    lines.push('|----------|--------|---------|------------|');
    for (const m of report.contracts.matched) {
      const status = m.mismatches.length === 0 ? 'Clean' : `${m.mismatches.length} issue${m.mismatches.length > 1 ? 's' : ''}`;
      lines.push(`| ${m.frontend.file}:${m.frontend.line} | ${m.frontend.method} | ${m.backend.file}:${m.backend.line} | ${status} |`);
    }
    lines.push('');
  }

  if (report.contracts.phantomCalls.length > 0) {
    lines.push('### Phantom Calls (no backend handler)');
    for (const c of report.contracts.phantomCalls) {
      lines.push(`- \`${c.method} ${c.url}\` at ${c.file}:${c.line}`);
    }
    lines.push('');
  }

  if (report.contracts.deadEndpoints.length > 0) {
    lines.push('### Dead Endpoints (no frontend consumer)');
    for (const r of report.contracts.deadEndpoints) {
      lines.push(`- \`${r.method} ${r.path}\` at ${r.file}:${r.line}`);
    }
  }

  return lines.join('\n');
}

function renderFooter(): string {
  return [
    '---',
    '',
    `_Generated by [CodeMax](https://github.com/rish-e/codemax) — the full-stack MCP that bridges frontend and backend analysis._`,
    '',
    `_Run \`full_stack_audit\` to refresh. Run \`log_fix\` to document how you resolved an issue._`,
  ].join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreBar(score: number, max: number): string {
  const ratio = score / max;
  const filled = Math.round(ratio * 10);
  const empty = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function scoreDelta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff > 0) return ` (+${diff})`;
  if (diff < 0) return ` (${diff})`;
  return '';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().split('T')[0];
  } catch {
    return iso;
  }
}

function formatFramework(framework: string): string {
  const names: Record<string, string> = {
    'next-app-router': 'Next.js (App Router)',
    'next-pages-router': 'Next.js (Pages Router)',
    'next-api': 'Next.js API Routes',
    'next-server-actions': 'Server Actions',
    react: 'React', vue: 'Vue', svelte: 'Svelte', angular: 'Angular',
    express: 'Express', fastify: 'Fastify', trpc: 'tRPC', graphql: 'GraphQL',
    unknown: 'Unknown',
  };
  return names[framework] || framework;
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of arr) {
    const k = String(item[key]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}
