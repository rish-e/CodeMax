import { FullStackAuditReport, CrossStackIssue, Severity, IssueCategory } from '../types.js';
import { VERSION } from '../server.js';

// ─── SARIF 2.1.0 Formatter ─────────────────────────────────────────────────
// Static Analysis Results Interchange Format — the standard consumed by
// GitHub Code Scanning, VS Code, and most CI/CD systems.
//
// Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html

interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
  invocations: SarifInvocation[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  defaultConfiguration: { level: SarifLevel };
  properties: { tags: string[] };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  fingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId?: string };
    region?: { startLine: number; startColumn?: number };
  };
  message?: { text: string };
}

interface SarifInvocation {
  executionSuccessful: boolean;
  toolExecutionNotifications?: Array<{
    level: SarifLevel;
    message: { text: string };
  }>;
  properties?: Record<string, unknown>;
}

type SarifLevel = 'error' | 'warning' | 'note' | 'none';

// ─── Category → Rule Definitions ────────────────────────────────────────────

const RULE_DEFINITIONS: Record<IssueCategory, { name: string; short: string; full: string; tags: string[] }> = {
  'contract-drift': {
    name: 'ContractDrift',
    short: 'Frontend-backend API contract mismatch',
    full: 'The frontend makes an API call that does not match the backend route handler in method, URL, or expected fields.',
    tags: ['cross-stack', 'api-contract'],
  },
  'type-mismatch': {
    name: 'TypeMismatch',
    short: 'Type mismatch between frontend and backend',
    full: 'The data types expected by the frontend do not match what the backend returns.',
    tags: ['cross-stack', 'type-safety'],
  },
  'missing-error-handling': {
    name: 'MissingErrorHandling',
    short: 'API call or route handler lacks error handling',
    full: 'An API call has no try/catch or .catch(), or a route handler has no error boundary.',
    tags: ['reliability', 'error-handling'],
  },
  'over-fetching': {
    name: 'OverFetching',
    short: 'Backend returns more data than frontend uses',
    full: 'The backend response contains fields that the frontend never accesses, wasting bandwidth and potentially leaking data.',
    tags: ['performance', 'data-flow'],
  },
  'under-fetching': {
    name: 'UnderFetching',
    short: 'Frontend expects fields the backend does not return',
    full: 'The frontend destructures or accesses fields that are not present in the backend response.',
    tags: ['cross-stack', 'data-flow'],
  },
  'auth-gap': {
    name: 'AuthGap',
    short: 'Authentication mismatch between frontend and backend',
    full: 'One side assumes authentication (sends or checks tokens) while the other does not.',
    tags: ['security', 'authentication'],
  },
  cors: {
    name: 'CorsIssue',
    short: 'CORS configuration problem',
    full: 'Cross-origin resource sharing is misconfigured between frontend origin and backend.',
    tags: ['security', 'cors'],
  },
  'dead-endpoint': {
    name: 'DeadEndpoint',
    short: 'Backend route with no frontend consumer',
    full: 'A backend route handler exists but no frontend code calls it. May be unused or consumed by external clients.',
    tags: ['maintenance', 'dead-code'],
  },
  'phantom-call': {
    name: 'PhantomCall',
    short: 'Frontend calls a non-existent backend endpoint',
    full: 'The frontend makes an API call to a URL that has no corresponding backend route handler.',
    tags: ['cross-stack', 'api-contract'],
  },
  'env-drift': {
    name: 'EnvDrift',
    short: 'Environment variable referenced but not defined',
    full: 'Code references a process.env variable that is not defined in any .env file, or uses a non-public prefix in client code.',
    tags: ['configuration', 'environment'],
  },
  performance: {
    name: 'PerformanceIssue',
    short: 'Cross-stack performance anti-pattern',
    full: 'A pattern was detected that causes unnecessary load, such as N+1 API calls or missing batching.',
    tags: ['performance'],
  },
  security: {
    name: 'SecurityIssue',
    short: 'Cross-stack security concern',
    full: 'A security issue was detected that spans frontend and backend, such as unprotected mutations or missing validation.',
    tags: ['security'],
  },
  'data-flow': {
    name: 'DataFlowIssue',
    short: 'Data flow inconsistency between layers',
    full: 'Data passing between frontend and backend has inconsistencies in field names, types, or structure.',
    tags: ['cross-stack', 'data-flow'],
  },
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function formatSarif(report: FullStackAuditReport): SarifLog {
  const rules = buildRules(report.issues);
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeMax',
            version: VERSION,
            informationUri: 'https://github.com/rish-e/codemax',
            rules,
          },
        },
        results: report.issues.map((issue) => formatResult(issue, ruleIndex, report.project.root)),
        invocations: [
          {
            executionSuccessful: true,
            properties: {
              healthScore: report.health.overall,
              healthGrade: report.health.grade,
              frontendCalls: report.frontendCalls.length,
              backendRoutes: report.backendRoutes.length,
              matchedContracts: report.contracts.matched.length,
              phantomCalls: report.contracts.phantomCalls.length,
              deadEndpoints: report.contracts.deadEndpoints.length,
              scanDurationMs: report.duration,
            },
          },
        ],
      },
    ],
  };
}

// ─── Builders ───────────────────────────────────────────────────────────────

function buildRules(issues: CrossStackIssue[]): SarifRule[] {
  // Only include rules for categories that appear in the results
  const categories = new Set(issues.map((i) => i.category));
  const rules: SarifRule[] = [];

  for (const category of categories) {
    const def = RULE_DEFINITIONS[category];
    if (!def) continue;

    rules.push({
      id: category,
      name: def.name,
      shortDescription: { text: def.short },
      fullDescription: { text: def.full },
      helpUri: 'https://github.com/rish-e/codemax#what-it-finds',
      defaultConfiguration: { level: categoryToDefaultLevel(category) },
      properties: { tags: def.tags },
    });
  }

  return rules;
}

function formatResult(
  issue: CrossStackIssue,
  ruleIndex: Map<string, number>,
  projectRoot: string,
): SarifResult {
  const locations: SarifLocation[] = issue.evidence.map((ev) => ({
    physicalLocation: {
      artifactLocation: {
        uri: toFileUri(ev.file, projectRoot),
        uriBaseId: '%SRCROOT%',
      },
      region: { startLine: ev.line },
    },
    message: { text: `${ev.side}: ${ev.snippet}` },
  }));

  // If no evidence, create a single location from the issue title
  if (locations.length === 0) {
    locations.push({
      physicalLocation: {
        artifactLocation: { uri: projectRoot, uriBaseId: '%SRCROOT%' },
      },
    });
  }

  return {
    ruleId: issue.category,
    ruleIndex: ruleIndex.get(issue.category) ?? 0,
    level: severityToLevel(issue.severity),
    message: {
      text: `${issue.title}\n\n${issue.description}\n\nFix: ${issue.suggestion}`,
    },
    locations,
    fingerprints: {
      'codemax/v1': issue.id,
    },
    properties: {
      layer: issue.layer,
      severity: issue.severity,
      category: issue.category,
    },
  };
}

// ─── Mappers ────────────────────────────────────────────────────────────────

function severityToLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'warning';
  }
}

function categoryToDefaultLevel(category: IssueCategory): SarifLevel {
  switch (category) {
    case 'phantom-call':
    case 'auth-gap':
    case 'security':
      return 'error';
    case 'contract-drift':
    case 'type-mismatch':
    case 'missing-error-handling':
    case 'env-drift':
      return 'warning';
    case 'dead-endpoint':
    case 'over-fetching':
    case 'under-fetching':
    case 'performance':
    case 'data-flow':
    case 'cors':
      return 'note';
    default:
      return 'warning';
  }
}

function toFileUri(filePath: string, projectRoot: string): string {
  // Make path relative to project root for SARIF
  const relative = filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length).replace(/^\//, '')
    : filePath;
  return relative;
}
