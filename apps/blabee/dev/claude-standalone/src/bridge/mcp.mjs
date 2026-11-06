import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MAX_MESSAGE_BYTES } from '../shared/identity.mjs';
import { request } from '../shared/client.mjs';
import { BridgeInputError, WORKFLOW_INSTRUCTIONS, expectedSessionArgument, isUUID, safeErrorCode, sessionBinding } from './context.mjs';
import { TOOL_DEFINITIONS, createToolHandler, startSelectionPolling } from './tools.mjs';

export function createBridgeServer(options = {}) {
  const callTool = createToolHandler(options);
  const server = new Server({ name: 'blabee-claude', version: '0.1.0' }, {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: WORKFLOW_INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => callTool(params.name, params.name === 'check_connection' && params.arguments === undefined ? {} : params.arguments));
  return server;
}

export async function runMCP({ env = process.env, args = process.argv.slice(2), input = process.stdin, output = process.stdout, errorOutput = process.stderr, ipc = request } = {}) {
  const options = { env, expectedSessionID: expectedSessionArgument(args), ipc };
  const binding = sessionBinding(env, options.expectedSessionID);
  let bridgeID;
  let registration;
  let initialized = false;
  let closed = false;
  let closing;
  const server = createBridgeServer({ ...options, getBridgeID: () => closed ? undefined : bridgeID });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: MAX_MESSAGE_BYTES });
  let stopPolling = () => {};
  const closeRegistration = async id => {
    try { await ipc('bridge.close', { session_id: binding.session_id, bridge_id: id }, { auth: binding.auth, runtime: binding.runtime }); }
    catch (error) { errorOutput.write(`[blabee-claude] 연결 종료를 확인하지 못했습니다 (${safeErrorCode(error)}).\n`); }
  };
  const cleanup = () => {
    if (closing) return closing;
    closed = true;
    stopPolling();
    input.off('end', cleanup);
    input.off('close', cleanup);
    input.off('error', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    const id = bridgeID;
    bridgeID = undefined;
    // Defer until `closing` is assigned: Server.close invokes onclose again.
    closing = Promise.resolve().then(async () => {
      await server.close();
      if (id) await closeRegistration(id);
      // A pending open must close its own late registration before cleanup ends.
      await registration;
    });
    return closing;
  };
  server.onclose = () => { void cleanup(); };
  server.onerror = () => errorOutput.write('[blabee-claude] MCP 통신 오류입니다. 선택 실행은 확인되지 않았습니다.\n');
  server.oninitialized = () => {
    if (closed || initialized || !server.getClientVersion()) return;
    initialized = true;
    registration = (async () => {
      const result = await ipc('bridge.open', { session_id: binding.session_id }, { auth: binding.auth, runtime: binding.runtime });
      if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !isUUID(result.bridge_id)) {
        if (isUUID(result?.bridge_id)) await closeRegistration(result.bridge_id);
        throw new BridgeInputError('invalid_bridge_response');
      }
      if (closed) { await closeRegistration(result.bridge_id); return; }
      bridgeID = result.bridge_id;
      stopPolling = startSelectionPolling({ ...options, bridgeID, notify: message => server.notification(message), onError: code => errorOutput.write(`[blabee-claude] 선택 연결을 확인하지 못했습니다 (${code}).\n`) });
    })().catch(error => {
      if (!closed) errorOutput.write(`[blabee-claude] 연결 등록을 확인하지 못했습니다 (${safeErrorCode(error)}).\n`);
    });
  };
  input.once('end', cleanup);
  input.once('close', cleanup);
  input.once('error', cleanup);
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  try { await server.connect(transport); }
  catch (error) { await cleanup(); throw error; }
  return { server, close: cleanup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runMCP(); }
  catch (error) { process.stderr.write(`[blabee-claude] MCP 시작 실패 (${safeErrorCode(error)}).\n`); process.exitCode = 1; }
}
