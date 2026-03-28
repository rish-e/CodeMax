import {
  CrossStackIssue,
  FrontendApiCall,
  BackendRoute,
  ContractReport,
  ProjectStructure,
  Severity,
} from '../types.js';
import { FrontendScanResult } from '../analyzers/frontend-scanner.js';
import { BackendScanResult } from '../analyzers/backend-scanner.js';
import { generateId } from '../utils/helpers.js';

// ─── Cross-Stack Correlator ──────────────────────────────────────────────────
// Takes raw scan results + contract analysis and produces cross-stack issues
// that neither UIMax nor BackendMax could find on their own.

export function correlateFindings(
  project: ProjectStructure,
  frontend: FrontendScanResult,
  backend: BackendScanResult,
  contracts: ContractReport,
): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  // 1. Phantom calls — frontend calls endpoints that don't exist
  issues.push(...analyzePhantomCalls(contracts.phantomCalls));

  // 2. Dead endpoints — backend routes with no frontend consumer
  issues.push(...analyzeDeadEndpoints(contracts.deadEndpoints));

  // 3. Contract mismatches → cross-stack issues
  issues.push(...contractMismatchesToIssues(contracts));

  // 4. Over-fetching detection
  issues.push(...detectOverFetching(contracts));

  // 5. Missing error boundaries
  issues.push(...detectMissingErrorBoundaries(frontend.apiCalls, backend.routes));

  // 6. Auth gap analysis
  issues.push(...detectAuthGaps(frontend.apiCalls, backend.routes));

  // 7. N+1 API patterns
  issues.push(...detectNPlusOnePatterns(frontend.apiCalls));

  // 8. Sequential calls that could be batched
  issues.push(...detectBatchingOpportunities(frontend.apiCalls));

  // Sort by severity
  issues.sort((a, b) => {
    const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return order[a.severity] - order[b.severity];
  });

  return issues;
}

// ─── Phantom Calls ───────────────────────────────────────────────────────────

function analyzePhantomCalls(phantomCalls: FrontendApiCall[]): CrossStackIssue[] {
  return phantomCalls.map((call) => ({
    id: generateId('phantom-call', 'cross-stack'),
    category: 'phantom-call' as const,
    severity: 'critical' as const,
    layer: 'cross-stack' as const,
    title: `Frontend calls non-existent endpoint: ${call.method} ${call.url}`,
    description: `The frontend makes a ${call.method} request to \`${call.url}\` but no matching backend route handler exists. This will result in a 404 error at runtime.`,
    evidence: [{
      file: call.file,
      line: call.line,
      snippet: call.rawSnippet,
      side: 'frontend' as const,
    }],
    suggestion: `Either create the backend route handler for \`${call.url}\` or fix the frontend URL.`,
  }));
}

// ─── Dead Endpoints ──────────────────────────────────────────────────────────

function analyzeDeadEndpoints(deadEndpoints: BackendRoute[]): CrossStackIssue[] {
  return deadEndpoints
    .filter((r) => !r.path.startsWith('server-action:')) // Server actions are called differently
    .map((route) => ({
      id: generateId('dead-endpoint', 'backend'),
      category: 'dead-endpoint' as const,
      severity: 'low' as const,
      layer: 'backend' as const,
      title: `Unused endpoint: ${route.method} ${route.path}`,
      description: `Backend exposes \`${route.method} ${route.path}\` but no frontend code calls it. This could be dead code, or it may be consumed by an external service not in this codebase.`,
      evidence: [{
        file: route.file,
        line: route.line,
        snippet: route.rawSnippet,
        side: 'backend' as const,
      }],
      suggestion: `If this endpoint is unused, consider removing it. If it's consumed externally, add a comment documenting the consumer.`,
    }));
}

// ─── Contract Mismatches ─────────────────────────────────────────────────────

function contractMismatchesToIssues(contracts: ContractReport): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  for (const match of contracts.matched) {
    for (const mismatch of match.mismatches) {
      const category = mismatch.type === 'fields' ? 'type-mismatch'
        : mismatch.type === 'auth' ? 'auth-gap'
        : mismatch.type === 'method' ? 'contract-drift'
        : 'contract-drift';

      issues.push({
        id: generateId(category as any, 'cross-stack'),
        category: category as any,
        severity: mismatch.severity,
        layer: 'cross-stack',
        title: mismatch.message,
        description: `${mismatch.message}. Frontend: ${match.frontend.file}:${match.frontend.line}, Backend: ${match.backend.file}:${match.backend.line}`,
        evidence: [
          {
            file: match.frontend.file,
            line: match.frontend.line,
            snippet: match.frontend.rawSnippet,
            side: 'frontend',
          },
          {
            file: match.backend.file,
            line: match.backend.line,
            snippet: match.backend.rawSnippet,
            side: 'backend',
          },
        ],
        suggestion: mismatch.suggestion,
      });
    }
  }

  return issues;
}

// ─── Over-Fetching ───────────────────────────────────────────────────────────

function detectOverFetching(contracts: ContractReport): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  for (const match of contracts.matched) {
    if (
      match.backend.responseFields.length > 5 &&
      match.frontend.expectedFields.length > 0 &&
      match.frontend.expectedFields.length < match.backend.responseFields.length * 0.5
    ) {
      const unusedFields = match.backend.responseFields.filter(
        (f) => !match.frontend.expectedFields.some((ef) => ef.includes(f)),
      );

      if (unusedFields.length > 3) {
        issues.push({
          id: generateId('over-fetching', 'cross-stack'),
          category: 'over-fetching',
          severity: 'medium',
          layer: 'cross-stack',
          title: `Over-fetching: ${match.frontend.method} ${match.frontend.url}`,
          description: `Backend returns ${match.backend.responseFields.length} fields but frontend only uses ${match.frontend.expectedFields.length}. Unused fields: [${unusedFields.slice(0, 5).join(', ')}${unusedFields.length > 5 ? ', ...' : ''}]. This wastes bandwidth and may leak sensitive data.`,
          evidence: [
            {
              file: match.frontend.file,
              line: match.frontend.line,
              snippet: `Uses: ${match.frontend.expectedFields.join(', ')}`,
              side: 'frontend',
            },
            {
              file: match.backend.file,
              line: match.backend.line,
              snippet: `Returns: ${match.backend.responseFields.join(', ')}`,
              side: 'backend',
            },
          ],
          suggestion: `Consider using field selection (GraphQL, Prisma select, or a DTO) to return only needed fields. Or split into a lean endpoint.`,
        });
      }
    }
  }

  return issues;
}

// ─── Missing Error Boundaries ────────────────────────────────────────────────

function detectMissingErrorBoundaries(
  frontendCalls: FrontendApiCall[],
  backendRoutes: BackendRoute[],
): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  // Find frontend calls without error handling that hit endpoints with error status codes
  for (const call of frontendCalls) {
    if (call.hasErrorHandling) continue;

    // Regardless of backend match, no error handling on API calls is risky
    if (call.caller !== 'server-action') {
      issues.push({
        id: generateId('missing-error-handling', 'frontend'),
        category: 'missing-error-handling',
        severity: 'medium',
        layer: 'frontend',
        title: `No error handling: ${call.method} ${call.url}`,
        description: `API call at ${call.file}:${call.line} has no try/catch, .catch(), or error callback. Network failures and non-200 responses will crash or silently fail.`,
        evidence: [{
          file: call.file,
          line: call.line,
          snippet: call.rawSnippet,
          side: 'frontend',
        }],
        suggestion: `Add error handling with try/catch or .catch() and show a user-friendly error message.`,
      });
    }
  }

  return issues;
}

// ─── Auth Gaps ───────────────────────────────────────────────────────────────

function detectAuthGaps(
  frontendCalls: FrontendApiCall[],
  backendRoutes: BackendRoute[],
): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  // Find mutation endpoints (POST/PUT/DELETE) with no auth on either side
  for (const route of backendRoutes) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.method)) continue;
    if (route.hasAuth) continue;
    if (route.path.startsWith('server-action:')) continue;

    issues.push({
      id: generateId('auth-gap', 'backend'),
      category: 'auth-gap',
      severity: 'high',
      layer: 'backend',
      title: `Unprotected mutation: ${route.method} ${route.path}`,
      description: `${route.method} endpoint at ${route.file}:${route.line} has no authentication check. Any client can modify data.`,
      evidence: [{
        file: route.file,
        line: route.line,
        snippet: route.rawSnippet,
        side: 'backend',
      }],
      suggestion: `Add authentication middleware or session check before processing the request.`,
    });
  }

  return issues;
}

// ─── N+1 API Patterns ───────────────────────────────────────────────────────

function detectNPlusOnePatterns(frontendCalls: FrontendApiCall[]): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  // Group calls by file
  const callsByFile = new Map<string, FrontendApiCall[]>();
  for (const call of frontendCalls) {
    const existing = callsByFile.get(call.file) || [];
    existing.push(call);
    callsByFile.set(call.file, existing);
  }

  for (const [file, calls] of callsByFile) {
    // Look for patterns like: fetch('/api/users') then for each user fetch('/api/users/:id/posts')
    const listCalls = calls.filter((c) => c.method === 'GET' && !c.url.includes(':param') && !c.urlIsTemplate);
    const detailCalls = calls.filter((c) => c.method === 'GET' && (c.url.includes(':param') || c.urlIsTemplate));

    if (listCalls.length > 0 && detailCalls.length > 0) {
      // Check if detail calls are in a loop-like context
      for (const detail of detailCalls) {
        for (const list of listCalls) {
          const listNorm = normalizeForComparison(list.url);
          const detailNorm = normalizeForComparison(detail.url);

          if (detailNorm.startsWith(listNorm) || areSimilarPaths(listNorm, detailNorm)) {
            issues.push({
              id: generateId('performance', 'cross-stack'),
              category: 'under-fetching',
              severity: 'medium',
              layer: 'cross-stack',
              title: `Potential N+1 API pattern in ${file}`,
              description: `File fetches a list from \`${list.url}\` and individual items from \`${detail.url}\`. If the detail call is in a loop, this creates N+1 requests.`,
              evidence: [
                { file, line: list.line, snippet: list.rawSnippet, side: 'frontend' },
                { file, line: detail.line, snippet: detail.rawSnippet, side: 'frontend' },
              ],
              suggestion: `Consider adding an endpoint that returns all needed data in one request, or use query parameters to batch fetch.`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// ─── Batching Opportunities ──────────────────────────────────────────────────

function detectBatchingOpportunities(frontendCalls: FrontendApiCall[]): CrossStackIssue[] {
  const issues: CrossStackIssue[] = [];

  // Group calls by file and find parallel independent calls
  const callsByFile = new Map<string, FrontendApiCall[]>();
  for (const call of frontendCalls) {
    const existing = callsByFile.get(call.file) || [];
    existing.push(call);
    callsByFile.set(call.file, existing);
  }

  for (const [file, calls] of callsByFile) {
    if (calls.length < 3) continue;

    // If same file makes 3+ API calls, suggest batching
    const getCalls = calls.filter((c) => c.method === 'GET');
    if (getCalls.length >= 3) {
      issues.push({
        id: generateId('performance', 'cross-stack'),
        category: 'performance',
        severity: 'low',
        layer: 'cross-stack',
        title: `${getCalls.length} parallel API calls in ${file}`,
        description: `This file makes ${getCalls.length} separate GET requests. Consider batching into fewer requests or using a BFF (Backend for Frontend) pattern to reduce network waterfall.`,
        evidence: getCalls.slice(0, 3).map((c) => ({
          file,
          line: c.line,
          snippet: `${c.method} ${c.url}`,
          side: 'frontend' as const,
        })),
        suggestion: `Create a combined endpoint or use Promise.all() to parallelize. For Next.js, consider using React Server Components to fetch on the server.`,
      });
    }
  }

  return issues;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeForComparison(url: string): string {
  return url
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/\/\[[^\]]+\]/g, '')
    .replace(/\/:[^/]+/g, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function areSimilarPaths(a: string, b: string): boolean {
  const aParts = a.split('/').filter(Boolean);
  const bParts = b.split('/').filter(Boolean);

  // If paths share the first 2 segments, they're related
  if (aParts.length >= 2 && bParts.length >= 2) {
    return aParts[0] === bParts[0] && aParts[1] === bParts[1];
  }

  return false;
}
