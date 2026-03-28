import {
  ContractReport,
  ContractMismatch,
  FrontendApiCall,
  BackendRoute,
  Severity,
} from '../types.js';
import { urlsMatch, normalizeApiPath } from '../utils/helpers.js';

// ─── Contract Analyzer ──────────────────────────────────────────────────────
// The heart of CodeMax: compares frontend API expectations against backend
// reality. Finds mismatches that neither side can detect alone.

export function analyzeContracts(
  frontendCalls: FrontendApiCall[],
  backendRoutes: BackendRoute[],
): ContractReport {
  const matched: ContractReport['matched'] = [];
  const matchedFrontendIndices = new Set<number>();
  const matchedBackendIndices = new Set<number>();

  // Phase 1: Match frontend calls to backend routes
  for (let fi = 0; fi < frontendCalls.length; fi++) {
    const call = frontendCalls[fi];

    // Skip non-API calls (external URLs, etc.)
    if (isExternalUrl(call.url)) continue;
    if (call.caller === 'server-action') {
      // Match server actions by name
      const actionName = call.url.replace('server-action:', '');
      const matchIdx = backendRoutes.findIndex(
        (r) => r.path === call.url || r.path.endsWith(`:${actionName}`),
      );
      if (matchIdx >= 0) {
        matchedFrontendIndices.add(fi);
        matchedBackendIndices.add(matchIdx);
        const mismatches = checkMismatches(call, backendRoutes[matchIdx]);
        matched.push({
          frontend: call,
          backend: backendRoutes[matchIdx],
          mismatches,
        });
      }
      continue;
    }

    // Match by URL + method
    let bestMatch: { index: number; route: BackendRoute; score: number } | null = null;

    for (let bi = 0; bi < backendRoutes.length; bi++) {
      const route = backendRoutes[bi];
      if (route.path.startsWith('server-action:')) continue;

      if (urlsMatch(call.url, route.path)) {
        const score = calculateMatchScore(call, route);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { index: bi, route, score };
        }
      }
    }

    if (bestMatch) {
      matchedFrontendIndices.add(fi);
      matchedBackendIndices.add(bestMatch.index);

      const mismatches = checkMismatches(call, bestMatch.route);
      matched.push({
        frontend: call,
        backend: bestMatch.route,
        mismatches,
      });
    }
  }

  // Phase 2: Identify dead endpoints (backend routes with no frontend consumer)
  const deadEndpoints = backendRoutes.filter((_, i) => !matchedBackendIndices.has(i));

  // Phase 3: Identify phantom calls (frontend calls to non-existent endpoints)
  const phantomCalls = frontendCalls.filter(
    (call, i) => !matchedFrontendIndices.has(i) && !isExternalUrl(call.url),
  );

  // Phase 4: Calculate contract score
  const totalEndpoints = backendRoutes.length;
  const totalCalls = frontendCalls.filter((c) => !isExternalUrl(c.url)).length;
  const totalMismatches = matched.reduce((sum, m) => sum + m.mismatches.length, 0);

  let score = 100;
  // Penalize phantom calls heavily (frontend expects something that doesn't exist)
  score -= phantomCalls.length * 15;
  // Penalize dead endpoints lightly (might be intentional / for other consumers)
  score -= deadEndpoints.length * 3;
  // Penalize mismatches by severity
  for (const m of matched) {
    for (const mismatch of m.mismatches) {
      score -= mismatch.severity === 'critical' ? 10 : mismatch.severity === 'high' ? 7 : mismatch.severity === 'medium' ? 4 : 2;
    }
  }

  return {
    matched,
    deadEndpoints,
    phantomCalls,
    score: Math.max(0, Math.min(100, score)),
  };
}

// ─── Mismatch Detection ─────────────────────────────────────────────────────

function checkMismatches(call: FrontendApiCall, route: BackendRoute): ContractMismatch[] {
  const mismatches: ContractMismatch[] = [];

  // 1. Method mismatch
  if (call.method !== route.method) {
    mismatches.push({
      type: 'method',
      severity: 'critical',
      frontendCall: call,
      backendRoute: route,
      message: `Frontend sends ${call.method} but backend expects ${route.method}`,
      suggestion: `Change the frontend to use ${route.method} or update the backend to handle ${call.method}`,
    });
  }

  // 2. Auth mismatch — frontend sends auth but backend doesn't check (or vice versa)
  if (call.hasAuthHeader && !route.hasAuth) {
    mismatches.push({
      type: 'auth',
      severity: 'medium',
      frontendCall: call,
      backendRoute: route,
      message: `Frontend sends authorization header but backend doesn't verify it`,
      suggestion: `Add authentication middleware to the backend route, or remove the auth header from the frontend if not needed`,
    });
  }

  if (!call.hasAuthHeader && route.hasAuth) {
    mismatches.push({
      type: 'auth',
      severity: 'high',
      frontendCall: call,
      backendRoute: route,
      message: `Backend expects authentication but frontend doesn't send credentials`,
      suggestion: `Add the Authorization header to the frontend fetch call`,
    });
  }

  // 3. Missing error handling on frontend
  if (!call.hasErrorHandling && route.statusCodes.some((c) => c >= 400)) {
    mismatches.push({
      type: 'validation',
      severity: 'medium',
      frontendCall: call,
      backendRoute: route,
      message: `Backend can return error status codes (${route.statusCodes.filter((c) => c >= 400).join(', ')}) but frontend has no error handling`,
      suggestion: `Add try/catch or .catch() to handle API errors gracefully`,
    });
  }

  // 4. Missing validation on backend for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(call.method) && !route.hasValidation) {
    mismatches.push({
      type: 'validation',
      severity: 'high',
      frontendCall: call,
      backendRoute: route,
      message: `${call.method} endpoint has no input validation — accepts any payload`,
      suggestion: `Add request body validation using Zod, Yup, or manual checks`,
    });
  }

  // 5. Field mismatch (if we have field data from both sides)
  if (call.expectedFields.length > 0 && route.responseFields.length > 0) {
    const missing = call.expectedFields.filter(
      (f) => !route.responseFields.some((rf) => fieldMatch(f, rf)),
    );

    if (missing.length > 0) {
      mismatches.push({
        type: 'fields',
        severity: 'high',
        frontendCall: call,
        backendRoute: route,
        message: `Frontend expects fields [${missing.join(', ')}] but backend doesn't return them. Backend returns: [${route.responseFields.join(', ')}]`,
        suggestion: `Either add the missing fields to the backend response or update the frontend to match`,
      });
    }
  }

  return mismatches;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function calculateMatchScore(call: FrontendApiCall, route: BackendRoute): number {
  let score = 0;

  // Exact URL match (post-normalization) = highest
  if (normalizeApiPath(call.url) === normalizeApiPath(route.path)) score += 10;

  // Method match
  if (call.method === route.method) score += 5;

  // Caller type bonus (server actions always POST)
  if (call.caller === 'server-action' && route.method === 'POST') score += 3;

  return score;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isExternalUrl(url: string): boolean {
  if (url.startsWith('server-action:')) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // If it points to localhost or relative, it's internal
    if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
    return true;
  }
  // Relative URLs and /api/ paths are internal
  return false;
}

function fieldMatch(feField: string, beField: string): boolean {
  // Exact match
  if (feField === beField) return true;

  // camelCase ↔ snake_case
  const feNorm = feField.toLowerCase().replace(/[_-]/g, '');
  const beNorm = beField.toLowerCase().replace(/[_-]/g, '');
  if (feNorm === beNorm) return true;

  // Nested field match: "user.name" matches "name" if context is right
  if (feField.includes('.')) {
    const lastPart = feField.split('.').pop()!;
    if (lastPart === beField) return true;
  }

  return false;
}
