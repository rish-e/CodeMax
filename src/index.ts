#!/usr/bin/env node

// ─── CodeMax Entry Point ────────────────────────────────────────────────────
// Detects mode from arguments:
//   No args / --stdio  →  MCP server (stdio transport)
//   audit <path> ...   →  CLI mode (terminal output, CI/CD integration)

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== '--stdio') {
    // CLI mode
    const { runCli } = await import('./cli.js');
    await runCli(args);
  } else {
    // MCP server mode (default — stdio transport for MCP clients)
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const { createServer } = await import('./server.js');

    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  process.stderr.write(
    `CodeMax fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
