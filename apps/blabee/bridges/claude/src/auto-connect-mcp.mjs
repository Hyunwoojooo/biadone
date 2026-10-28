import { pathToFileURL } from 'node:url';
import { AutoConnectError, createAutoConnectClient, safeAutoConnectErrorCode } from './auto-connect-client.mjs';
import { sessionV2Context } from './session-v2-context.mjs';
import { runSessionV2MCP } from './session-v2-mcp.mjs';

/** Start the SDK immediately, then wait for the same launch's actual native
 * SessionStart. Pending grants are read-only and never create a session. */
export async function runAutoConnectMCP({ env = process.env, args = process.argv.slice(2),
  createBootstrapClient = createAutoConnectClient, ...options } = {}) {
  if (args.length) throw new AutoConnectError('auto_connect_invalid_configuration');
  return runSessionV2MCP({ ...options, env, args, contextErrorCode: safeAutoConnectErrorCode,
    resolveContext: async ({ signal }) => {
      const bootstrap = await createBootstrapClient({ role: 'bridge', env, signal });
      try {
        const grant = await bootstrap.waitForGrant();
        return await sessionV2Context('bridge', { env: grant.environment, expectedSessionID: env.CLAUDE_CODE_SESSION_ID });
      } finally { await bootstrap.close(); }
    } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exit(await (await runAutoConnectMCP()).closed); }
  catch (error) {
    process.stderr.write(`[blabee-claude] 자동 연결 MCP 시작 실패 (${safeAutoConnectErrorCode(error)}).\n`);
    process.exitCode = 1;
  }
}
