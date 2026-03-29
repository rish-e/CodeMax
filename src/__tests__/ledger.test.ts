import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  updateLedger,
  getLedger,
  getLedgerEntries,
  logFix,
  acknowledgeIssue,
  getAuditHistory,
} from '../tools/ledger-manager.js';
import { FullStackAuditReport, CrossStackIssue } from '../types.js';

function mockIssue(overrides: Partial<CrossStackIssue> = {}): CrossStackIssue {
  return {
    id: 'XS-contract-drift-001',
    category: 'contract-drift',
    severity: 'high',
    layer: 'cross-stack',
    title: 'Frontend calls non-existent endpoint: GET /api/missing',
    description: 'The frontend makes a GET request to /api/missing but no backend route exists.',
    evidence: [{
      file: 'components/Dashboard.tsx',
      line: 15,
      snippet: "fetch('/api/missing')",
      side: 'frontend',
    }],
    suggestion: 'Create the backend route handler or fix the frontend URL.',
    ...overrides,
  };
}

function mockReport(issues: CrossStackIssue[]): FullStackAuditReport {
  return {
    project: {
      root: '/tmp/test',
      isMonorepo: false,
      frontendPaths: [],
      backendPaths: [],
      sharedPaths: [],
      frontendFramework: 'react',
      backendFramework: 'express',
      orm: 'none',
      packageManager: 'npm',
      typescript: true,
      envFiles: [],
    },
    timestamp: new Date().toISOString(),
    duration: 100,
    frontendCalls: [],
    backendRoutes: [],
    contracts: { matched: [], deadEndpoints: [], phantomCalls: [], score: 100 },
    issues,
    health: {
      overall: 80,
      grade: 'B',
      dimensions: {
        contracts: { name: 'Contracts', score: 80, maxScore: 100, issues: 1, details: 'test' },
        errorHandling: { name: 'Errors', score: 80, maxScore: 100, issues: 0, details: 'test' },
        security: { name: 'Security', score: 90, maxScore: 100, issues: 0, details: 'test' },
        performance: { name: 'Performance', score: 100, maxScore: 100, issues: 0, details: 'test' },
        dataFlow: { name: 'Data Flow', score: 70, maxScore: 100, issues: 0, details: 'test' },
        environment: { name: 'Environment', score: 95, maxScore: 100, issues: 0, details: 'test' },
      },
    },
    summary: 'Test report',
  };
}

describe('Ledger Manager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemax-ledger-test-'));
    // Create a minimal project so ledger has a place to write
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates ledger on first audit', () => {
    const issue = mockIssue();
    const report = mockReport([issue]);
    const update = updateLedger(tmpDir, report);

    expect(update.newIssues.length).toBe(1);
    expect(update.fixedIssues.length).toBe(0);
    expect(update.regressions.length).toBe(0);
    expect(update.totalOpen).toBe(1);

    // Verify file was written
    expect(fs.existsSync(path.join(tmpDir, '.codemax', 'ledger.json'))).toBe(true);
  });

  it('detects fixes when issues disappear', () => {
    const issue = mockIssue();

    // First scan — issue found
    updateLedger(tmpDir, mockReport([issue]));

    // Second scan — issue gone
    const update = updateLedger(tmpDir, mockReport([]));

    expect(update.fixedIssues.length).toBe(1);
    expect(update.fixedIssues[0].status).toBe('fixed');
    expect(update.fixedIssues[0].fixedAt).not.toBeNull();
    expect(update.totalFixed).toBe(1);
    expect(update.totalOpen).toBe(0);
  });

  it('detects regressions when fixed issues return', () => {
    const issue = mockIssue();

    // First scan — issue found
    updateLedger(tmpDir, mockReport([issue]));

    // Second scan — issue fixed
    updateLedger(tmpDir, mockReport([]));

    // Third scan — issue is back
    const update = updateLedger(tmpDir, mockReport([issue]));

    expect(update.regressions.length).toBe(1);
    expect(update.regressions[0].status).toBe('regressed');
    expect(update.regressions[0].hasRegressed).toBe(true);
    expect(update.totalRegressed).toBe(1);
  });

  it('increments occurrences on repeated scans', () => {
    const issue = mockIssue();

    updateLedger(tmpDir, mockReport([issue]));
    updateLedger(tmpDir, mockReport([issue]));
    updateLedger(tmpDir, mockReport([issue]));

    const ledger = getLedger(tmpDir);
    expect(ledger.entries[0].occurrences).toBe(3);
  });

  it('tracks audit history snapshots', () => {
    const issue = mockIssue();

    updateLedger(tmpDir, mockReport([issue]));
    updateLedger(tmpDir, mockReport([issue]));

    const history = getAuditHistory(tmpDir);
    expect(history.length).toBe(2);
    expect(history[0].healthScore).toBe(80);
    expect(history[0].healthGrade).toBe('B');
  });

  it('filters ledger entries by status', () => {
    const issue1 = mockIssue();
    const issue2 = mockIssue({
      id: 'FE-auth-gap-002',
      category: 'auth-gap',
      title: 'Missing auth on POST /api/users',
    });

    updateLedger(tmpDir, mockReport([issue1, issue2]));

    // Fix one issue
    updateLedger(tmpDir, mockReport([issue1]));

    const openEntries = getLedgerEntries(tmpDir, { status: 'open' });
    const fixedEntries = getLedgerEntries(tmpDir, { status: 'fixed' });

    expect(openEntries.length).toBe(1);
    expect(fixedEntries.length).toBe(1);
  });

  it('logs manual fix description', () => {
    const issue = mockIssue();
    updateLedger(tmpDir, mockReport([issue]));

    const ledger = getLedger(tmpDir);
    const issueId = ledger.entries[0].id;

    const result = logFix(tmpDir, issueId, 'Added the missing /api/missing route handler');

    expect(result.success).toBe(true);
    expect(result.entry!.status).toBe('fixed');
    expect(result.entry!.fixDescription).toBe('Added the missing /api/missing route handler');
    expect(result.entry!.fixedAt).not.toBeNull();
  });

  it('returns error for invalid issue ID in logFix', () => {
    const result = logFix(tmpDir, 'NONEXISTENT-123', 'test fix');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('acknowledges issues', () => {
    const issue = mockIssue();
    updateLedger(tmpDir, mockReport([issue]));

    const ledger = getLedger(tmpDir);
    const issueId = ledger.entries[0].id;

    const result = acknowledgeIssue(tmpDir, issueId);
    expect(result.success).toBe(true);

    const updated = getLedger(tmpDir);
    expect(updated.entries[0].status).toBe('acknowledged');
  });

  it('acknowledged issues are reported in update', () => {
    const issue = mockIssue();
    updateLedger(tmpDir, mockReport([issue]));

    // Acknowledge
    const ledger = getLedger(tmpDir);
    acknowledgeIssue(tmpDir, ledger.entries[0].id);

    // Scan again — issue still there but acknowledged
    const update = updateLedger(tmpDir, mockReport([issue]));
    expect(update.acknowledged.length).toBe(1);
    expect(update.newIssues.length).toBe(0);
  });

  it('handles empty project gracefully', () => {
    const update = updateLedger(tmpDir, mockReport([]));
    expect(update.newIssues.length).toBe(0);
    expect(update.totalOpen).toBe(0);
  });

  it('caps history at 50 snapshots', () => {
    const issue = mockIssue();
    for (let i = 0; i < 55; i++) {
      updateLedger(tmpDir, mockReport([issue]));
    }

    const history = getAuditHistory(tmpDir);
    expect(history.length).toBe(50);
  });

  it('deterministic fingerprint — same issue across scans', () => {
    const issue = mockIssue();

    updateLedger(tmpDir, mockReport([issue]));
    const ledger1 = getLedger(tmpDir);

    // Same issue, different run — should match
    updateLedger(tmpDir, mockReport([issue]));
    const ledger2 = getLedger(tmpDir);

    // Only one entry (same fingerprint matched)
    expect(ledger2.entries.length).toBe(1);
    expect(ledger2.entries[0].occurrences).toBe(2);
  });

  it('different issues get different fingerprints', () => {
    const issue1 = mockIssue();
    const issue2 = mockIssue({
      category: 'auth-gap',
      title: 'Completely different issue',
      evidence: [{ file: 'different.ts', line: 99, snippet: 'x', side: 'backend' }],
    });

    updateLedger(tmpDir, mockReport([issue1, issue2]));
    const ledger = getLedger(tmpDir);

    expect(ledger.entries.length).toBe(2);
    expect(ledger.entries[0].fingerprint).not.toBe(ledger.entries[1].fingerprint);
  });
});
