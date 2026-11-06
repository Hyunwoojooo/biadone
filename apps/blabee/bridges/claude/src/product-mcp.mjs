import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createNativeSessionClient } from './native-session-client.mjs';
import { ProductBridgeInputError, PRODUCT_WORKFLOW_INSTRUCTIONS, exactKeys, expectedSessionArgument,
  isUUID, productContext, safeProductErrorCode } from './product-context.mjs';
import { PRODUCT_TOOL_DEFINITIONS, createProductToolHandler, startProductPolling } from './product-tools.mjs';

/** One FIFO for tools and polling: the shared transport has at most one request. */
export function createProductRequestQueue(client) {
  let tail = Promise.resolve();
  let accepting = true;
  let count = 0;
  return {
    request(command) {
      if (!accepting) return Promise.reject(new ProductBridgeInputError('product_bridge_closed'));
      if (count >= 32) return Promise.reject(new ProductBridgeInputError('product_queue_full'));
      count++;
      const result = tail.then(() => {
        if (!accepting) throw new ProductBridgeInputError('product_bridge_closed');
        return client.request(command);
      });
      tail = result.then(() => { count--; }, () => { count--; });
      return result;
    },
    stop() { accepting = false; },
    async drain() { await tail; },
  };
}

export function createProductBridgeServer(options = {}) {
  const handler = createProductToolHandler(options);
  const server = new Server({ name: 'blabee-claude', version: '0.2.0' }, {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: PRODUCT_WORKFLOW_INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: PRODUCT_TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => handler(params.name,
    params.name === 'check_connection_v1' && params.arguments === undefined ? {} : params.arguments));
  return server;
}

export async function runProductMCP({ env = process.env, args = process.argv.slice(2),
  input = process.stdin, output = process.stdout, errorOutput = process.stderr,
  createClient = createNativeSessionClient, pollIntervalMs = 500 } = {}) {
  const context = await productContext('bridge', { env, expectedSessionID: expectedSessionArgument(args) });
  const client = await createClient(context.configuration);
  const queue = createProductRequestQueue(client);
  let bridgeID;
  let registeredID;
  let registration;
  let initialized = false;
  let closed = false;
  let closing;
  let stopPolling = async () => {};
  const server = createProductBridgeServer({ request: command => queue.request(command),
    getBridgeID: () => closed ? undefined : bridgeID });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: 128 * 1024 });

  const closeRegistration = async id => {
    let closer;
    try {
      // This is a new close command, never a replay of an unknown action or
      // registration. It can retire a known bridge after the main client failed.
      closer = await createClient(context.configuration);
      const result = await closer.request({ operation: 'bridge.close', bridge_id: id });
      exactKeys(result, ['closed'], 'invalid_bridge_response');
      if (result.closed !== true) throw new ProductBridgeInputError('invalid_bridge_response');
    } catch (error) {
      errorOutput.write(`[blabee-claude] 연결 종료를 확인하지 못했습니다 (${safeProductErrorCode(error)}).\n`);
    } finally { await closer?.close(); }
  };
  const cleanup = () => {
    if (closing) return closing;
    closed = true;
    bridgeID = undefined;
    queue.stop();
    const pollingStopped = stopPolling();
    input.off('end', cleanup);
    input.off('close', cleanup);
    input.off('error', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    closing = Promise.resolve().then(async () => {
      await server.close();
      await queue.drain();
      await registration;
      await pollingStopped;
      await client.close();
      if (registeredID) await closeRegistration(registeredID);
    });
    return closing;
  };
  server.onclose = () => { void cleanup(); };
  server.onerror = () => errorOutput.write('[blabee-claude] MCP 통신 오류입니다. 선택 실행은 확인되지 않았습니다.\n');
  server.oninitialized = () => {
    if (closed || initialized || !server.getClientVersion()) return;
    initialized = true;
    registration = (async () => {
      const result = await queue.request({ operation: 'bridge.open' });
      // Keep a valid known ID for best-effort cleanup even if extra fields make
      // the open response invalid. No tools/polling are enabled in that case.
      if (isUUID(result?.bridge_id)) registeredID = result.bridge_id;
      exactKeys(result, ['bridge_id'], 'invalid_bridge_response');
      if (!isUUID(result.bridge_id)) throw new ProductBridgeInputError('invalid_bridge_response');
      if (closed) return;
      bridgeID = result.bridge_id;
      stopPolling = startProductPolling({ request: command => queue.request(command), bridgeID,
        notify: message => server.notification(message), intervalMs: pollIntervalMs,
        onError: code => errorOutput.write(`[blabee-claude] Channel 연결을 확인하지 못했습니다 (${code}).\n`) });
    })().catch(error => {
      if (!closed) errorOutput.write(`[blabee-claude] 연결 등록을 확인하지 못했습니다 (${safeProductErrorCode(error)}).\n`);
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
  try { await runProductMCP(); }
  catch (error) { process.stderr.write(`[blabee-claude] MCP 시작 실패 (${safeProductErrorCode(error)}).\n`); process.exitCode = 1; }
}
