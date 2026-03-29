import * as path from 'node:path';
import * as fs from 'node:fs';
import { Severity, IssueCategory, IssueLayer } from '../types.js';

// ─── File Utilities ──────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', '.output', 'coverage',
  '.vercel', '.netlify', '__pycache__', '.cache',
  '.turbo', '.parcel-cache',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
]);

export function collectFiles(
  dir: string,
  extensions: Set<string> = CODE_EXTENSIONS,
  maxFiles: number = 5000,
  maxDepth: number = 15,
  fileFilter?: Set<string>,
): string[] {
  const files: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth || files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(current, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.has(ext)) {
          files.push(path.join(current, entry.name));
        }
      }
    }
  }

  walk(dir, 0);

  if (fileFilter) {
    return files.filter((f) => fileFilter.has(path.resolve(f)));
  }

  return files;
}

export function readFileSafe(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1_000_000) return null; // Skip files > 1MB
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath);
}

// ─── Severity Helpers ────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 2,
  info: 0,
};

export function severityWeight(severity: Severity): number {
  return SEVERITY_WEIGHT[severity];
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_WEIGHT[b] - SEVERITY_WEIGHT[a];
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export function calculateGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── ID Generation ───────────────────────────────────────────────────────────

let counter = 0;

export function generateId(category: IssueCategory, layer: IssueLayer): string {
  counter++;
  const prefix = layer === 'cross-stack' ? 'XS' : layer === 'frontend' ? 'FE' : layer === 'backend' ? 'BE' : 'UN';
  return `${prefix}-${category}-${counter.toString().padStart(3, '0')}`;
}

export function resetIdCounter(): void {
  counter = 0;
}

// ─── URL Normalization ───────────────────────────────────────────────────────

export function normalizeApiPath(url: string): string {
  // Strip protocol, host, port
  let normalized = url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\$\{[^}]+\}/g, ':param')       // template literals → :param
    .replace(/\/\[[^\]]+\]/g, '/:param')      // [id] → :param (Next.js)
    .replace(/\/:[^/]+/g, '/:param');          // :id → :param (Express)

  // Remove trailing slash
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Remove query string
  const qIndex = normalized.indexOf('?');
  if (qIndex !== -1) {
    normalized = normalized.substring(0, qIndex);
  }

  return normalized.toLowerCase();
}

export function urlsMatch(frontendUrl: string, backendPath: string): boolean {
  const normFe = normalizeApiPath(frontendUrl);
  const normBe = normalizeApiPath(backendPath);

  if (normFe === normBe) return true;

  // Split into segments and compare
  const feSegs = normFe.split('/').filter(Boolean);
  const beSegs = normBe.split('/').filter(Boolean);

  if (feSegs.length !== beSegs.length) return false;

  return feSegs.every((feSeg, i) => {
    const beSeg = beSegs[i];
    if (feSeg === beSeg) return true;
    if (feSeg === ':param' || beSeg === ':param') return true;
    return false;
  });
}

// ─── Snippet Extraction ──────────────────────────────────────────────────────

export function extractSnippet(content: string, line: number, contextLines: number = 2): string {
  const lines = content.split('\n');
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join('\n');
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural || singular + 's'}`;
}
