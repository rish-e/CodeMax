import { describe, it, expect } from 'vitest';
import { analyzeContracts } from '../bridge/contract-analyzer.js';
import { FrontendApiCall, BackendRoute } from '../types.js';

function mockCall(overrides: Partial<FrontendApiCall> = {}): FrontendApiCall {
  return {
    file: 'components/Users.tsx',
    line: 10,
    column: 5,
    method: 'GET',
    url: '/api/users',
    urlIsTemplate: false,
    caller: 'fetch',
    expectedFields: [],
    hasErrorHandling: true,
    hasLoadingState: true,
    hasAuthHeader: false,
    rawSnippet: "fetch('/api/users')",
    ...overrides,
  };
}

function mockRoute(overrides: Partial<BackendRoute> = {}): BackendRoute {
  return {
    file: 'app/api/users/route.ts',
    line: 5,
    method: 'GET',
    path: '/api/users',
    pathIsPattern: false,
    hasAuth: false,
    hasValidation: false,
    hasErrorHandling: true,
    responseFields: [],
    statusCodes: [200],
    rawSnippet: 'export async function GET()',
    ...overrides,
  };
}

describe('analyzeContracts', () => {
  it('matches frontend call to backend route', () => {
    const calls = [mockCall()];
    const routes = [mockRoute()];
    const report = analyzeContracts(calls, routes);

    expect(report.matched.length).toBe(1);
    expect(report.phantomCalls.length).toBe(0);
    expect(report.deadEndpoints.length).toBe(0);
  });

  it('detects phantom calls', () => {
    const calls = [mockCall({ url: '/api/posts' })];
    const routes = [mockRoute({ path: '/api/users' })];
    const report = analyzeContracts(calls, routes);

    expect(report.phantomCalls.length).toBe(1);
    expect(report.phantomCalls[0].url).toBe('/api/posts');
  });

  it('detects dead endpoints', () => {
    const calls = [mockCall({ url: '/api/users' })];
    const routes = [
      mockRoute({ path: '/api/users' }),
      mockRoute({ path: '/api/admin', file: 'app/api/admin/route.ts' }),
    ];
    const report = analyzeContracts(calls, routes);

    expect(report.deadEndpoints.length).toBe(1);
    expect(report.deadEndpoints[0].path).toBe('/api/admin');
  });

  it('detects method mismatch', () => {
    const calls = [mockCall({ method: 'POST' })];
    const routes = [mockRoute({ method: 'GET' })];
    const report = analyzeContracts(calls, routes);

    expect(report.matched[0].mismatches.length).toBeGreaterThan(0);
    expect(report.matched[0].mismatches[0].type).toBe('method');
    expect(report.matched[0].mismatches[0].severity).toBe('critical');
  });

  it('detects auth mismatch — frontend sends, backend ignores', () => {
    const calls = [mockCall({ hasAuthHeader: true })];
    const routes = [mockRoute({ hasAuth: false })];
    const report = analyzeContracts(calls, routes);

    const authMismatch = report.matched[0].mismatches.find((m) => m.type === 'auth');
    expect(authMismatch).toBeDefined();
    expect(authMismatch!.severity).toBe('medium');
  });

  it('detects auth mismatch — backend requires, frontend missing', () => {
    const calls = [mockCall({ hasAuthHeader: false })];
    const routes = [mockRoute({ hasAuth: true })];
    const report = analyzeContracts(calls, routes);

    const authMismatch = report.matched[0].mismatches.find((m) => m.type === 'auth');
    expect(authMismatch).toBeDefined();
    expect(authMismatch!.severity).toBe('high');
  });

  it('detects missing validation on POST', () => {
    const calls = [mockCall({ method: 'POST' })];
    const routes = [mockRoute({ method: 'POST', hasValidation: false })];
    const report = analyzeContracts(calls, routes);

    const valMismatch = report.matched[0].mismatches.find((m) => m.type === 'validation');
    expect(valMismatch).toBeDefined();
  });

  it('detects field mismatch', () => {
    const calls = [mockCall({ expectedFields: ['name', 'email', 'avatar'] })];
    const routes = [mockRoute({ responseFields: ['name', 'email'] })];
    const report = analyzeContracts(calls, routes);

    const fieldMismatch = report.matched[0].mismatches.find((m) => m.type === 'fields');
    expect(fieldMismatch).toBeDefined();
    expect(fieldMismatch!.message).toContain('avatar');
  });

  it('matches URLs with different param formats', () => {
    const calls = [mockCall({ url: '/api/users/${userId}/posts' })];
    const routes = [mockRoute({ path: '/api/users/[id]/posts' })];
    const report = analyzeContracts(calls, routes);

    expect(report.matched.length).toBe(1);
    expect(report.phantomCalls.length).toBe(0);
  });

  it('ignores external URLs', () => {
    const calls = [mockCall({ url: 'https://api.stripe.com/v1/charges' })];
    const routes = [mockRoute()];
    const report = analyzeContracts(calls, routes);

    expect(report.phantomCalls.length).toBe(0);
    expect(report.deadEndpoints.length).toBe(1); // Backend route is dead since external call doesn't match
  });

  it('matches server actions by name', () => {
    const calls = [mockCall({ url: 'server-action:createUser', caller: 'server-action', method: 'POST' })];
    const routes = [mockRoute({ path: 'server-action:createUser', method: 'POST' })];
    const report = analyzeContracts(calls, routes);

    expect(report.matched.length).toBe(1);
  });

  it('calculates score correctly', () => {
    const calls = [mockCall()];
    const routes = [mockRoute()];
    const report = analyzeContracts(calls, routes);

    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('penalizes score for phantom calls', () => {
    const calls = [mockCall({ url: '/api/missing' })];
    const routes: BackendRoute[] = [];
    const report = analyzeContracts(calls, routes);

    expect(report.score).toBeLessThan(100);
  });

  it('handles empty inputs gracefully', () => {
    const report = analyzeContracts([], []);
    expect(report.matched.length).toBe(0);
    expect(report.phantomCalls.length).toBe(0);
    expect(report.deadEndpoints.length).toBe(0);
    expect(report.score).toBe(100);
  });

  it('detects missing error handling on frontend', () => {
    const calls = [mockCall({ hasErrorHandling: false })];
    const routes = [mockRoute({ statusCodes: [200, 400, 500] })];
    const report = analyzeContracts(calls, routes);

    const errMismatch = report.matched[0].mismatches.find((m) => m.type === 'validation');
    expect(errMismatch).toBeDefined();
  });
});
