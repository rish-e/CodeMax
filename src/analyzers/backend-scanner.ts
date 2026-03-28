import * as path from 'node:path';
import * as fs from 'node:fs';
import { BackendRoute, BackendEnvRef, HttpMethod, ProjectStructure } from '../types.js';
import { collectFiles, readFileSafe, relativePath, extractSnippet } from '../utils/helpers.js';

// ─── Backend Scanner ─────────────────────────────────────────────────────────
// Scans backend code for route handlers, middleware, environment usage, and
// response patterns across multiple framework conventions.

export interface BackendScanResult {
  routes: BackendRoute[];
  envRefs: BackendEnvRef[];
  totalFiles: number;
  scannedFiles: number;
}

export function scanBackend(project: ProjectStructure): BackendScanResult {
  const routes: BackendRoute[] = [];
  const envRefs: BackendEnvRef[] = [];

  const searchPaths = project.backendPaths.length > 0
    ? project.backendPaths
    : [project.root];

  const allFiles: string[] = [];
  for (const searchPath of searchPaths) {
    allFiles.push(...collectFiles(searchPath));
  }

  const uniqueFiles = [...new Set(allFiles)];
  let scannedFiles = 0;

  for (const file of uniqueFiles) {
    const content = readFileSafe(file);
    if (!content) continue;
    scannedFiles++;

    const rel = relativePath(project.root, file);

    // Next.js App Router API routes
    if (isNextAppApiRoute(rel)) {
      routes.push(...extractNextAppRoutes(file, content, rel, project.root));
    }
    // Next.js Pages API routes
    else if (isNextPagesApiRoute(rel)) {
      routes.push(...extractNextPagesRoutes(file, content, rel, project.root));
    }
    // Express routes
    else if (hasExpressPatterns(content)) {
      routes.push(...extractExpressRoutes(file, content, project.root));
    }
    // Server Actions
    else if (isServerAction(content)) {
      routes.push(...extractServerActions(file, content, project.root));
    }

    // Environment variable references
    envRefs.push(...extractBackendEnvRefs(file, content, project.root));
  }

  return {
    routes,
    envRefs,
    totalFiles: uniqueFiles.length,
    scannedFiles,
  };
}

// ─── Next.js App Router ──────────────────────────────────────────────────────

function isNextAppApiRoute(rel: string): boolean {
  return /(?:app|src\/app)\/api\/.*route\.(ts|js|tsx|jsx)$/.test(rel);
}

function extractNextAppRoutes(file: string, content: string, rel: string, root: string): BackendRoute[] {
  const routes: BackendRoute[] = [];
  const routePath = filePathToApiPath(rel, 'app-router');

  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  for (const method of methods) {
    const regex = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const funcBody = extractFunctionBody(content, match.index);

      routes.push({
        file: relativePath(root, file),
        line: lineNum,
        method,
        path: routePath,
        pathIsPattern: routePath.includes(':param'),
        hasAuth: detectAuth(funcBody),
        hasValidation: detectValidation(funcBody),
        hasErrorHandling: detectErrorHandling(funcBody),
        responseFields: extractResponseFields(funcBody),
        statusCodes: extractStatusCodes(funcBody),
        rawSnippet: extractSnippet(content, lineNum, 2),
      });
    }
  }

  return routes;
}

// ─── Next.js Pages Router ────────────────────────────────────────────────────

function isNextPagesApiRoute(rel: string): boolean {
  return /(?:pages|src\/pages)\/api\/.*\.(ts|js|tsx|jsx)$/.test(rel);
}

function extractNextPagesRoutes(file: string, content: string, rel: string, root: string): BackendRoute[] {
  const routes: BackendRoute[] = [];
  const routePath = filePathToApiPath(rel, 'pages-router');

  // Default export handler
  const defaultExport = content.match(/export\s+default\s+(?:async\s+)?function/);
  if (defaultExport) {
    const lineNum = content.substring(0, defaultExport.index).split('\n').length;
    const funcBody = extractFunctionBody(content, defaultExport.index!);

    // Detect which methods the handler supports
    const methodChecks = funcBody.match(/req\.method\s*===?\s*['"](\w+)['"]/g) || [];
    const methods: HttpMethod[] = methodChecks.length > 0
      ? methodChecks.map((m) => {
          const match = m.match(/['"](\w+)['"]/);
          return (match?.[1]?.toUpperCase() || 'GET') as HttpMethod;
        })
      : ['GET', 'POST']; // Default assumption

    for (const method of methods) {
      routes.push({
        file: relativePath(root, file),
        line: lineNum,
        method,
        path: routePath,
        pathIsPattern: routePath.includes(':param'),
        hasAuth: detectAuth(funcBody),
        hasValidation: detectValidation(funcBody),
        hasErrorHandling: detectErrorHandling(funcBody),
        responseFields: extractResponseFields(funcBody),
        statusCodes: extractStatusCodes(funcBody),
        rawSnippet: extractSnippet(content, lineNum, 2),
      });
    }
  }

  return routes;
}

// ─── Express Routes ──────────────────────────────────────────────────────────

function hasExpressPatterns(content: string): boolean {
  return /\b(app|router)\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(/.test(content);
}

function extractExpressRoutes(file: string, content: string, root: string): BackendRoute[] {
  const routes: BackendRoute[] = [];
  const regex = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])(.*?)\2/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const method = match[1].toUpperCase() as HttpMethod;
    const routePath = match[3];
    const lineNum = content.substring(0, match.index).split('\n').length;

    // Get the handler body (approximate)
    const handlerStart = content.indexOf('{', match.index + match[0].length);
    const handlerBody = handlerStart >= 0
      ? extractBracedBlock(content, handlerStart)
      : content.substring(match.index, Math.min(content.length, match.index + 500));

    routes.push({
      file: relativePath(root, file),
      line: lineNum,
      method: (method as string) === 'ALL' ? 'GET' : method,
      path: routePath.startsWith('/') ? routePath : `/${routePath}`,
      pathIsPattern: routePath.includes(':'),
      hasAuth: detectAuth(handlerBody),
      hasValidation: detectValidation(handlerBody),
      hasErrorHandling: detectErrorHandling(handlerBody),
      responseFields: extractResponseFields(handlerBody),
      statusCodes: extractStatusCodes(handlerBody),
      rawSnippet: extractSnippet(content, lineNum, 2),
    });
  }

  return routes;
}

// ─── Server Actions ──────────────────────────────────────────────────────────

function isServerAction(content: string): boolean {
  return content.includes("'use server'") || content.includes('"use server"');
}

function extractServerActions(file: string, content: string, root: string): BackendRoute[] {
  const routes: BackendRoute[] = [];
  const regex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const actionName = match[1];
    const lineNum = content.substring(0, match.index).split('\n').length;
    const funcBody = extractFunctionBody(content, match.index);

    routes.push({
      file: relativePath(root, file),
      line: lineNum,
      method: 'POST',
      path: `server-action:${actionName}`,
      pathIsPattern: false,
      hasAuth: detectAuth(funcBody),
      hasValidation: detectValidation(funcBody),
      hasErrorHandling: detectErrorHandling(funcBody),
      responseFields: extractResponseFields(funcBody),
      statusCodes: [],
      rawSnippet: extractSnippet(content, lineNum, 2),
    });
  }

  return routes;
}

// ─── Env Refs ────────────────────────────────────────────────────────────────

function extractBackendEnvRefs(file: string, content: string, root: string): BackendEnvRef[] {
  const refs: BackendEnvRef[] = [];
  const regex = /process\.env\.(\w+)|process\.env\[['"](\w+)['"]\]/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    refs.push({
      file: relativePath(root, file),
      line: content.substring(0, match.index).split('\n').length,
      variable: match[1] || match[2],
    });
  }

  return refs;
}

// ─── Path Conversion ─────────────────────────────────────────────────────────

function filePathToApiPath(rel: string, router: 'app-router' | 'pages-router'): string {
  let apiPath: string;

  if (router === 'app-router') {
    // app/api/users/[id]/route.ts → /api/users/:param
    apiPath = rel
      .replace(/^(?:src\/)?app/, '')
      .replace(/\/route\.(ts|js|tsx|jsx)$/, '')
      .replace(/\[\.\.\.(\w+)\]/g, ':$1*')   // [...slug] → :slug*
      .replace(/\[(\w+)\]/g, ':param');        // [id] → :param
  } else {
    // pages/api/users/[id].ts → /api/users/:param
    apiPath = rel
      .replace(/^(?:src\/)?pages/, '')
      .replace(/\.(ts|js|tsx|jsx)$/, '')
      .replace(/\/index$/, '')
      .replace(/\[\.\.\.(\w+)\]/g, ':$1*')
      .replace(/\[(\w+)\]/g, ':param');
  }

  return apiPath || '/';
}

// ─── Detection Helpers ───────────────────────────────────────────────────────

function detectAuth(code: string): boolean {
  return (
    /\b(auth|session|token|jwt|getServerSession|getToken|currentUser|requireAuth|withAuth|protect|guard)\b/i.test(code) ||
    /headers\s*\.?\s*(?:get\s*\()?\s*['"]authorization['"]/i.test(code) ||
    /cookies?\s*\.\s*get\s*\(\s*['"](?:token|session|auth)/i.test(code)
  );
}

function detectValidation(code: string): boolean {
  return (
    /\b(z\.\w+|zod|yup|joi|validate|schema\.parse|safeParse|validator)\b/i.test(code) ||
    /\btypeof\s+\w+\s*(?:===?|!==?)\s*['"]/.test(code) ||
    /\bif\s*\(\s*!?\s*\w+\s*\)/.test(code)
  );
}

function detectErrorHandling(code: string): boolean {
  return (
    code.includes('try') ||
    code.includes('catch') ||
    code.includes('.catch(') ||
    code.includes('onError') ||
    /status\s*\(\s*(4|5)\d{2}\s*\)/.test(code) ||
    /NextResponse\.json\s*\([^)]*,\s*\{\s*status:\s*(4|5)\d{2}/.test(code)
  );
}

function extractResponseFields(code: string): string[] {
  const fields = new Set<string>();

  // JSON response: res.json({ user, posts }) or NextResponse.json({ user, posts })
  const jsonRegex = /(?:\.json|NextResponse\.json)\s*\(\s*\{([^}]{1,500})\}/g;
  let match: RegExpExecArray | null;

  while ((match = jsonRegex.exec(code)) !== null) {
    const inner = match[1];
    // Extract keys from object literal
    const keyRegex = /(\w+)\s*[,:]/g;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRegex.exec(inner)) !== null) {
      const key = keyMatch[1];
      if (!['status', 'message', 'error', 'success', 'ok', 'const', 'let', 'var', 'return', 'await'].includes(key)) {
        fields.add(key);
      }
    }
  }

  return [...fields];
}

function extractStatusCodes(code: string): number[] {
  const codes = new Set<number>();

  // .status(200), { status: 404 }, NextResponse.json(..., { status: 500 })
  const regex = /status\s*[:(]\s*(\d{3})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    codes.add(parseInt(match[1], 10));
  }

  return [...codes].sort();
}

// ─── Code Extraction ─────────────────────────────────────────────────────────

function extractFunctionBody(content: string, startIndex: number): string {
  const braceIndex = content.indexOf('{', startIndex);
  if (braceIndex === -1) return content.substring(startIndex, Math.min(content.length, startIndex + 500));
  return extractBracedBlock(content, braceIndex);
}

function extractBracedBlock(content: string, openBrace: number): string {
  let depth = 0;
  let i = openBrace;
  const maxLen = Math.min(content.length, openBrace + 5000); // Cap at 5000 chars

  while (i < maxLen) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.substring(openBrace, i + 1);
    }
    i++;
  }

  return content.substring(openBrace, maxLen);
}
