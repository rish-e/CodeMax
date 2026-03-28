import { FullStackAuditReport, ProjectStructure, DependencyMap, IssueTrace, IssueLayer } from '../types.js';
import { detectProject } from '../analyzers/project-detector.js';
import { scanFrontend, FrontendScanResult } from '../analyzers/frontend-scanner.js';
import { scanBackend, BackendScanResult } from '../analyzers/backend-scanner.js';
import { analyzeEnvironment, EnvAnalysis } from '../analyzers/env-analyzer.js';
import { analyzeContracts } from './contract-analyzer.js';
import { correlateFindings } from './correlator.js';
import { calculateHealthScore } from './health-scorer.js';
import { resetIdCounter, pluralize, formatDuration, urlsMatch } from '../utils/helpers.js';

// ─── Full-Stack Audit Orchestrator ───────────────────────────────────────────
// Coordinates all analysis engines and produces a unified report.

export async function runFullStackAudit(projectPath: string): Promise<FullStackAuditReport> {
  const start = Date.now();
  resetIdCounter();

  // Phase 1: Detect project structure
  const project = detectProject(projectPath);

  // Phase 2: Scan both sides
  const frontend = scanFrontend(project);
  const backend = scanBackend(project);

  // Phase 3: Analyze environment
  const envAnalysis = analyzeEnvironment(project, frontend, backend);

  // Phase 4: Contract analysis (the core bridge logic)
  const contracts = analyzeContracts(frontend.apiCalls, backend.routes);

  // Phase 5: Cross-stack correlation
  const crossStackIssues = correlateFindings(project, frontend, backend, contracts);

  // Merge env issues into cross-stack issues
  const allIssues = [...crossStackIssues, ...envAnalysis.issues];

  // Phase 6: Health scoring
  const health = calculateHealthScore(
    allIssues,
    contracts,
    frontend.apiCalls,
    backend.routes,
    envAnalysis,
  );

  const duration = Date.now() - start;

  // Phase 7: Generate summary
  const summary = generateSummary(project, frontend, backend, contracts, allIssues, health, duration);

  return {
    project,
    timestamp: new Date().toISOString(),
    duration,
    frontendCalls: frontend.apiCalls,
    backendRoutes: backend.routes,
    contracts,
    issues: allIssues,
    health,
    summary,
  };
}

// ─── Dependency Mapping ──────────────────────────────────────────────────────

export async function mapDependencies(projectPath: string): Promise<DependencyMap> {
  const project = detectProject(projectPath);
  const frontend = scanFrontend(project);
  const backend = scanBackend(project);
  const contracts = analyzeContracts(frontend.apiCalls, backend.routes);

  const edges = contracts.matched.map((m) => ({
    frontendFile: m.frontend.file,
    frontendLine: m.frontend.line,
    backendFile: m.backend.file,
    backendRoute: `${m.backend.method} ${m.backend.path}`,
    method: m.frontend.method,
    dataFields: m.frontend.expectedFields,
  }));

  const frontendFiles = [...new Set(frontend.apiCalls.map((c) => c.file))];
  const backendFiles = [...new Set(backend.routes.map((r) => r.file))];

  return {
    edges,
    frontendFiles,
    backendFiles,
    orphanedEndpoints: contracts.deadEndpoints,
    phantomCalls: contracts.phantomCalls,
  };
}

// ─── Issue Tracing ───────────────────────────────────────────────────────────

export async function traceIssue(projectPath: string, query: string): Promise<IssueTrace> {
  const project = detectProject(projectPath);
  const frontend = scanFrontend(project);
  const backend = scanBackend(project);
  const contracts = analyzeContracts(frontend.apiCalls, backend.routes);

  const queryLower = query.toLowerCase();
  const chain: IssueTrace['chain'] = [];
  let attribution: IssueLayer = 'unknown';
  let confidence = 0;
  let rootCause = '';
  let suggestion = '';

  // Heuristic 1: Error mentions a URL → trace through the contract
  const urlMatch = query.match(/\/api\/[\w/-]+/);
  if (urlMatch) {
    const url = urlMatch[0];

    // Find matching backend route
    const matchedRoute = backend.routes.find((r) => urlsMatch(url, r.path));
    if (matchedRoute) {
      chain.push({
        step: chain.length + 1,
        layer: 'backend',
        file: matchedRoute.file,
        line: matchedRoute.line,
        description: `Backend handler for ${matchedRoute.method} ${matchedRoute.path}`,
        snippet: matchedRoute.rawSnippet,
      });

      if (!matchedRoute.hasErrorHandling) {
        attribution = 'backend';
        confidence = 0.7;
        rootCause = `Backend handler at ${matchedRoute.file}:${matchedRoute.line} has no error handling`;
        suggestion = 'Add try/catch with proper error responses';
      }
    } else {
      attribution = 'cross-stack';
      confidence = 0.8;
      rootCause = `No backend route matches ${url}`;
      suggestion = `Create the missing route handler or fix the frontend URL`;
    }

    // Find matching frontend calls
    const matchedCalls = frontend.apiCalls.filter((c) => urlsMatch(c.url, url));
    for (const call of matchedCalls) {
      chain.push({
        step: chain.length + 1,
        layer: 'frontend',
        file: call.file,
        line: call.line,
        description: `Frontend ${call.caller} call to ${call.method} ${call.url}`,
        snippet: call.rawSnippet,
      });
    }
  }

  // Heuristic 2: Error keywords → classify layer
  if (attribution === 'unknown') {
    if (queryLower.match(/\b(404|not found|endpoint|route)\b/)) {
      attribution = 'cross-stack';
      confidence = 0.6;
      rootCause = 'Likely a URL mismatch between frontend and backend';
      suggestion = 'Run `check_contracts` to find URL mismatches';
    } else if (queryLower.match(/\b(500|internal|database|query|prisma|sql)\b/)) {
      attribution = 'backend';
      confidence = 0.7;
      rootCause = 'Server-side error, likely in database query or business logic';
      suggestion = 'Check backend logs and error handling';
    } else if (queryLower.match(/\b(render|component|hook|state|ui|display|style|css)\b/)) {
      attribution = 'frontend';
      confidence = 0.7;
      rootCause = 'Frontend rendering or state management issue';
      suggestion = 'Check component props and state management';
    } else if (queryLower.match(/\b(cors|origin|cross-origin)\b/)) {
      attribution = 'cross-stack';
      confidence = 0.9;
      rootCause = 'CORS configuration mismatch between frontend origin and backend allowed origins';
      suggestion = 'Configure CORS headers on the backend to allow the frontend origin';
    } else if (queryLower.match(/\b(auth|token|session|unauthorized|401|403)\b/)) {
      attribution = 'cross-stack';
      confidence = 0.7;
      rootCause = 'Authentication flow issue between frontend and backend';
      suggestion = 'Verify token is being sent from frontend and validated on backend';
    } else if (queryLower.match(/\b(timeout|slow|loading|performance)\b/)) {
      attribution = 'cross-stack';
      confidence = 0.5;
      rootCause = 'Performance issue — could be frontend rendering, network, or backend processing';
      suggestion = 'Run `full_stack_audit` to identify bottlenecks on both sides';
    }
  }

  // Default fallback
  if (attribution === 'unknown') {
    attribution = 'cross-stack';
    confidence = 0.3;
    rootCause = 'Unable to determine root cause from the description alone';
    suggestion = 'Run `full_stack_audit` for a comprehensive analysis, or provide the specific error message';
  }

  return {
    query,
    attribution,
    confidence,
    chain,
    rootCause,
    suggestion,
  };
}

// ─── Quick Health Check ──────────────────────────────────────────────────────

export async function quickHealthCheck(projectPath: string): Promise<{
  project: ProjectStructure;
  health: import('../types.js').HealthScore;
  topIssues: import('../types.js').CrossStackIssue[];
  summary: string;
}> {
  const report = await runFullStackAudit(projectPath);

  return {
    project: report.project,
    health: report.health,
    topIssues: report.issues.slice(0, 5),
    summary: report.summary,
  };
}

// ─── Summary Generation ─────────────────────────────────────────────────────

function generateSummary(
  project: ProjectStructure,
  frontend: FrontendScanResult,
  backend: BackendScanResult,
  contracts: import('../types.js').ContractReport,
  issues: import('../types.js').CrossStackIssue[],
  health: import('../types.js').HealthScore,
  duration: number,
): string {
  const lines: string[] = [];

  lines.push(`# Full-Stack Audit Report — Grade: ${health.grade} (${health.overall}/100)`);
  lines.push('');
  lines.push(`**Project**: ${project.root}`);
  lines.push(`**Stack**: ${formatFramework(project.frontendFramework)} + ${formatFramework(project.backendFramework)}${project.orm !== 'none' ? ` + ${project.orm}` : ''}`);
  lines.push(`**Scanned**: ${pluralize(frontend.scannedFiles, 'frontend file')}, ${pluralize(backend.scannedFiles, 'backend file')} in ${formatDuration(duration)}`);
  lines.push('');

  // Quick stats
  lines.push('## Overview');
  lines.push(`- ${pluralize(frontend.apiCalls.length, 'frontend API call')} found`);
  lines.push(`- ${pluralize(backend.routes.length, 'backend route')} found`);
  lines.push(`- ${pluralize(contracts.matched.length, 'matched contract')}`);
  lines.push(`- ${pluralize(contracts.phantomCalls.length, 'phantom call')} (frontend → nowhere)`);
  lines.push(`- ${pluralize(contracts.deadEndpoints.length, 'dead endpoint')} (backend → unused)`);
  lines.push('');

  // Health dimensions
  lines.push('## Health Breakdown');
  for (const [, dim] of Object.entries(health.dimensions)) {
    const bar = scoreBar(dim.score, dim.maxScore);
    lines.push(`- **${dim.name}** ${bar} ${dim.score}/${dim.maxScore} — ${dim.details}`);
  }
  lines.push('');

  // Top issues
  if (issues.length > 0) {
    lines.push(`## Top Issues (${issues.length} total)`);
    const topIssues = issues.slice(0, 10);
    for (const issue of topIssues) {
      const icon = issue.severity === 'critical' ? '[CRITICAL]'
        : issue.severity === 'high' ? '[HIGH]'
        : issue.severity === 'medium' ? '[MEDIUM]'
        : '[LOW]';
      lines.push(`- ${icon} **${issue.title}**`);
      lines.push(`  ${issue.suggestion}`);
    }
    if (issues.length > 10) {
      lines.push(`  ... and ${issues.length - 10} more`);
    }
  } else {
    lines.push('## No issues found!');
    lines.push('Your full-stack integration looks clean.');
  }

  return lines.join('\n');
}

function scoreBar(score: number, max: number): string {
  const ratio = score / max;
  const filled = Math.round(ratio * 10);
  const empty = 10 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function formatFramework(framework: string): string {
  const names: Record<string, string> = {
    'next-app-router': 'Next.js (App Router)',
    'next-pages-router': 'Next.js (Pages Router)',
    'next-api': 'Next.js API Routes',
    'next-server-actions': 'Next.js Server Actions',
    react: 'React',
    vue: 'Vue',
    svelte: 'Svelte',
    angular: 'Angular',
    express: 'Express',
    fastify: 'Fastify',
    trpc: 'tRPC',
    graphql: 'GraphQL',
    unknown: 'Unknown',
  };
  return names[framework] || framework;
}
