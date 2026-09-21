import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { expectedSessionArgument } from './product-context.mjs';
import { createSessionV2Client, SessionV2ClientError, validateSessionV2Result } from './session-v2-client.mjs';
import { createSessionV2ChannelPoller } from './session-v2-channel-poller.mjs';
import { SESSION_V2_WORKFLOW_INSTRUCTIONS, safeSessionV2ErrorCode, sessionV2Context } from './session-v2-context.mjs';
import { SESSION_V2_TOOL_DEFINITIONS, createSessionV2ToolHandler, sessionV2ChannelNotification, sessionV2ToolError } from './session-v2-tools.mjs';

/** One bounded FIFO serializes polling and tools on the authenticated client. */
export function createSessionV2RequestQueue(client) {
  let tail = Promise.resolve();
  let accepting = true;
  let count = 0;
  const enqueue = (method, value) => {
    if (!accepting) return Promise.reject(new SessionV2ClientError('session_v2_bridge_closed'));
    if (count >= 32) return Promise.reject(new SessionV2ClientError('session_v2_queue_full'));
    count++;
    const result = tail.then(() => {
      if (!accepting) throw new SessionV2ClientError('session_v2_bridge_closed');
      return client[method](value);
    });
    tail = result.then(() => { count--; }, () => { count--; });
    return result;
  };
  return { request: value => enqueue('request', value), exchange: value => enqueue('exchange', value),
    stop() { accepting = false; }, async drain() { await tail; }, snapshot: () => ({ pending: count, accepting }) };
}

/** Testable single logical bridge. Notification failure is terminal for tools
 * as well as polls, with no reopen, probe retry, automatic ACK or claim. */
export function createSessionV2BridgeSession({ client, authority, channelSource, notify,
  onError = () => {}, closeRegistration = async () => {}, pollIntervalMs = 500, notificationTimeoutMs = 2500 } = {}) {
  if (typeof notify !== 'function' || !Number.isSafeInteger(notificationTimeoutMs)
      || notificationTimeoutMs < 10 || notificationTimeoutMs > 5000) {
    throw new SessionV2ClientError('session_v2_invalid_configuration');
  }
  const queue = createSessionV2RequestQueue(client);
  let started = false;
  let closed = false;
  let bridgeID;
  let registeredID;
  let opening;
  let closing;
  let poller;
  let pendingTools = 0;
  let pendingNotification;
  const notifyBounded = message => new Promise((resolveNotification, rejectNotification) => {
    if (closed) {
      rejectNotification(new SessionV2ClientError('session_v2_channel_notification_unknown'));
      return;
    }
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingNotification = undefined;
      if (error) rejectNotification(error); else resolveNotification();
    };
    const cancel = () => finish(new SessionV2ClientError('session_v2_channel_notification_unknown'));
    const timer = setTimeout(cancel, notificationTimeoutMs);
    pendingNotification = { cancel };
    // SDK stdio writes may wait for drain indefinitely without rejecting on
    // EOF/error. A bounded wait and shutdown cancellation end delivery locally;
    // a late write is never replayed, interpreted as ACK, or allowed to reopen.
    Promise.resolve().then(() => { if (!settled) return notify(message); })
      .then(() => finish(), cancel);
  });
  const close = () => {
    if (closing) return closing;
    closed = true;
    bridgeID = undefined;
    queue.stop();
    pendingNotification?.cancel();
    closing = Promise.resolve().then(async () => {
      await poller?.stop();
      await queue.drain();
      await opening;
      await client.close();
      if (registeredID) await closeRegistration(registeredID);
    });
    return closing;
  };
  const terminal = error => {
    if (closed) return;
    closed = true;
    bridgeID = undefined;
    queue.stop();
    try { onError(safeSessionV2ErrorCode(error)); } catch { /* Diagnostics cannot restart a logical bridge. */ }
    // Do not await the currently active poll/open from its own failure handler.
    void close().catch(() => {});
  };
  const toolHandler = createSessionV2ToolHandler({ request: command => queue.request(command),
    getBridgeID: () => closed ? undefined : bridgeID, channelSource });
  const handler = async (name, args) => {
    // The initialized notification may precede tools/call by only one frame.
    // Wait for that same admission, never create or retry another bridge.open.
    if (pendingTools >= 32) return sessionV2ToolError(new SessionV2ClientError('session_v2_queue_full'));
    pendingTools++;
    try {
      if (started && opening && !closed) await opening;
      return await toolHandler(name, args);
    } finally { pendingTools--; }
  };
  return {
    handler, close,
    start() {
      if (closed || started) return Promise.reject(new SessionV2ClientError('session_v2_bridge_reopen_forbidden'));
      started = true;
      opening = (async () => {
        const result = await queue.request({ operation: 'bridge.open' });
        validateSessionV2Result('bridge.open', result, {}, channelSource);
        registeredID = result.bridge_id;
        if (closed) return;
        bridgeID = result.bridge_id;
        poller = createSessionV2ChannelPoller({ authority, bridgeID, channelSource,
          exchange: request => queue.exchange(request),
          notifyEvent: event => notifyBounded(sessionV2ChannelNotification(event, { channelSource })),
          onError: code => terminal(new SessionV2ClientError(code)), intervalMs: pollIntervalMs });
        poller.start();
      })().catch(error => { terminal(error); });
      return opening;
    },
    snapshot: () => ({ started, closed, registered: bridgeID !== undefined, pendingTools,
      queue: queue.snapshot(), channel: poller?.snapshot() }),
  };
}

export function createSessionV2BridgeServer({ handler } = {}) {
  const server = new Server({ name: 'blabee-claude', version: '0.3.0' }, {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } }, instructions: SESSION_V2_WORKFLOW_INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: SESSION_V2_TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => handler(params.name,
    params.name === 'check_connection_v1' && params.arguments === undefined ? {} : params.arguments));
  return server;
}

export async function runSessionV2MCP({ env = process.env, args = process.argv.slice(2), input = process.stdin,
  output = process.stdout, errorOutput = process.stderr, createClient = createSessionV2Client, pollIntervalMs = 500,
  resolveContext, contextErrorCode = safeSessionV2ErrorCode } = {}) {
  // App-button sessions are already enrolled. Automatic CLI sessions can only
  // enroll after SessionStart; their SDK handshake must be available before it.
  const context = resolveContext ? undefined
    : await sessionV2Context('bridge', { env, expectedSessionID: expectedSessionArgument(args) });
  const client = context ? await createClient(context.configuration) : undefined;
  const admission = new AbortController();
  let server;
  let session;
  let closing;
  let initialized = false;
  let finishClosed;
  const closed = new Promise(resolveClosed => { finishClosed = resolveClosed; });
  const diagnostic = code => errorOutput.write(`[blabee-claude] 제품 Channel 연결을 확인하지 못했습니다 (${code}).\n`);
  const makeSession = (context, client) => createSessionV2BridgeSession({ client, authority: context.configuration.authority,
      channelSource: context.channelSource, notify: message => server.notification(message), pollIntervalMs,
      onError: code => { diagnostic(code); void cleanup(); },
      closeRegistration: async bridgeID => {
        let closer;
        try {
          // A separate close operation can retire a known bridge after transport
          // uncertainty. This never repeats the unknown open/tool/poll operation.
          closer = await createClient(context.configuration);
          const result = await closer.request({ operation: 'bridge.close', bridge_id: bridgeID });
          validateSessionV2Result('bridge.close', result, { bridge_id: bridgeID }, context.channelSource);
        } catch (error) { diagnostic(safeSessionV2ErrorCode(error)); }
        finally { await closer?.close(); }
      } });
  if (context) session = makeSession(context, client);
  server = createSessionV2BridgeServer({ handler: (name, args) => session ? session.handler(name, args)
    : sessionV2ToolError(new SessionV2ClientError('session_v2_bridge_not_registered')) });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: 128 * 1024 });
  const cleanup = () => {
    if (closing) return closing;
    // Abort pending bootstrap sockets/timers synchronously. SDK EOF must not
    // wait for a SessionStart that will never arrive after the picker closes.
    admission.abort();
    input.off('end', cleanup); input.off('close', cleanup); input.off('error', cleanup);
    output.off('error', outputFailed); output.off('close', cleanup);
    process.off('SIGINT', cleanup); process.off('SIGTERM', cleanup);
    closing = Promise.resolve().then(async () => {
      try { await session?.close(); }
      finally {
        try { await server.close(); }
        finally {
          // SDK close only pauses stdin. Retire this MCP's owned output too.
          // Custom streams close here; Node protects process.stdout from full
          // destruction, so the dedicated CLI exits after `closed` resolves.
          try { output.destroy(); } catch { /* Already closed output is terminal. */ }
          try { output.unref?.(); } catch { /* Custom test streams may have no socket. */ }
        }
      }
    }).then(() => 0, error => { diagnostic(safeSessionV2ErrorCode(error)); return 1; })
      .then(code => { finishClosed(code); return code; });
    return closing;
  };
  const outputFailed = () => { diagnostic('session_v2_channel_notification_unknown'); void cleanup(); };
  server.onclose = () => { void cleanup(); };
  server.onerror = () => { diagnostic('session_v2_unavailable'); void cleanup(); };
  server.oninitialized = () => {
    if (closing || initialized || !server.getClientVersion()) return;
    initialized = true;
    if (session) void session.start();
  };
  input.once('end', cleanup); input.once('close', cleanup); input.once('error', cleanup);
  output.once('error', outputFailed); output.once('close', cleanup);
  process.once('SIGINT', cleanup); process.once('SIGTERM', cleanup);
  try { await server.connect(transport); }
  catch (error) { await cleanup(); throw error; }
  if (resolveContext && !closing) {
    void Promise.resolve().then(() => resolveContext({ signal: admission.signal })).then(async context => {
      if (closing) return;
      const client = await createClient(context.configuration);
      if (closing) { await client.close(); return; }
      session = makeSession(context, client);
      if (initialized) void session.start();
    }).catch(error => {
      if (!closing) { diagnostic(contextErrorCode(error)); void cleanup(); }
    });
  }
  return { server, get session() { return session; }, close: cleanup, closed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = await runSessionV2MCP();
    // An unresolved OS stdout write can survive stdout.destroy/unref. At this
    // point owned requests and registration have finished and no new result is
    // valid, so only the dedicated MCP process may discard the remaining bytes.
    process.exit(await runtime.closed);
  }
  catch (error) { process.stderr.write(`[blabee-claude] 제품 MCP 시작 실패 (${safeSessionV2ErrorCode(error)}).\n`); process.exitCode = 1; }
}
