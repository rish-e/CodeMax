import * as path from 'node:path';
import { Project, SyntaxKind, Node, CallExpression, SourceFile } from 'ts-morph';
import { FrontendApiCall, FrontendEnvRef, HttpMethod, ProjectStructure } from '../types.js';
import { collectFiles, readFileSafe, relativePath, extractSnippet } from '../utils/helpers.js';

// ─── Frontend Scanner ────────────────────────────────────────────────────────
// Scans frontend code for API calls, environment variable references, and
// data consumption patterns.

export interface FrontendScanResult {
  apiCalls: FrontendApiCall[];
  envRefs: FrontendEnvRef[];
  totalFiles: number;
  scannedFiles: number;
}

export function scanFrontend(project: ProjectStructure, fileFilter?: Set<string>): FrontendScanResult {
  const apiCalls: FrontendApiCall[] = [];
  const envRefs: FrontendEnvRef[] = [];

  const searchPaths = project.frontendPaths.length > 0
    ? project.frontendPaths
    : [project.root];

  const allFiles: string[] = [];
  for (const searchPath of searchPaths) {
    allFiles.push(...collectFiles(searchPath, undefined, undefined, undefined, fileFilter));
  }

  // Deduplicate
  const uniqueFiles = [...new Set(allFiles)];

  // Quick regex scan first, then AST for matches
  let scannedFiles = 0;
  for (const file of uniqueFiles) {
    const content = readFileSafe(file);
    if (!content) continue;
    scannedFiles++;

    // Skip obvious backend files
    const rel = relativePath(project.root, file);
    if (isBackendFile(rel, content)) continue;

    // Regex pre-filter for API calls
    if (hasApiCallSignals(content)) {
      const calls = extractApiCalls(file, content, project.root);
      apiCalls.push(...calls);
    }

    // Environment variable references
    const refs = extractEnvRefs(file, content, project.root);
    envRefs.push(...refs);
  }

  return {
    apiCalls,
    envRefs,
    totalFiles: uniqueFiles.length,
    scannedFiles,
  };
}

// ─── API Call Detection ──────────────────────────────────────────────────────

const API_CALL_PATTERNS = [
  /\bfetch\s*\(/,
  /\baxios\s*\.\s*(get|post|put|patch|delete|head|options|request)\s*\(/,
  /\baxios\s*\(/,
  /\buseSWR\s*\(/,
  /\buseQuery\s*\(/,
  /\buseMutation\s*\(/,
  /\b\$fetch\s*\(/,
  /\bky\s*\.\s*(get|post|put|patch|delete)\s*\(/,
  /\bofetch\s*\(/,
];

function hasApiCallSignals(content: string): boolean {
  return API_CALL_PATTERNS.some((p) => p.test(content));
}

function isBackendFile(relativePath: string, content: string): boolean {
  // File path signals
  if (relativePath.match(/\b(api|server|middleware|route)\b.*\.(ts|js)$/)) {
    // But not if it's a client-side route file
    if (!relativePath.includes('component') && !relativePath.includes('hook')) {
      if (content.includes("'use server'") || content.includes('"use server"')) return true;
      if (content.includes('export async function GET') || content.includes('export async function POST')) return true;
      if (content.includes('NextRequest') || content.includes('NextResponse')) return true;
    }
  }
  return false;
}

function extractApiCalls(file: string, content: string, root: string): FrontendApiCall[] {
  const calls: FrontendApiCall[] = [];
  const lines = content.split('\n');

  // Pattern-based extraction (faster than AST for most cases)

  // fetch() calls
  const fetchRegex = /\bfetch\s*\(\s*(['"`])(.*?)\1|fetch\s*\(\s*(`[^`]*`)/g;
  let match: RegExpExecArray | null;

  while ((match = fetchRegex.exec(content)) !== null) {
    const url = match[2] || match[3]?.slice(1, -1) || '';
    const lineNum = content.substring(0, match.index).split('\n').length;
    const surrounding = getSurroundingContext(lines, lineNum - 1, 5);
    const method = detectHttpMethod(surrounding, 'fetch');

    calls.push({
      file: relativePath(root, file),
      line: lineNum,
      column: match.index - content.lastIndexOf('\n', match.index),
      method,
      url: cleanUrl(url),
      urlIsTemplate: url.includes('${') || url.includes('`'),
      caller: 'fetch',
      expectedFields: extractExpectedFields(lines, lineNum - 1),
      hasErrorHandling: hasErrorHandling(surrounding),
      hasLoadingState: hasLoadingState(content),
      hasAuthHeader: hasAuthHeader(surrounding),
      rawSnippet: extractSnippet(content, lineNum, 1),
    });
  }

  // axios calls
  const axiosRegex = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])(.*?)\2/gi;
  while ((match = axiosRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase() as HttpMethod;
    const url = match[3];
    const lineNum = content.substring(0, match.index).split('\n').length;
    const surrounding = getSurroundingContext(lines, lineNum - 1, 5);

    calls.push({
      file: relativePath(root, file),
      line: lineNum,
      column: match.index - content.lastIndexOf('\n', match.index),
      method,
      url: cleanUrl(url),
      urlIsTemplate: url.includes('${'),
      caller: 'axios',
      expectedFields: extractExpectedFields(lines, lineNum - 1),
      hasErrorHandling: hasErrorHandling(surrounding),
      hasLoadingState: hasLoadingState(content),
      hasAuthHeader: hasAuthHeader(surrounding),
      rawSnippet: extractSnippet(content, lineNum, 1),
    });
  }

  // SWR / React Query
  const hooksRegex = /\b(useSWR|useQuery)\s*\(\s*(['"`[\]])(.*?)(?:\2|\])/g;
  while ((match = hooksRegex.exec(content)) !== null) {
    const hook = match[1];
    const url = match[3];
    const lineNum = content.substring(0, match.index).split('\n').length;
    const surrounding = getSurroundingContext(lines, lineNum - 1, 5);

    calls.push({
      file: relativePath(root, file),
      line: lineNum,
      column: match.index - content.lastIndexOf('\n', match.index),
      method: 'GET',
      url: cleanUrl(url),
      urlIsTemplate: url.includes('${'),
      caller: hook === 'useSWR' ? 'swr' : 'react-query',
      expectedFields: extractExpectedFields(lines, lineNum - 1),
      hasErrorHandling: surrounding.includes('onError') || surrounding.includes('error'),
      hasLoadingState: surrounding.includes('isLoading') || surrounding.includes('loading'),
      hasAuthHeader: hasAuthHeader(surrounding),
      rawSnippet: extractSnippet(content, lineNum, 1),
    });
  }

  // Server Actions (Next.js)
  const serverActionImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"].*actions.*['"]/g;
  while ((match = serverActionImportRegex.exec(content)) !== null) {
    const actions = match[1].split(',').map((a) => a.trim());
    const lineNum = content.substring(0, match.index).split('\n').length;

    for (const action of actions) {
      if (!action) continue;
      // Find where this action is called in the file
      const callRegex = new RegExp(`\\b${action}\\s*\\(`, 'g');
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(content)) !== null) {
        const callLine = content.substring(0, callMatch.index).split('\n').length;
        if (callLine === lineNum) continue; // Skip the import line itself

        calls.push({
          file: relativePath(root, file),
          line: callLine,
          column: callMatch.index - content.lastIndexOf('\n', callMatch.index),
          method: 'POST',
          url: `server-action:${action}`,
          urlIsTemplate: false,
          caller: 'server-action',
          expectedFields: extractExpectedFields(lines, callLine - 1),
          hasErrorHandling: hasErrorHandling(getSurroundingContext(lines, callLine - 1, 5)),
          hasLoadingState: hasLoadingState(content),
          hasAuthHeader: true, // Server actions handle auth via cookies
          rawSnippet: extractSnippet(content, callLine, 1),
        });
      }
    }
  }

  return calls;
}

// ─── Environment Variable Scanner ────────────────────────────────────────────

function extractEnvRefs(file: string, content: string, root: string): FrontendEnvRef[] {
  const refs: FrontendEnvRef[] = [];
  const regex = /process\.env\.(\w+)|import\.meta\.env\.(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const variable = match[1] || match[2];
    const line = content.substring(0, match.index).split('\n').length;
    refs.push({
      file: relativePath(root, file),
      line,
      variable,
      isPublic: variable.startsWith('NEXT_PUBLIC_') || variable.startsWith('VITE_') || variable.startsWith('NUXT_PUBLIC_'),
    });
  }

  return refs;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function cleanUrl(url: string): string {
  return url.replace(/^['"`]|['"`]$/g, '').trim();
}

function getSurroundingContext(lines: string[], lineIndex: number, range: number): string {
  const start = Math.max(0, lineIndex - range);
  const end = Math.min(lines.length, lineIndex + range + 1);
  return lines.slice(start, end).join('\n');
}

function detectHttpMethod(context: string, caller: string): HttpMethod {
  if (caller === 'fetch') {
    const methodMatch = context.match(/method\s*:\s*['"](\w+)['"]/i);
    if (methodMatch) return methodMatch[1].toUpperCase() as HttpMethod;
    // If no method specified, default to GET
    if (context.match(/body\s*:/)) return 'POST';
    return 'GET';
  }
  return 'GET';
}

function extractExpectedFields(lines: string[], callLineIndex: number): string[] {
  const fields: string[] = [];
  // Look at lines after the call for destructuring patterns
  const searchRange = Math.min(lines.length, callLineIndex + 10);
  const searchText = lines.slice(callLineIndex, searchRange).join('\n');

  // Destructuring: const { name, email } = ...
  const destructMatch = searchText.match(/\{\s*([^}]+)\}\s*=\s*/);
  if (destructMatch) {
    const fieldList = destructMatch[1].split(',').map((f) => f.trim().split(':')[0].trim());
    fields.push(...fieldList.filter(Boolean));
  }

  // Property access: data.user.name
  const propRegex = /(?:data|result|response|json|body)\.(\w+(?:\.\w+)*)/g;
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propRegex.exec(searchText)) !== null) {
    fields.push(propMatch[1]);
  }

  return [...new Set(fields)];
}

function hasErrorHandling(context: string): boolean {
  return (
    context.includes('.catch') ||
    context.includes('try') ||
    context.includes('onError') ||
    context.includes('isError') ||
    context.includes('error:') ||
    context.includes('toast.error') ||
    context.includes('console.error')
  );
}

function hasLoadingState(fileContent: string): boolean {
  return (
    fileContent.includes('isLoading') ||
    fileContent.includes('loading') ||
    fileContent.includes('isPending') ||
    fileContent.includes('Suspense') ||
    fileContent.includes('skeleton') ||
    fileContent.includes('Skeleton') ||
    fileContent.includes('spinner') ||
    fileContent.includes('Spinner')
  );
}

function hasAuthHeader(context: string): boolean {
  return (
    context.includes('Authorization') ||
    context.includes('authorization') ||
    context.includes('Bearer') ||
    context.includes('token') ||
    context.includes('x-api-key') ||
    context.includes('credentials:') ||
    context.includes('withCredentials')
  );
}
