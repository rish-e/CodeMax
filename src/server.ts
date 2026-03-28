import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  runFullStackAudit,
  mapDependencies,
  traceIssue,
  quickHealthCheck,
} from './bridge/orchestrator.js';
import { detectProject } from './analyzers/project-detector.js';
import { scanFrontend } from './analyzers/frontend-scanner.js';
import { scanBackend } from './analyzers/backend-scanner.js';
import { analyzeContracts } from './bridge/contract-analyzer.js';
import { analyzeEnvironment } from './analyzers/env-analyzer.js';

// ─── Server Factory ──────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'codemax',
      version: '1.0.0',
    },
    {
      capabilities: { logging: {} },
      instructions: `CodeMax is a full-stack code analysis MCP that bridges frontend and backend. It detects API contract drift, type mismatches, auth gaps, dead endpoints, phantom calls, and cross-stack performance issues that single-side tools miss. Use \`full_stack_audit\` for comprehensive analysis or \`health_check\` for a quick overview.`,
    },
  );

  registerTools(server);
  return server;
}

// ─── Tool Registration ───────────────────────────────────────────────────────

function registerTools(server: McpServer): void {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FULL-STACK AUDIT — the flagship tool
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'full_stack_audit',
    'Run a comprehensive full-stack analysis — scans frontend API calls, backend routes, cross-references contracts, detects mismatches, auth gaps, dead endpoints, and scores overall health. The complete picture.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const report = await runFullStackAudit(projectPath);
        return {
          content: [{
            type: 'text',
            text: report.summary + '\n\n---\n\n<details>\n<summary>Full JSON Report</summary>\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n</details>',
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error running full-stack audit: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. HEALTH CHECK — quick overview
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'health_check',
    'Quick full-stack health score with the top 5 issues. Faster than a full audit — use for a pulse check.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const result = await quickHealthCheck(projectPath);
        const lines: string[] = [];

        lines.push(`# Health: ${result.health.grade} (${result.health.overall}/100)`);
        lines.push('');

        for (const [, dim] of Object.entries(result.health.dimensions)) {
          const pct = Math.round((dim.score / dim.maxScore) * 100);
          lines.push(`**${dim.name}**: ${pct}% — ${dim.details}`);
        }

        if (result.topIssues.length > 0) {
          lines.push('');
          lines.push('## Top Issues');
          for (const issue of result.topIssues) {
            lines.push(`- [${issue.severity.toUpperCase()}] ${issue.title}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CHECK CONTRACTS — API contract verification
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'check_contracts',
    'Compare frontend API calls against backend routes. Find phantom calls (frontend → nowhere), dead endpoints (backend → unused), method mismatches, auth gaps, and field drift.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const project = detectProject(projectPath);
        const frontend = scanFrontend(project);
        const backend = scanBackend(project);
        const contracts = analyzeContracts(frontend.apiCalls, backend.routes);

        const lines: string[] = [];
        lines.push(`# API Contract Report — Score: ${contracts.score}/100`);
        lines.push('');
        lines.push(`**Frontend calls**: ${frontend.apiCalls.length}`);
        lines.push(`**Backend routes**: ${backend.routes.length}`);
        lines.push(`**Matched**: ${contracts.matched.length}`);
        lines.push('');

        if (contracts.phantomCalls.length > 0) {
          lines.push('## Phantom Calls (frontend calls with no backend handler)');
          for (const call of contracts.phantomCalls) {
            lines.push(`- **${call.method} ${call.url}** at ${call.file}:${call.line}`);
          }
          lines.push('');
        }

        if (contracts.deadEndpoints.length > 0) {
          lines.push('## Dead Endpoints (backend routes with no frontend consumer)');
          for (const route of contracts.deadEndpoints) {
            lines.push(`- **${route.method} ${route.path}** at ${route.file}:${route.line}`);
          }
          lines.push('');
        }

        const mismatchEntries = contracts.matched.filter((m) => m.mismatches.length > 0);
        if (mismatchEntries.length > 0) {
          lines.push('## Mismatches');
          for (const entry of mismatchEntries) {
            lines.push(`### ${entry.frontend.method} ${entry.frontend.url}`);
            for (const mm of entry.mismatches) {
              lines.push(`- [${mm.severity.toUpperCase()}] ${mm.message}`);
              lines.push(`  Fix: ${mm.suggestion}`);
            }
          }
          lines.push('');
        }

        if (contracts.phantomCalls.length === 0 && contracts.deadEndpoints.length === 0 && mismatchEntries.length === 0) {
          lines.push('All contracts are clean — frontend and backend are in sync.');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. TRACE ISSUE — debug attribution
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'trace_issue',
    'Given a bug description or error message, determine whether it\'s a frontend, backend, or cross-stack issue. Traces through the call chain and identifies the root cause.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
      issue: z.string().describe('Bug description, error message, or symptom to trace'),
    },
    async ({ projectPath, issue }) => {
      try {
        const trace = await traceIssue(projectPath, issue);

        const lines: string[] = [];
        lines.push(`# Issue Trace: ${trace.attribution} (${Math.round(trace.confidence * 100)}% confidence)`);
        lines.push('');
        lines.push(`**Query**: ${trace.query}`);
        lines.push(`**Root cause**: ${trace.rootCause}`);
        lines.push(`**Suggestion**: ${trace.suggestion}`);
        lines.push('');

        if (trace.chain.length > 0) {
          lines.push('## Trace Chain');
          for (const step of trace.chain) {
            lines.push(`${step.step}. [${step.layer}] **${step.file}:${step.line}**`);
            lines.push(`   ${step.description}`);
            if (step.snippet) {
              lines.push('   ```');
              lines.push(`   ${step.snippet.split('\n').join('\n   ')}`);
              lines.push('   ```');
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. MAP DEPENDENCIES — frontend ↔ backend dependency graph
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'map_dependencies',
    'Map all connections between frontend components and backend endpoints. Shows which frontend files depend on which API routes, plus orphaned endpoints and phantom calls.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const map = await mapDependencies(projectPath);

        const lines: string[] = [];
        lines.push('# Dependency Map');
        lines.push('');
        lines.push(`**Connected edges**: ${map.edges.length}`);
        lines.push(`**Frontend files with API calls**: ${map.frontendFiles.length}`);
        lines.push(`**Backend route files**: ${map.backendFiles.length}`);
        lines.push('');

        if (map.edges.length > 0) {
          lines.push('## Connections');
          lines.push('');
          lines.push('| Frontend File | → | Backend Route | Fields |');
          lines.push('|---|---|---|---|');
          for (const edge of map.edges) {
            const fields = edge.dataFields.length > 0 ? edge.dataFields.join(', ') : '—';
            lines.push(`| ${edge.frontendFile}:${edge.frontendLine} | ${edge.method} | ${edge.backendRoute} | ${fields} |`);
          }
          lines.push('');
        }

        if (map.orphanedEndpoints.length > 0) {
          lines.push('## Orphaned Endpoints (no frontend consumer)');
          for (const ep of map.orphanedEndpoints) {
            lines.push(`- ${ep.method} ${ep.path} (${ep.file}:${ep.line})`);
          }
          lines.push('');
        }

        if (map.phantomCalls.length > 0) {
          lines.push('## Phantom Calls (no backend handler)');
          for (const call of map.phantomCalls) {
            lines.push(`- ${call.method} ${call.url} (${call.file}:${call.line})`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SCAN FRONTEND — frontend-only analysis
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'scan_frontend',
    'Scan frontend code for all API calls, data fetching patterns, environment variable usage, and error handling gaps.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const project = detectProject(projectPath);
        const result = scanFrontend(project);

        const lines: string[] = [];
        lines.push('# Frontend Scan Results');
        lines.push('');
        lines.push(`**Files scanned**: ${result.scannedFiles}/${result.totalFiles}`);
        lines.push(`**API calls found**: ${result.apiCalls.length}`);
        lines.push(`**Env vars referenced**: ${result.envRefs.length}`);
        lines.push('');

        if (result.apiCalls.length > 0) {
          lines.push('## API Calls');
          lines.push('');
          lines.push('| Method | URL | Caller | File | Error Handling | Auth |');
          lines.push('|--------|-----|--------|------|----------------|------|');
          for (const call of result.apiCalls) {
            lines.push(
              `| ${call.method} | ${call.url} | ${call.caller} | ${call.file}:${call.line} | ${call.hasErrorHandling ? 'Yes' : '**No**'} | ${call.hasAuthHeader ? 'Yes' : 'No'} |`,
            );
          }
          lines.push('');
        }

        if (result.envRefs.length > 0) {
          lines.push('## Environment Variables');
          for (const ref of result.envRefs) {
            lines.push(`- \`${ref.variable}\` in ${ref.file}:${ref.line}${ref.isPublic ? '' : ' (not public-prefixed)'}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. SCAN BACKEND — backend-only analysis
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'scan_backend',
    'Scan backend code for all route handlers, middleware, authentication patterns, validation, and error handling.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const project = detectProject(projectPath);
        const result = scanBackend(project);

        const lines: string[] = [];
        lines.push('# Backend Scan Results');
        lines.push('');
        lines.push(`**Files scanned**: ${result.scannedFiles}/${result.totalFiles}`);
        lines.push(`**Routes found**: ${result.routes.length}`);
        lines.push(`**Env vars referenced**: ${result.envRefs.length}`);
        lines.push('');

        if (result.routes.length > 0) {
          lines.push('## Routes');
          lines.push('');
          lines.push('| Method | Path | File | Auth | Validation | Error Handling |');
          lines.push('|--------|------|------|------|------------|----------------|');
          for (const route of result.routes) {
            lines.push(
              `| ${route.method} | ${route.path} | ${route.file}:${route.line} | ${route.hasAuth ? 'Yes' : '**No**'} | ${route.hasValidation ? 'Yes' : '**No**'} | ${route.hasErrorHandling ? 'Yes' : '**No**'} |`,
            );
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. CHECK ENV — environment variable analysis
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'check_env',
    'Cross-reference environment variables across .env files, frontend code, and backend code. Find missing vars, public/private prefix issues, and drift between .env.example and .env.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const project = detectProject(projectPath);
        const frontend = scanFrontend(project);
        const backend = scanBackend(project);
        const envAnalysis = analyzeEnvironment(project, frontend, backend);

        const lines: string[] = [];
        lines.push('# Environment Analysis');
        lines.push('');
        lines.push(`**Env files found**: ${project.envFiles.length}`);
        lines.push(`**Defined vars**: ${envAnalysis.definedVars.size}`);
        lines.push(`**Frontend refs**: ${envAnalysis.frontendRefs.size} unique vars`);
        lines.push(`**Backend refs**: ${envAnalysis.backendRefs.size} unique vars`);
        lines.push('');

        if (envAnalysis.issues.length > 0) {
          lines.push('## Issues');
          for (const issue of envAnalysis.issues) {
            lines.push(`- [${issue.severity.toUpperCase()}] ${issue.title}`);
            lines.push(`  ${issue.description}`);
          }
        } else {
          lines.push('No environment issues found.');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. DETECT PROJECT — project structure detection
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    'detect_project',
    'Analyze and report the project structure — frameworks, ORM, monorepo detection, frontend/backend path separation, package manager, and TypeScript usage.',
    {
      projectPath: z.string().describe('Absolute path to the project root directory'),
    },
    async ({ projectPath }) => {
      try {
        const project = detectProject(projectPath);

        const lines: string[] = [];
        lines.push('# Project Structure');
        lines.push('');
        lines.push(`| Property | Value |`);
        lines.push(`|----------|-------|`);
        lines.push(`| Root | ${project.root} |`);
        lines.push(`| Monorepo | ${project.isMonorepo ? 'Yes' : 'No'} |`);
        lines.push(`| Frontend | ${project.frontendFramework} |`);
        lines.push(`| Backend | ${project.backendFramework} |`);
        lines.push(`| ORM | ${project.orm} |`);
        lines.push(`| Package Manager | ${project.packageManager} |`);
        lines.push(`| TypeScript | ${project.typescript ? 'Yes' : 'No'} |`);
        lines.push(`| Env Files | ${project.envFiles.length > 0 ? project.envFiles.map((f) => f.split('/').pop()).join(', ') : 'None'} |`);
        lines.push('');

        if (project.frontendPaths.length > 0) {
          lines.push('**Frontend paths**: ' + project.frontendPaths.join(', '));
        }
        if (project.backendPaths.length > 0) {
          lines.push('**Backend paths**: ' + project.backendPaths.join(', '));
        }
        if (project.sharedPaths.length > 0) {
          lines.push('**Shared paths**: ' + project.sharedPaths.join(', '));
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
