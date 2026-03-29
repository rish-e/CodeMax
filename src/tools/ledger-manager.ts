import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  Ledger,
  LedgerEntry,
  LedgerUpdate,
  AuditSnapshot,
  CrossStackIssue,
  FullStackAuditReport,
  IssueStatus,
} from '../types.js';

// ─── Ledger Manager ─────────────────────────────────────────────────────────
// Persistent issue lifecycle tracking. Each issue gets a deterministic
// fingerprint so we can track it across scans — detecting fixes, regressions,
// and recurring patterns.
//
// Stored at: {projectRoot}/.codemax/ledger.json

const CODEMAX_DIR = '.codemax';
const LEDGER_FILE = 'ledger.json';

// ─── Public API ──────────────────────────────────────────────────────────────

export function updateLedger(projectPath: string, report: FullStackAuditReport): LedgerUpdate {
  const ledger = loadLedger(projectPath);
  const now = new Date().toISOString();

  // Build fingerprint set from current scan
  const currentFingerprints = new Map<string, CrossStackIssue>();
  for (const issue of report.issues) {
    const fp = fingerprint(issue);
    currentFingerprints.set(fp, issue);
  }

  const newIssues: LedgerEntry[] = [];
  const fixedIssues: LedgerEntry[] = [];
  const regressions: LedgerEntry[] = [];
  const acknowledged: LedgerEntry[] = [];

  // Phase 1: Update existing entries
  for (const entry of ledger.entries) {
    const stillExists = currentFingerprints.has(entry.fingerprint);

    if (stillExists) {
      // Issue still present — update it
      const current = currentFingerprints.get(entry.fingerprint)!;
      entry.lastSeen = now;
      entry.occurrences++;
      entry.severity = current.severity;
      entry.title = current.title;
      entry.description = current.description;
      entry.suggestion = current.suggestion;
      entry.evidence = current.evidence;

      if (entry.status === 'fixed') {
        // Was fixed, but it's back — regression
        entry.status = 'regressed';
        entry.fixedAt = null;
        entry.fixDescription = null;
        entry.hasRegressed = true;
        regressions.push(entry);
      } else if (entry.status === 'acknowledged') {
        acknowledged.push(entry);
      }
      // Remove from current set so we don't create a duplicate
      currentFingerprints.delete(entry.fingerprint);
    } else {
      // Issue no longer present
      if (entry.status === 'open' || entry.status === 'regressed') {
        entry.status = 'fixed';
        entry.fixedAt = now;
        fixedIssues.push(entry);
      }
    }
  }

  // Phase 2: Add new issues (not in ledger yet)
  for (const [fp, issue] of currentFingerprints) {
    const entry: LedgerEntry = {
      id: generateLedgerId(issue.category, issue.layer),
      fingerprint: fp,
      category: issue.category,
      severity: issue.severity,
      layer: issue.layer,
      title: issue.title,
      description: issue.description,
      suggestion: issue.suggestion,
      evidence: issue.evidence,
      status: 'open',
      firstSeen: now,
      lastSeen: now,
      fixedAt: null,
      fixDescription: null,
      occurrences: 1,
      hasRegressed: false,
    };
    ledger.entries.push(entry);
    newIssues.push(entry);
  }

  // Phase 3: Record audit snapshot for history
  const snapshot = createSnapshot(report);
  ledger.history.push(snapshot);

  // Keep only last 50 snapshots
  if (ledger.history.length > 50) {
    ledger.history = ledger.history.slice(-50);
  }

  ledger.lastUpdated = now;

  // Phase 4: Save
  saveLedger(projectPath, ledger);
  ensureGitignore(projectPath);

  const totalOpen = ledger.entries.filter((e) => e.status === 'open' || e.status === 'regressed').length;
  const totalFixed = ledger.entries.filter((e) => e.status === 'fixed').length;
  const totalRegressed = ledger.entries.filter((e) => e.status === 'regressed').length;

  return {
    newIssues,
    fixedIssues,
    regressions,
    acknowledged,
    totalOpen,
    totalFixed,
    totalRegressed,
  };
}

export function getLedger(projectPath: string): Ledger {
  return loadLedger(projectPath);
}

export function getLedgerEntries(
  projectPath: string,
  filter?: { status?: IssueStatus; category?: string; severity?: string },
): LedgerEntry[] {
  const ledger = loadLedger(projectPath);
  let entries = ledger.entries;

  if (filter?.status) {
    entries = entries.filter((e) => e.status === filter.status);
  }
  if (filter?.category) {
    entries = entries.filter((e) => e.category === filter.category);
  }
  if (filter?.severity) {
    entries = entries.filter((e) => e.severity === filter.severity);
  }

  return entries;
}

export function logFix(
  projectPath: string,
  issueId: string,
  description: string,
): { success: boolean; entry: LedgerEntry | null; message: string } {
  const ledger = loadLedger(projectPath);
  const entry = ledger.entries.find((e) => e.id === issueId);

  if (!entry) {
    return { success: false, entry: null, message: `Issue ${issueId} not found in ledger` };
  }

  entry.status = 'fixed';
  entry.fixedAt = new Date().toISOString();
  entry.fixDescription = description;
  ledger.lastUpdated = new Date().toISOString();

  saveLedger(projectPath, ledger);

  return { success: true, entry, message: `Marked ${issueId} as fixed: ${description}` };
}

export function acknowledgeIssue(
  projectPath: string,
  issueId: string,
): { success: boolean; message: string } {
  const ledger = loadLedger(projectPath);
  const entry = ledger.entries.find((e) => e.id === issueId);

  if (!entry) {
    return { success: false, message: `Issue ${issueId} not found in ledger` };
  }

  entry.status = 'acknowledged';
  ledger.lastUpdated = new Date().toISOString();
  saveLedger(projectPath, ledger);

  return { success: true, message: `Acknowledged ${issueId}: ${entry.title}` };
}

export function getAuditHistory(projectPath: string): AuditSnapshot[] {
  const ledger = loadLedger(projectPath);
  return ledger.history;
}

// ─── Fingerprinting ──────────────────────────────────────────────────────────
// Deterministic hash so the same issue produces the same fingerprint across
// scans, even if line numbers shift slightly.

function fingerprint(issue: CrossStackIssue): string {
  const key = [
    issue.category,
    issue.layer,
    // Use file paths from evidence (stable across runs)
    ...issue.evidence.map((e) => `${e.file}:${e.side}`).sort(),
    // Include title normalized (removing specific line numbers)
    issue.title.replace(/:\d+/g, '').replace(/\d+/g, 'N').toLowerCase(),
  ].join('|');

  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

// ─── ID Generation ───────────────────────────────────────────────────────────

const CATEGORY_PREFIX: Record<string, string> = {
  'contract-drift': 'CTR',
  'type-mismatch': 'TYP',
  'missing-error-handling': 'ERR',
  'over-fetching': 'OVR',
  'under-fetching': 'UND',
  'auth-gap': 'AUT',
  'cors': 'COR',
  'dead-endpoint': 'DEP',
  'phantom-call': 'PHN',
  'env-drift': 'ENV',
  'performance': 'PRF',
  'security': 'SEC',
  'data-flow': 'DAT',
};

let ledgerIdCounter = 0;

function generateLedgerId(category: string, layer: string): string {
  ledgerIdCounter++;
  const prefix = CATEGORY_PREFIX[category] || 'UNK';
  const layerChar = layer === 'cross-stack' ? 'X' : layer === 'frontend' ? 'F' : layer === 'backend' ? 'B' : 'U';
  const hash = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${layerChar}-${hash}`;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

function createSnapshot(report: FullStackAuditReport): AuditSnapshot {
  const issuesBySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const issuesByCategory: Record<string, number> = {};

  for (const issue of report.issues) {
    issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
    issuesByCategory[issue.category] = (issuesByCategory[issue.category] || 0) + 1;
  }

  const dimensions: Record<string, { score: number; maxScore: number }> = {};
  for (const [key, dim] of Object.entries(report.health.dimensions)) {
    dimensions[key] = { score: dim.score, maxScore: dim.maxScore };
  }

  return {
    timestamp: report.timestamp,
    duration: report.duration,
    healthGrade: report.health.grade,
    healthScore: report.health.overall,
    dimensions,
    totalIssues: report.issues.length,
    issuesBySeverity: issuesBySeverity as any,
    issuesByCategory,
    frontendCalls: report.frontendCalls.length,
    backendRoutes: report.backendRoutes.length,
    matchedContracts: report.contracts.matched.length,
    phantomCalls: report.contracts.phantomCalls.length,
    deadEndpoints: report.contracts.deadEndpoints.length,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function getCodemaxDir(projectPath: string): string {
  return path.join(projectPath, CODEMAX_DIR);
}

function getLedgerPath(projectPath: string): string {
  return path.join(getCodemaxDir(projectPath), LEDGER_FILE);
}

function loadLedger(projectPath: string): Ledger {
  const ledgerPath = getLedgerPath(projectPath);

  try {
    const content = fs.readFileSync(ledgerPath, 'utf-8');
    return JSON.parse(content) as Ledger;
  } catch {
    // No ledger yet — create empty
    return {
      projectPath,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      entries: [],
      history: [],
    };
  }
}

function saveLedger(projectPath: string, ledger: Ledger): void {
  const dir = getCodemaxDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getLedgerPath(projectPath), JSON.stringify(ledger, null, 2));
}

function ensureGitignore(projectPath: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.codemax')) {
        fs.appendFileSync(gitignorePath, '\n# CodeMax audit data\n.codemax/\n');
      }
    }
  } catch {
    // Not a git repo or can't write — that's fine
  }
}
