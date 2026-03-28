import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectProject } from '../analyzers/project-detector.js';

describe('detectProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemax-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it('detects Next.js App Router project', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { next: '14.0.0', react: '18.0.0' },
    }));
    writeFile('app/page.tsx', 'export default function Home() {}');
    writeFile('app/api/users/route.ts', 'export async function GET() {}');

    const project = detectProject(tmpDir);
    expect(project.frontendFramework).toBe('next-app-router');
    expect(project.backendFramework).toBe('next-api');
    expect(project.typescript).toBe(false); // No tsconfig.json
  });

  it('detects Express backend', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { express: '4.18.0', react: '18.0.0' },
    }));
    writeFile('src/server.ts', 'app.get("/api/test", handler)');

    const project = detectProject(tmpDir);
    expect(project.backendFramework).toBe('express');
    expect(project.frontendFramework).toBe('react');
  });

  it('detects monorepo via workspaces', () => {
    writeFile('package.json', JSON.stringify({
      workspaces: ['packages/*'],
    }));
    writeFile('packages/web/package.json', JSON.stringify({ name: 'web' }));
    writeFile('packages/api/package.json', JSON.stringify({ name: 'api' }));

    const project = detectProject(tmpDir);
    expect(project.isMonorepo).toBe(true);
  });

  it('detects monorepo via turbo.json', () => {
    writeFile('package.json', JSON.stringify({}));
    writeFile('turbo.json', JSON.stringify({ pipeline: {} }));
    writeFile('apps/web/package.json', JSON.stringify({ name: 'web' }));

    const project = detectProject(tmpDir);
    expect(project.isMonorepo).toBe(true);
  });

  it('detects Prisma ORM', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { '@prisma/client': '5.0.0', next: '14.0.0' },
    }));
    writeFile('prisma/schema.prisma', 'model User { id Int @id }');
    writeFile('app/page.tsx', '');

    const project = detectProject(tmpDir);
    expect(project.orm).toBe('prisma');
  });

  it('detects TypeScript', () => {
    writeFile('package.json', JSON.stringify({}));
    writeFile('tsconfig.json', JSON.stringify({ compilerOptions: {} }));

    const project = detectProject(tmpDir);
    expect(project.typescript).toBe(true);
  });

  it('detects package manager from lockfiles', () => {
    writeFile('package.json', JSON.stringify({}));
    writeFile('pnpm-lock.yaml', '');
    const project = detectProject(tmpDir);
    expect(project.packageManager).toBe('pnpm');
  });

  it('detects env files', () => {
    writeFile('package.json', JSON.stringify({}));
    writeFile('.env', 'KEY=value');
    writeFile('.env.local', 'KEY=value');
    writeFile('.env.example', 'KEY=');

    const project = detectProject(tmpDir);
    expect(project.envFiles.length).toBe(3);
  });

  it('detects frontend and backend paths in Next.js', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { next: '14.0.0' },
    }));
    writeFile('app/page.tsx', '');
    writeFile('app/api/users/route.ts', '');
    writeFile('components/Button.tsx', '');
    writeFile('lib/utils.ts', '');

    const project = detectProject(tmpDir);
    expect(project.frontendPaths.length).toBeGreaterThan(0);
    expect(project.backendPaths.length).toBeGreaterThan(0);
  });

  it('returns sensible defaults for empty project', () => {
    writeFile('package.json', JSON.stringify({}));

    const project = detectProject(tmpDir);
    expect(project.frontendFramework).toBe('unknown');
    expect(project.backendFramework).toBe('unknown');
    expect(project.orm).toBe('none');
    expect(project.isMonorepo).toBe(false);
    expect(project.packageManager).toBe('npm');
  });

  it('detects tRPC', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { '@trpc/server': '10.0.0', next: '14.0.0' },
    }));
    writeFile('app/page.tsx', '');

    const project = detectProject(tmpDir);
    expect(project.backendFramework).toBe('trpc');
  });

  it('detects Vue frontend', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { vue: '3.0.0' },
    }));

    const project = detectProject(tmpDir);
    expect(project.frontendFramework).toBe('vue');
  });

  it('detects Svelte frontend', () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { svelte: '4.0.0' },
    }));

    const project = detectProject(tmpDir);
    expect(project.frontendFramework).toBe('svelte');
  });
});
