// ─── Severity & Categories ────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type IssueCategory =
  | 'contract-drift'
  | 'type-mismatch'
  | 'missing-error-handling'
  | 'over-fetching'
  | 'under-fetching'
  | 'auth-gap'
  | 'cors'
  | 'dead-endpoint'
  | 'phantom-call'
  | 'env-drift'
  | 'performance'
  | 'security'
  | 'data-flow';

export type IssueLayer = 'frontend' | 'backend' | 'cross-stack' | 'unknown';

// ─── Project Detection ───────────────────────────────────────────────────────

export type FrontendFramework =
  | 'next-app-router'
  | 'next-pages-router'
  | 'react'
  | 'vue'
  | 'svelte'
  | 'angular'
  | 'unknown';

export type BackendFramework =
  | 'next-api'
  | 'next-server-actions'
  | 'express'
  | 'fastify'
  | 'trpc'
  | 'graphql'
  | 'unknown';

export type ORM = 'prisma' | 'drizzle' | 'typeorm' | 'sequelize' | 'none';

export interface ProjectStructure {
  root: string;
  isMonorepo: boolean;
  frontendPaths: string[];
  backendPaths: string[];
  sharedPaths: string[];
  frontendFramework: FrontendFramework;
  backendFramework: BackendFramework;
  orm: ORM;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  typescript: boolean;
  envFiles: string[];
}

// ─── Frontend Analysis ───────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface FrontendApiCall {
  file: string;
  line: number;
  column: number;
  method: HttpMethod;
  url: string;
  urlIsTemplate: boolean;
  caller: 'fetch' | 'axios' | 'swr' | 'react-query' | 'server-action' | 'trpc' | 'graphql' | 'other';
  expectedFields: string[];
  hasErrorHandling: boolean;
  hasLoadingState: boolean;
  hasAuthHeader: boolean;
  rawSnippet: string;
}

export interface FrontendEnvRef {
  file: string;
  line: number;
  variable: string;
  isPublic: boolean;
}

// ─── Backend Analysis ────────────────────────────────────────────────────────

export interface BackendRoute {
  file: string;
  line: number;
  method: HttpMethod;
  path: string;
  pathIsPattern: boolean;
  hasAuth: boolean;
  hasValidation: boolean;
  hasErrorHandling: boolean;
  responseFields: string[];
  statusCodes: number[];
  rawSnippet: string;
}

export interface BackendEnvRef {
  file: string;
  line: number;
  variable: string;
}

// ─── Contract Analysis ───────────────────────────────────────────────────────

export interface ContractMismatch {
  type: 'url' | 'method' | 'fields' | 'auth' | 'validation';
  severity: Severity;
  frontendCall: FrontendApiCall;
  backendRoute: BackendRoute | null;
  message: string;
  suggestion: string;
}

export interface ContractReport {
  matched: Array<{
    frontend: FrontendApiCall;
    backend: BackendRoute;
    mismatches: ContractMismatch[];
  }>;
  deadEndpoints: BackendRoute[];
  phantomCalls: FrontendApiCall[];
  score: number;
}

// ─── Cross-Stack Issues ──────────────────────────────────────────────────────

export interface CrossStackIssue {
  id: string;
  category: IssueCategory;
  severity: Severity;
  layer: IssueLayer;
  title: string;
  description: string;
  evidence: Array<{
    file: string;
    line: number;
    snippet: string;
    side: 'frontend' | 'backend';
  }>;
  suggestion: string;
}

// ─── Health Score ────────────────────────────────────────────────────────────

export interface HealthDimension {
  name: string;
  score: number;
  maxScore: number;
  issues: number;
  details: string;
}

export interface HealthScore {
  overall: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: {
    contracts: HealthDimension;
    errorHandling: HealthDimension;
    security: HealthDimension;
    performance: HealthDimension;
    dataFlow: HealthDimension;
    environment: HealthDimension;
  };
}

// ─── Full Audit Report ───────────────────────────────────────────────────────

export interface FullStackAuditReport {
  project: ProjectStructure;
  timestamp: string;
  duration: number;
  frontendCalls: FrontendApiCall[];
  backendRoutes: BackendRoute[];
  contracts: ContractReport;
  issues: CrossStackIssue[];
  health: HealthScore;
  summary: string;
}

// ─── Dependency Map ──────────────────────────────────────────────────────────

export interface DependencyEdge {
  frontendFile: string;
  frontendLine: number;
  backendFile: string;
  backendRoute: string;
  method: HttpMethod;
  dataFields: string[];
}

export interface DependencyMap {
  edges: DependencyEdge[];
  frontendFiles: string[];
  backendFiles: string[];
  orphanedEndpoints: BackendRoute[];
  phantomCalls: FrontendApiCall[];
}

// ─── Issue Trace ─────────────────────────────────────────────────────────────

export interface IssueTrace {
  query: string;
  attribution: IssueLayer;
  confidence: number;
  chain: Array<{
    step: number;
    layer: IssueLayer;
    file: string;
    line: number;
    description: string;
    snippet: string;
  }>;
  rootCause: string;
  suggestion: string;
}
