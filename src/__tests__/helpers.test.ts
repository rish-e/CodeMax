import { describe, it, expect } from 'vitest';
import {
  normalizeApiPath,
  urlsMatch,
  calculateGrade,
  severityWeight,
  compareSeverity,
  pluralize,
  formatDuration,
  extractSnippet,
  generateId,
  resetIdCounter,
} from '../utils/helpers.js';

describe('normalizeApiPath', () => {
  it('strips protocol and host', () => {
    expect(normalizeApiPath('https://example.com/api/users')).toBe('/api/users');
  });

  it('converts template literals to :param', () => {
    expect(normalizeApiPath('/api/users/${userId}')).toBe('/api/users/:param');
  });

  it('converts Next.js dynamic segments to :param', () => {
    expect(normalizeApiPath('/api/users/[id]')).toBe('/api/users/:param');
  });

  it('converts Express params to :param', () => {
    expect(normalizeApiPath('/api/users/:id')).toBe('/api/users/:param');
  });

  it('removes trailing slash', () => {
    expect(normalizeApiPath('/api/users/')).toBe('/api/users');
  });

  it('removes query string', () => {
    expect(normalizeApiPath('/api/users?page=1&limit=10')).toBe('/api/users');
  });

  it('lowercases the path', () => {
    expect(normalizeApiPath('/API/Users')).toBe('/api/users');
  });

  it('handles root path', () => {
    expect(normalizeApiPath('/')).toBe('/');
  });
});

describe('urlsMatch', () => {
  it('matches identical paths', () => {
    expect(urlsMatch('/api/users', '/api/users')).toBe(true);
  });

  it('matches with different param formats', () => {
    expect(urlsMatch('/api/users/${id}', '/api/users/[id]')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(urlsMatch('/API/Users', '/api/users')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(urlsMatch('/api/users', '/api/posts')).toBe(false);
  });

  it('does not match different segment counts', () => {
    expect(urlsMatch('/api/users', '/api/users/profile')).toBe(false);
  });

  it('matches params against params', () => {
    expect(urlsMatch('/api/users/:id/posts', '/api/users/[userId]/posts')).toBe(true);
  });
});

describe('calculateGrade', () => {
  it('returns A for 90+', () => {
    expect(calculateGrade(95)).toBe('A');
    expect(calculateGrade(90)).toBe('A');
  });

  it('returns B for 75-89', () => {
    expect(calculateGrade(80)).toBe('B');
    expect(calculateGrade(75)).toBe('B');
  });

  it('returns C for 60-74', () => {
    expect(calculateGrade(65)).toBe('C');
    expect(calculateGrade(60)).toBe('C');
  });

  it('returns D for 40-59', () => {
    expect(calculateGrade(50)).toBe('D');
    expect(calculateGrade(40)).toBe('D');
  });

  it('returns F for below 40', () => {
    expect(calculateGrade(30)).toBe('F');
    expect(calculateGrade(0)).toBe('F');
  });
});

describe('severityWeight', () => {
  it('ranks critical highest', () => {
    expect(severityWeight('critical')).toBe(10);
  });

  it('ranks info lowest', () => {
    expect(severityWeight('info')).toBe(0);
  });
});

describe('compareSeverity', () => {
  it('sorts critical before low', () => {
    expect(compareSeverity('critical', 'low')).toBeLessThan(0);
  });

  it('sorts low after critical', () => {
    expect(compareSeverity('low', 'critical')).toBeGreaterThan(0);
  });
});

describe('pluralize', () => {
  it('uses singular for 1', () => {
    expect(pluralize(1, 'file')).toBe('1 file');
  });

  it('uses plural for 0', () => {
    expect(pluralize(0, 'file')).toBe('0 files');
  });

  it('uses plural for many', () => {
    expect(pluralize(5, 'file')).toBe('5 files');
  });

  it('uses custom plural', () => {
    expect(pluralize(3, 'entry', 'entries')).toBe('3 entries');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(2500)).toBe('2.5s');
  });
});

describe('extractSnippet', () => {
  const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7';

  it('extracts snippet around line', () => {
    const snippet = extractSnippet(content, 4, 1);
    expect(snippet).toContain('line3');
    expect(snippet).toContain('line4');
    expect(snippet).toContain('line5');
  });

  it('handles edge at beginning', () => {
    const snippet = extractSnippet(content, 1, 2);
    expect(snippet).toContain('line1');
  });
});

describe('generateId', () => {
  it('generates sequential IDs', () => {
    resetIdCounter();
    const id1 = generateId('contract-drift', 'cross-stack');
    const id2 = generateId('auth-gap', 'backend');
    expect(id1).toBe('XS-contract-drift-001');
    expect(id2).toBe('BE-auth-gap-002');
  });

  it('uses correct layer prefixes', () => {
    resetIdCounter();
    expect(generateId('phantom-call', 'frontend')).toMatch(/^FE-/);
    expect(generateId('phantom-call', 'backend')).toMatch(/^BE-/);
    expect(generateId('phantom-call', 'cross-stack')).toMatch(/^XS-/);
    expect(generateId('phantom-call', 'unknown')).toMatch(/^UN-/);
  });
});
