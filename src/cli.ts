import * as path from 'node:path';
import * as fs from 'node:fs';
import { runFullStackAudit } from './bridge/orchestrator.js';
import { formatSarif } from './formatters/sarif.js';
import { VERSION } from './server.js';

// ─── CLI Mode ───────────────────────────────────────────────────────────────
// Usage:
//   codemax-mcp audit <path>                          Markdown output
//   codemax-mcp audit <path> --format json             JSON output
//   codemax-mcp audit <path> --format sarif            SARIF 2.1.0 output
//   codemax-mcp audit <path> --ci                      Exit code = health grade
//   codemax-mcp audit <path> --diff                    Only scan git-changed files
//   codemax-mcp audit <path> --diff --ci --format sarif Combined
//   codemax-mcp --version                              Print version
//   codemax-mcp --help                                 Print help

type OutputFormat = 'markdown' | 'json' | 'sarif';

interface CliOptions {
  command: string;
  projectPath: string;
  format: OutputFormat;
  ci: boolean;
  diff: boolean;
  threshold: number;
}

export async function runCli(args: string[]): Promise<void> {
  // Handle --version and --help before anything else
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`codemax-mcp v${VERSION}\n`);
    return;
  }

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    return;
  }

  const options = parseArgs(args);

  if (options.command !== 'audit') {
    process.stderr.write(`Unknown command: ${options.command}\n\n`);
    printHelp();
    process.exit(1);
  }

  // Resolve and validate project path
  const projectPath = path.resolve(options.projectPath);
  if (!fs.existsSync(projectPath)) {
    process.stderr.write(`Error: Path does not exist: ${projectPath}\n`);
    process.exit(1);
  }

  // Get changed files if --diff flag is set
  let changedFiles: string[] | undefined;
  if (options.diff) {
    changedFiles = await getGitChangedFiles(projectPath);
    if (changedFiles.length === 0) {
      process.stderr.write('No changed files detected (git diff). Nothing to scan.\n');
      if (options.ci) process.exit(0);
      return;
    }
    process.stderr.write(`Scanning ${changedFiles.length} changed file(s)...\n`);
  }

  // Run the audit
  const startTime = Date.now();
  process.stderr.write(`CodeMax v${VERSION} — scanning ${projectPath}\n`);

  try {
    const report = await runFullStackAudit(projectPath, { changedFiles });
    const elapsed = Date.now() - startTime;

    // Format and output
    switch (options.format) {
      case 'json':
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        break;

      case 'sarif':
        process.stdout.write(JSON.stringify(formatSarif(report), null, 2) + '\n');
        break;

      case 'markdown':
      default:
        process.stdout.write(report.summary + '\n');
        break;
    }

    // CI mode: exit code based on health score
    if (options.ci) {
      process.stderr.write(
        `\nHealth: ${report.health.grade} (${report.health.overall}/100) — ${report.issues.length} issues — ${elapsed}ms\n`,
      );

      if (report.health.overall < options.threshold) {
        process.stderr.write(
          `FAILED: Health score ${report.health.overall} is below threshold ${options.threshold}\n`,
        );
        process.exit(1);
      }

      process.stderr.write(`PASSED: Health score ${report.health.overall} meets threshold ${options.threshold}\n`);
      process.exit(0);
    }
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

// ─── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(args: string[]): CliOptions {
  let command = 'audit';
  let projectPath = '.';
  let format: OutputFormat = 'markdown';
  let ci = false;
  let diff = false;
  let threshold = 70; // Default: grade B- or above passes

  let i = 0;

  // First non-flag argument is the command
  if (args[i] && !args[i].startsWith('-')) {
    command = args[i];
    i++;
  }

  // Second non-flag argument is the project path
  if (args[i] && !args[i].startsWith('-')) {
    projectPath = args[i];
    i++;
  }

  // Parse flags
  for (; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--format':
      case '-f':
        i++;
        if (args[i] === 'json' || args[i] === 'sarif' || args[i] === 'markdown') {
          format = args[i] as OutputFormat;
        } else {
          process.stderr.write(`Invalid format: ${args[i]}. Use json, sarif, or markdown.\n`);
          process.exit(1);
        }
        break;

      case '--ci':
        ci = true;
        break;

      case '--diff':
        diff = true;
        break;

      case '--threshold':
      case '-t':
        i++;
        threshold = parseInt(args[i], 10);
        if (isNaN(threshold) || threshold < 0 || threshold > 100) {
          process.stderr.write(`Invalid threshold: ${args[i]}. Must be 0-100.\n`);
          process.exit(1);
        }
        break;

      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`Unknown flag: ${arg}\n`);
          process.exit(1);
        }
        break;
    }
  }

  return { command, projectPath, format, ci, diff, threshold };
}

// ─── Git Diff ───────────────────────────────────────────────────────────────

async function getGitChangedFiles(projectPath: string): Promise<string[]> {
  const { execSync } = await import('node:child_process');

  try {
    const files = new Set<string>();

    // Unstaged changes (working tree vs index)
    const unstaged = execSync('git diff --name-only HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();

    // Staged changes (index vs HEAD)
    const staged = execSync('git diff --name-only --cached', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();

    for (const output of [unstaged, staged]) {
      if (output) {
        for (const f of output.split('\n')) {
          if (f.trim()) files.add(f.trim());
        }
      }
    }

    return [...files];
  } catch {
    process.stderr.write('Warning: Could not read git diff. Scanning all files.\n');
    return [];
  }
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp(): void {
  process.stdout.write(`
CodeMax v${VERSION} — Full-stack cross-layer code analysis

USAGE
  codemax-mcp audit <path> [options]    Run a full-stack audit
  codemax-mcp --version                 Print version
  codemax-mcp --help                    Print this help

OPTIONS
  --format, -f <type>     Output format: markdown (default), json, sarif
  --ci                    CI mode — exit code 1 if health score below threshold
  --threshold, -t <n>     Health score threshold for --ci (default: 70, range: 0-100)
  --diff                  Only scan files changed in git (staged + unstaged + untracked)

EXAMPLES
  codemax-mcp audit .                           Audit current directory
  codemax-mcp audit /path/to/project            Audit a specific project
  codemax-mcp audit . --format json             JSON output (pipe to jq, etc.)
  codemax-mcp audit . --format sarif            SARIF for GitHub Code Scanning
  codemax-mcp audit . --ci --threshold 75       Fail CI if health < 75
  codemax-mcp audit . --diff                    Only scan changed files
  codemax-mcp audit . --diff --ci --format sarif  Combined for PR checks

CI/CD INTEGRATION
  # GitHub Actions
  - run: npx codemax-mcp audit . --ci --format sarif > results.sarif

  # Exit codes: 0 = passed, 1 = below threshold, 2 = runtime error

DOCS
  https://github.com/rish-e/codemax
`);
}
