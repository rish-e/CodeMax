import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  ProjectStructure,
  FrontendFramework,
  BackendFramework,
  ORM,
} from '../types.js';

// ─── Project Structure Detection ─────────────────────────────────────────────

export function detectProject(root: string): ProjectStructure {
  const pkg = readPackageJson(root);
  const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  const isMonorepo = detectMonorepo(root);
  const frontendFramework = detectFrontendFramework(root, allDeps);
  const backendFramework = detectBackendFramework(root, allDeps);
  const orm = detectORM(root, allDeps);
  const packageManager = detectPackageManager(root);
  const typescript = detectTypeScript(root, allDeps);

  const { frontendPaths, backendPaths, sharedPaths } = detectLayerPaths(
    root,
    frontendFramework,
    backendFramework,
    isMonorepo,
  );

  const envFiles = detectEnvFiles(root);

  return {
    root,
    isMonorepo,
    frontendPaths,
    backendPaths,
    sharedPaths,
    frontendFramework,
    backendFramework,
    orm,
    packageManager,
    typescript,
    envFiles,
  };
}

// ─── Package.json Reader ─────────────────────────────────────────────────────

function readPackageJson(dir: string): Record<string, any> | null {
  try {
    const content = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── Monorepo Detection ──────────────────────────────────────────────────────

function detectMonorepo(root: string): boolean {
  // Check for workspace configs
  const indicators = [
    'pnpm-workspace.yaml',
    'lerna.json',
    'nx.json',
    'turbo.json',
  ];

  for (const file of indicators) {
    if (fs.existsSync(path.join(root, file))) return true;
  }

  // Check package.json workspaces
  const pkg = readPackageJson(root);
  if (pkg?.workspaces) return true;

  // Check for typical monorepo dirs with their own package.json
  const monorepoPatterns = ['packages', 'apps', 'services'];
  for (const dir of monorepoPatterns) {
    const fullPath = path.join(root, dir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const subDirs = fs.readdirSync(fullPath, { withFileTypes: true });
      const hasSubPackages = subDirs.some(
        (d) => d.isDirectory() && fs.existsSync(path.join(fullPath, d.name, 'package.json')),
      );
      if (hasSubPackages) return true;
    }
  }

  return false;
}

// ─── Frontend Framework Detection ────────────────────────────────────────────

function detectFrontendFramework(root: string, deps: Record<string, string>): FrontendFramework {
  // Next.js — check for app/ vs pages/ router
  if (deps['next']) {
    if (fs.existsSync(path.join(root, 'app')) || fs.existsSync(path.join(root, 'src', 'app'))) {
      return 'next-app-router';
    }
    if (fs.existsSync(path.join(root, 'pages')) || fs.existsSync(path.join(root, 'src', 'pages'))) {
      return 'next-pages-router';
    }
    return 'next-app-router'; // Default for Next.js 13+
  }

  if (deps['vue'] || deps['nuxt']) return 'vue';
  if (deps['svelte'] || deps['@sveltejs/kit']) return 'svelte';
  if (deps['@angular/core']) return 'angular';
  if (deps['react'] || deps['react-dom']) return 'react';

  return 'unknown';
}

// ─── Backend Framework Detection ─────────────────────────────────────────────

function detectBackendFramework(root: string, deps: Record<string, string>): BackendFramework {
  // Check for Next.js server actions
  if (deps['next']) {
    const hasServerActions = checkForServerActions(root);
    if (hasServerActions) return 'next-server-actions';
    // Check for API routes
    if (
      fs.existsSync(path.join(root, 'app', 'api')) ||
      fs.existsSync(path.join(root, 'src', 'app', 'api')) ||
      fs.existsSync(path.join(root, 'pages', 'api')) ||
      fs.existsSync(path.join(root, 'src', 'pages', 'api'))
    ) {
      return 'next-api';
    }
  }

  if (deps['@trpc/server']) return 'trpc';

  if (
    deps['graphql'] ||
    deps['apollo-server'] ||
    deps['@apollo/server'] ||
    deps['graphql-yoga']
  ) {
    return 'graphql';
  }

  if (deps['express']) return 'express';
  if (deps['fastify']) return 'fastify';

  return 'unknown';
}

function checkForServerActions(root: string): boolean {
  const searchDirs = [
    path.join(root, 'app'),
    path.join(root, 'src', 'app'),
    path.join(root, 'src', 'actions'),
    path.join(root, 'actions'),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir, { recursive: true });
      for (const file of files) {
        const filePath = path.join(dir, file.toString());
        if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) continue;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.includes("'use server'") || content.includes('"use server"')) {
            return true;
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}

// ─── ORM Detection ───────────────────────────────────────────────────────────

function detectORM(root: string, deps: Record<string, string>): ORM {
  if (deps['prisma'] || deps['@prisma/client']) return 'prisma';
  if (deps['drizzle-orm']) return 'drizzle';
  if (deps['typeorm']) return 'typeorm';
  if (deps['sequelize']) return 'sequelize';

  // Check for schema files
  if (
    fs.existsSync(path.join(root, 'prisma', 'schema.prisma')) ||
    fs.existsSync(path.join(root, 'schema.prisma'))
  ) {
    return 'prisma';
  }

  return 'none';
}

// ─── Package Manager Detection ───────────────────────────────────────────────

function detectPackageManager(root: string): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// ─── TypeScript Detection ────────────────────────────────────────────────────

function detectTypeScript(root: string, deps: Record<string, string>): boolean {
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) return true;
  if (deps['typescript']) return true;
  return false;
}

// ─── Layer Path Detection ────────────────────────────────────────────────────

function detectLayerPaths(
  root: string,
  feFramework: FrontendFramework,
  beFramework: BackendFramework,
  isMonorepo: boolean,
): { frontendPaths: string[]; backendPaths: string[]; sharedPaths: string[] } {
  const frontendPaths: string[] = [];
  const backendPaths: string[] = [];
  const sharedPaths: string[] = [];

  if (isMonorepo) {
    // Scan workspace packages
    const workspaceDirs = ['packages', 'apps', 'services'];
    for (const dir of workspaceDirs) {
      const fullPath = path.join(root, dir);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const pkgPath = path.join(fullPath, entry.name);
          const name = entry.name.toLowerCase();
          if (name.includes('web') || name.includes('frontend') || name.includes('client') || name.includes('ui')) {
            frontendPaths.push(pkgPath);
          } else if (name.includes('api') || name.includes('backend') || name.includes('server') || name.includes('service')) {
            backendPaths.push(pkgPath);
          } else if (name.includes('shared') || name.includes('common') || name.includes('types') || name.includes('lib')) {
            sharedPaths.push(pkgPath);
          }
        }
      } catch {
        continue;
      }
    }
  }

  // Single-project structure (Next.js, etc.)
  if (frontendPaths.length === 0 && backendPaths.length === 0) {
    // Typical frontend directories
    const feDirs = ['components', 'pages', 'app', 'src/components', 'src/pages', 'src/app', 'src/views', 'views'];
    for (const dir of feDirs) {
      const fullPath = path.join(root, dir);
      if (fs.existsSync(fullPath)) frontendPaths.push(fullPath);
    }

    // Typical backend directories
    const beDirs = ['api', 'server', 'src/api', 'src/server', 'app/api', 'src/app/api', 'pages/api', 'src/pages/api', 'routes', 'src/routes'];
    for (const dir of beDirs) {
      const fullPath = path.join(root, dir);
      if (fs.existsSync(fullPath)) backendPaths.push(fullPath);
    }

    // Shared
    const sharedDirs = ['lib', 'src/lib', 'utils', 'src/utils', 'types', 'src/types', 'shared', 'src/shared'];
    for (const dir of sharedDirs) {
      const fullPath = path.join(root, dir);
      if (fs.existsSync(fullPath)) sharedPaths.push(fullPath);
    }
  }

  return { frontendPaths, backendPaths, sharedPaths };
}

// ─── Env File Detection ──────────────────────────────────────────────────────

function detectEnvFiles(root: string): string[] {
  const envPatterns = ['.env', '.env.local', '.env.development', '.env.production', '.env.example', '.env.test'];
  return envPatterns
    .map((p) => path.join(root, p))
    .filter((p) => fs.existsSync(p));
}
