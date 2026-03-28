import {
  HealthScore,
  HealthDimension,
  CrossStackIssue,
  ContractReport,
  FrontendApiCall,
  BackendRoute,
} from '../types.js';
import { calculateGrade } from '../utils/helpers.js';
import { EnvAnalysis } from '../analyzers/env-analyzer.js';

// ─── Health Scorer ───────────────────────────────────────────────────────────
// Calculates a 0-100 health score across 6 dimensions:
// contracts, error handling, security, performance, data flow, environment.

export function calculateHealthScore(
  issues: CrossStackIssue[],
  contracts: ContractReport,
  frontendCalls: FrontendApiCall[],
  backendRoutes: BackendRoute[],
  envAnalysis: EnvAnalysis,
): HealthScore {
  const dimensions = {
    contracts: scoreContracts(contracts, issues),
    errorHandling: scoreErrorHandling(frontendCalls, backendRoutes, issues),
    security: scoreSecurity(backendRoutes, issues),
    performance: scorePerformance(issues),
    dataFlow: scoreDataFlow(contracts, issues),
    environment: scoreEnvironment(envAnalysis),
  };

  // Weighted average
  const weights = {
    contracts: 25,
    errorHandling: 20,
    security: 25,
    performance: 10,
    dataFlow: 10,
    environment: 10,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, dim] of Object.entries(dimensions)) {
    const weight = weights[key as keyof typeof weights];
    weightedSum += (dim.score / dim.maxScore) * weight;
    totalWeight += weight;
  }

  const overall = Math.round((weightedSum / totalWeight) * 100);

  return {
    overall,
    grade: calculateGrade(overall),
    dimensions,
  };
}

// ─── Dimension Scorers ───────────────────────────────────────────────────────

function scoreContracts(contracts: ContractReport, issues: CrossStackIssue[]): HealthDimension {
  const maxScore = 100;
  let score = contracts.score;

  const contractIssues = issues.filter((i) =>
    ['contract-drift', 'type-mismatch', 'phantom-call', 'dead-endpoint'].includes(i.category),
  );

  return {
    name: 'API Contracts',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: contractIssues.length,
    details: contractIssues.length === 0
      ? 'All frontend calls match backend routes'
      : `${contracts.phantomCalls.length} phantom calls, ${contracts.deadEndpoints.length} dead endpoints, ${contracts.matched.reduce((s, m) => s + m.mismatches.length, 0)} mismatches`,
  };
}

function scoreErrorHandling(
  frontendCalls: FrontendApiCall[],
  backendRoutes: BackendRoute[],
  issues: CrossStackIssue[],
): HealthDimension {
  const maxScore = 100;
  let score = maxScore;

  // Frontend: penalize calls without error handling
  const callsWithoutHandling = frontendCalls.filter((c) => !c.hasErrorHandling);
  const feRatio = frontendCalls.length > 0
    ? callsWithoutHandling.length / frontendCalls.length
    : 0;
  score -= Math.round(feRatio * 40);

  // Backend: penalize routes without error handling
  const routesWithoutHandling = backendRoutes.filter((r) => !r.hasErrorHandling);
  const beRatio = backendRoutes.length > 0
    ? routesWithoutHandling.length / backendRoutes.length
    : 0;
  score -= Math.round(beRatio * 40);

  // Additional penalty from cross-stack issues
  const errorIssues = issues.filter((i) => i.category === 'missing-error-handling');
  score -= errorIssues.length * 5;

  return {
    name: 'Error Handling',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: callsWithoutHandling.length + routesWithoutHandling.length,
    details: `${callsWithoutHandling.length}/${frontendCalls.length} frontend calls missing error handling, ${routesWithoutHandling.length}/${backendRoutes.length} backend routes missing try/catch`,
  };
}

function scoreSecurity(
  backendRoutes: BackendRoute[],
  issues: CrossStackIssue[],
): HealthDimension {
  const maxScore = 100;
  let score = maxScore;

  // Penalize unprotected mutations
  const mutations = backendRoutes.filter((r) =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !r.path.startsWith('server-action:'),
  );
  const unprotected = mutations.filter((r) => !r.hasAuth);
  if (mutations.length > 0) {
    score -= Math.round((unprotected.length / mutations.length) * 50);
  }

  // Penalize mutations without validation
  const unvalidated = mutations.filter((r) => !r.hasValidation);
  if (mutations.length > 0) {
    score -= Math.round((unvalidated.length / mutations.length) * 30);
  }

  const securityIssues = issues.filter((i) =>
    ['auth-gap', 'security'].includes(i.category),
  );
  score -= securityIssues.length * 5;

  return {
    name: 'Security',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: unprotected.length + unvalidated.length,
    details: `${unprotected.length} unprotected mutation${unprotected.length !== 1 ? 's' : ''}, ${unvalidated.length} unvalidated endpoint${unvalidated.length !== 1 ? 's' : ''}`,
  };
}

function scorePerformance(issues: CrossStackIssue[]): HealthDimension {
  const maxScore = 100;
  let score = maxScore;

  const perfIssues = issues.filter((i) =>
    ['over-fetching', 'under-fetching', 'performance'].includes(i.category),
  );

  for (const issue of perfIssues) {
    score -= issue.severity === 'critical' ? 20
      : issue.severity === 'high' ? 15
      : issue.severity === 'medium' ? 8
      : 3;
  }

  return {
    name: 'Performance',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: perfIssues.length,
    details: perfIssues.length === 0
      ? 'No performance anti-patterns detected'
      : `${perfIssues.length} performance issue${perfIssues.length !== 1 ? 's' : ''} found`,
  };
}

function scoreDataFlow(contracts: ContractReport, issues: CrossStackIssue[]): HealthDimension {
  const maxScore = 100;
  let score = maxScore;

  // Penalize type mismatches and field issues
  const dataIssues = issues.filter((i) =>
    ['type-mismatch', 'data-flow'].includes(i.category),
  );
  score -= dataIssues.length * 10;

  // Bonus for matched contracts with no mismatches
  const cleanMatches = contracts.matched.filter((m) => m.mismatches.length === 0);
  if (contracts.matched.length > 0) {
    const cleanRatio = cleanMatches.length / contracts.matched.length;
    score = Math.round(score * (0.5 + cleanRatio * 0.5));
  }

  return {
    name: 'Data Flow',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: dataIssues.length,
    details: `${cleanMatches.length}/${contracts.matched.length} API contracts are clean`,
  };
}

function scoreEnvironment(envAnalysis: EnvAnalysis): HealthDimension {
  const maxScore = 100;
  let score = maxScore;

  const envIssues = envAnalysis.issues;
  for (const issue of envIssues) {
    score -= issue.severity === 'high' ? 15 : issue.severity === 'medium' ? 8 : 3;
  }

  return {
    name: 'Environment',
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    issues: envIssues.length,
    details: envIssues.length === 0
      ? 'All environment variables are properly configured'
      : `${envIssues.length} environment issue${envIssues.length !== 1 ? 's' : ''}`,
  };
}
