import * as path from 'node:path';
import * as fs from 'node:fs';
import { ProjectStructure, CrossStackIssue, Severity } from '../types.js';
import { FrontendScanResult } from './frontend-scanner.js';
import { BackendScanResult } from './backend-scanner.js';
import { generateId } from '../utils/helpers.js';

// ─── Environment Variable Analyzer ──────────────────────────────────────────
// Cross-references env vars used in frontend & backend against .env files
// to find drift, missing vars, and security issues.

export interface EnvAnalysis {
  issues: CrossStackIssue[];
  definedVars: Map<string, string[]>;   // var name → which .env files define it
  frontendRefs: Map<string, string[]>;  // var name → which frontend files use it
  backendRefs: Map<string, string[]>;   // var name → which backend files use it
}

export function analyzeEnvironment(
  project: ProjectStructure,
  frontend: FrontendScanResult,
  backend: BackendScanResult,
): EnvAnalysis {
  const issues: CrossStackIssue[] = [];

  // 1. Parse all .env files for defined variables
  const definedVars = parseEnvFiles(project.envFiles);

  // 2. Build reference maps
  const frontendRefs = new Map<string, string[]>();
  for (const ref of frontend.envRefs) {
    const existing = frontendRefs.get(ref.variable) || [];
    existing.push(ref.file);
    frontendRefs.set(ref.variable, existing);
  }

  const backendRefs = new Map<string, string[]>();
  for (const ref of backend.envRefs) {
    const existing = backendRefs.get(ref.variable) || [];
    existing.push(ref.file);
    backendRefs.set(ref.variable, existing);
  }

  // 3. Find issues

  // Missing variables (referenced but not defined in any .env)
  const allRefs = new Set([...frontendRefs.keys(), ...backendRefs.keys()]);
  for (const varName of allRefs) {
    if (!definedVars.has(varName) && !isBuiltinEnvVar(varName)) {
      const side = frontendRefs.has(varName) ? 'frontend' : 'backend';
      const files = frontendRefs.get(varName) || backendRefs.get(varName) || [];

      issues.push({
        id: generateId('env-drift', side === 'frontend' ? 'frontend' : 'backend'),
        category: 'env-drift',
        severity: 'high',
        layer: side === 'frontend' ? 'frontend' : 'backend',
        title: `Missing environment variable: ${varName}`,
        description: `\`${varName}\` is referenced in ${side} code but not defined in any .env file. This will be \`undefined\` at runtime.`,
        evidence: files.map((f) => ({
          file: f,
          line: 0,
          snippet: `process.env.${varName}`,
          side: side as 'frontend' | 'backend',
        })),
        suggestion: `Add \`${varName}=<value>\` to your .env file.`,
      });
    }
  }

  // Frontend using non-public vars (Next.js NEXT_PUBLIC_ prefix)
  if (project.frontendFramework.startsWith('next')) {
    for (const ref of frontend.envRefs) {
      if (!ref.isPublic && !isBuiltinEnvVar(ref.variable)) {
        // Check if this is in a server component or server-side code
        if (!isServerSideFile(ref.file)) {
          issues.push({
            id: generateId('env-drift', 'frontend'),
            category: 'env-drift',
            severity: 'medium',
            layer: 'frontend',
            title: `Client-side code uses non-public env var: ${ref.variable}`,
            description: `\`${ref.variable}\` doesn't have the \`NEXT_PUBLIC_\` prefix but is used in what appears to be client-side code. It will be \`undefined\` in the browser.`,
            evidence: [{
              file: ref.file,
              line: ref.line,
              snippet: `process.env.${ref.variable}`,
              side: 'frontend',
            }],
            suggestion: `Either rename to \`NEXT_PUBLIC_${ref.variable}\` or move this code to a server component / API route.`,
          });
        }
      }
    }
  }

  // Env vars defined in .env.example but not in .env
  const exampleFile = project.envFiles.find((f) => f.includes('.example'));
  const mainFile = project.envFiles.find((f) => f.endsWith('.env') || f.endsWith('.env.local'));
  if (exampleFile && mainFile) {
    const exampleVars = parseEnvFile(exampleFile);
    const mainVars = parseEnvFile(mainFile);
    for (const varName of exampleVars.keys()) {
      if (!mainVars.has(varName)) {
        issues.push({
          id: generateId('env-drift', 'cross-stack'),
          category: 'env-drift',
          severity: 'low',
          layer: 'cross-stack',
          title: `Env var in example but not in active env: ${varName}`,
          description: `\`${varName}\` is defined in \`.env.example\` but missing from the active \`.env\` file.`,
          evidence: [{
            file: path.basename(exampleFile),
            line: 0,
            snippet: `${varName}=...`,
            side: 'backend',
          }],
          suggestion: `Copy \`${varName}\` from .env.example to your active .env file.`,
        });
      }
    }
  }

  return { issues, definedVars, frontendRefs, backendRefs };
}

// ─── .env File Parsing ───────────────────────────────────────────────────────

function parseEnvFiles(envFiles: string[]): Map<string, string[]> {
  const vars = new Map<string, string[]>();

  for (const file of envFiles) {
    const fileVars = parseEnvFile(file);
    for (const [key] of fileVars) {
      const existing = vars.get(key) || [];
      existing.push(path.basename(file));
      vars.set(key, existing);
    }
  }

  return vars;
}

function parseEnvFile(filePath: string): Map<string, string> {
  const vars = new Map<string, string>();

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        vars.set(key, value);
      }
    }
  } catch {
    // File might not exist
  }

  return vars;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BUILTIN_ENV_VARS = new Set([
  'NODE_ENV', 'PORT', 'HOST', 'HOME', 'PATH', 'PWD', 'USER',
  'VERCEL', 'VERCEL_URL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA',
  'CI', 'NODE_PATH', 'TZ', 'LANG', 'SHELL',
]);

function isBuiltinEnvVar(name: string): boolean {
  return BUILTIN_ENV_VARS.has(name);
}

function isServerSideFile(relPath: string): boolean {
  return (
    relPath.includes('/api/') ||
    relPath.includes('/server/') ||
    relPath.endsWith('.server.ts') ||
    relPath.endsWith('.server.js') ||
    relPath.includes('middleware')
  );
}
