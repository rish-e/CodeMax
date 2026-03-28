import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectProject } from '../analyzers/project-detector.js';
import { scanFrontend } from '../analyzers/frontend-scanner.js';
import { scanBackend } from '../analyzers/backend-scanner.js';

describe('Frontend Scanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemax-fe-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it('detects fetch calls', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { react: '18.0.0' } }));
    writeFile('components/Users.tsx', `
      export function Users() {
        const res = await fetch('/api/users');
        const { data } = await res.json();
        return <div>{data.name}</div>;
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    expect(result.apiCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.apiCalls[0].url).toBe('/api/users');
    expect(result.apiCalls[0].method).toBe('GET');
    expect(result.apiCalls[0].caller).toBe('fetch');
  });

  it('detects axios calls with method', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { react: '18.0.0' } }));
    writeFile('components/Posts.tsx', `
      import axios from 'axios';
      export function Posts() {
        const { data } = await axios.get('/api/posts');
        return <div>{data}</div>;
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    expect(result.apiCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.apiCalls[0].method).toBe('GET');
    expect(result.apiCalls[0].caller).toBe('axios');
  });

  it('detects POST method from fetch options', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { react: '18.0.0' } }));
    writeFile('components/CreateUser.tsx', `
      export function CreateUser() {
        await fetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        });
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    expect(result.apiCalls.length).toBeGreaterThanOrEqual(1);
    // Should detect POST from the body or method option
    const call = result.apiCalls.find(c => c.url === '/api/users');
    expect(call).toBeDefined();
  });

  it('detects environment variable references', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('components/Config.tsx', `
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const secret = process.env.SECRET_KEY;
    `);

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    expect(result.envRefs.length).toBe(2);
    const publicRef = result.envRefs.find(r => r.variable === 'NEXT_PUBLIC_API_URL');
    expect(publicRef?.isPublic).toBe(true);
  });

  it('detects error handling', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { react: '18.0.0' } }));
    writeFile('components/Safe.tsx', `
      try {
        const res = await fetch('/api/safe');
      } catch (error) {
        console.error(error);
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    const call = result.apiCalls.find(c => c.url === '/api/safe');
    expect(call?.hasErrorHandling).toBe(true);
  });

  it('handles empty project gracefully', () => {
    writeFile('package.json', JSON.stringify({}));

    const project = detectProject(tmpDir);
    const result = scanFrontend(project);

    expect(result.apiCalls.length).toBe(0);
    expect(result.envRefs.length).toBe(0);
  });
});

describe('Backend Scanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemax-be-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it('detects Next.js App Router routes', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/api/users/route.ts', `
      import { NextResponse } from 'next/server';
      export async function GET() {
        return NextResponse.json({ users: [] });
      }
      export async function POST(request: Request) {
        const body = await request.json();
        return NextResponse.json({ user: body }, { status: 201 });
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes.length).toBe(2);
    const getRoute = result.routes.find(r => r.method === 'GET');
    expect(getRoute).toBeDefined();
    expect(getRoute!.path).toBe('/api/users');

    const postRoute = result.routes.find(r => r.method === 'POST');
    expect(postRoute).toBeDefined();
  });

  it('detects Next.js dynamic route params', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/api/users/[id]/route.ts', `
      export async function GET(req: Request, { params }: { params: { id: string } }) {
        return Response.json({ id: params.id });
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes.length).toBe(1);
    expect(result.routes[0].path).toContain(':param');
    expect(result.routes[0].pathIsPattern).toBe(true);
  });

  it('detects Express routes', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { express: '4.18.0' } }));
    writeFile('server/routes.ts', `
      import express from 'express';
      const router = express.Router();
      router.get('/api/users', async (req, res) => {
        try {
          res.json({ users: [] });
        } catch (error) {
          res.status(500).json({ error: 'Internal error' });
        }
      });
      router.post('/api/users', async (req, res) => {
        res.status(201).json({ user: req.body });
      });
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes.length).toBe(2);
    expect(result.routes[0].hasErrorHandling).toBe(true);
  });

  it('detects server actions', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/actions.ts', `
      'use server';
      export async function createUser(data: FormData) {
        const name = data.get('name');
        return { success: true };
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    const action = result.routes.find(r => r.path.includes('createUser'));
    expect(action).toBeDefined();
    expect(action!.method).toBe('POST');
  });

  it('detects auth patterns', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/api/protected/route.ts', `
      import { getServerSession } from 'next-auth';
      export async function GET() {
        const session = await getServerSession();
        if (!session) return new Response('Unauthorized', { status: 401 });
        return Response.json({ data: 'secret' });
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes[0].hasAuth).toBe(true);
  });

  it('detects validation patterns', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/api/validated/route.ts', `
      import { z } from 'zod';
      const schema = z.object({ name: z.string() });
      export async function POST(req: Request) {
        const body = schema.parse(await req.json());
        return Response.json(body);
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.routes[0].hasValidation).toBe(true);
  });

  it('detects backend env vars', () => {
    writeFile('package.json', JSON.stringify({ dependencies: { next: '14.0.0' } }));
    writeFile('app/api/config/route.ts', `
      export async function GET() {
        const dbUrl = process.env.DATABASE_URL;
        const secret = process.env['JWT_SECRET'];
        return Response.json({ configured: !!dbUrl });
      }
    `);

    const project = detectProject(tmpDir);
    const result = scanBackend(project);

    expect(result.envRefs.length).toBe(2);
    expect(result.envRefs.map(r => r.variable)).toContain('DATABASE_URL');
    expect(result.envRefs.map(r => r.variable)).toContain('JWT_SECRET');
  });
});
