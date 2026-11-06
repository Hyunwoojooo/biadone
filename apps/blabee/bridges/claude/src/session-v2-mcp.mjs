import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { expectedSessionArgument } from './product-context.mjs';
import { createSessionV2Client, SessionV2ClientError, validateSessionV2Result } from './session-v2-client.mjs';
import { createSessionV2ChannelPoller } from './session-v2-channel-poller.mjs';
import { SESSION_V2_WORKFLOW_INSTRUCTIONS, safeSessionV2ErrorCode, sessionV2Context } from './session-v2-context.mjs';
import { SESSION_V2_TOOL_DEFINITIONS, createSessionV2ToolHandler, sessionV2ToolError } from './session-v2-tools.mjs';

const diagnosticWriters = new WeakMap();

/** Diagnostics are best-effort and never own their stream or bridge lifetime.
 * Keep one error listener for the stream's lifetime: a write can report EPIPE
 * even after runtime.closed or close has fired. Sharing the writer avoids
 * accumulating listeners when multiple runtimes use the same caller stderr. */
export function createSessionV2DiagnosticWriter(stream) {
  if (!stream || (typeof stream !== 'object' && typeof stream !== 'function')) return () => false;
  const existing = diagnosticWriters.get(stream);
  if (existing) return existing;
  let disabled = false;
  const disable = () => { disabled = true; };
  const write = message => {
    if (disabled) return false;
    try {
      if (stream.destroyed || stream.closed || stream.writableEnded || stream.writableFinished || stream.writable === false) {
        disable(); return false;
      }
      // A false return already queued these bytes. Drop later diagnostics to
      // bound buffering on an unconsumed pipe; never wait for drain or resend.
      if (stream.write(message, error => { if (error) disable(); }) === false) disable();
      return !disabled;
    } catch { disable(); return false; }
  };
  diagnosticWriters.set(stream, write);
  try {
    // Plain synchronous sinks remain useful to callers/tests. Real Writable
    // streams must have their error handler installed before the first write.
    stream.on?.('error', disable);
    stream.on?.('close', disable);
    stream.on?.('finish', disable);
  } catch { disable(); }
  return write;
}

/** Callers share one admission/open result. A cancelled caller removes its
 * listener and capacity immediately without cancelling or retaining another
 * continuation on the shared operation. */
function createSessionV2Waiters() {
  const waiters = new Set();
  let settled = false;
  let failure;
  return {
    wait(signal) {
      if (signal?.aborted) return Promise.reject(new SessionV2ClientError('session_v2_request_cancelled'));
      if (settled) return failure ? Promise.reject(failure) : Promise.resolve();
      if (waiters.size >= 32) return Promise.reject(new SessionV2ClientError('session_v2_queue_full'));
      return new Promise((resolve, reject) => {
        const finish = error => {
          if (!waiters.delete(finish)) return;
          signal?.removeEventListener('abort', cancelled);
          if (error) reject(error); else resolve();
        };
        const cancelled = () => finish(new SessionV2ClientError('session_v2_request_cancelled'));
        waiters.add(finish);
        signal?.addEventListener('abort', cancelled, { once: true });
        if (signal?.aborted) cancelled();
      });
    },
    settle(error) {
      if (settled) return;
      settled = true;
      failure = error;
      for (const finish of waiters) finish(error);
    },
  };
}

/** One authenticated RPC at a time: a waiting poll owns the next free slot;
 * ordinary requests retain FIFO order. Capacity includes active work: 32
 * ordinary requests plus one poll, without coalescing or creating requests.
 * Per-call cancellation skips unsent work; it never releases an in-flight slot. */
export function createSessionV2RequestQueue(client) {
  let accepting = true;
  let active = false;
  let scheduled = false;
  let ordinaryCount = 0;
  let pollOutstanding = false;
  let waitingPoll;
  const ordinary = [];
  const drainers = [];
  const count = () => ordinaryCount + Number(pollOutstanding);
  const schedule = () => {
    if (active || scheduled || count() === 0) return;
    scheduled = true;
    // Let the completed result's consumers finish their microtasks, including
    // terminal poll validation and cancellation, before sending another RPC.
    setImmediate(dispatch);
  };
  const release = entry => {
    if (entry.poll) pollOutstanding = false; else ordinaryCount--;
    if (count() === 0) for (const resolve of drainers.splice(0)) resolve();
    schedule();
  };
  const dispatch = () => {
    scheduled = false;
    const entry = waitingPoll ?? ordinary.shift();
    if (!entry) return;
    if (entry.poll) waitingPoll = undefined;
    entry.queued = false;
    entry.signal?.removeEventListener('abort', entry.cancelled);
    active = true;
    Promise.resolve().then(() => {
      if (entry.signal?.aborted) throw new SessionV2ClientError('session_v2_request_cancelled');
      if (!accepting) throw new SessionV2ClientError('session_v2_bridge_closed');
      return client[entry.method](entry.value, { signal: entry.signal });
    }).then(entry.resolve, entry.reject).then(() => {
      active = false;
      release(entry);
    });
  };
  const enqueue = (method, value, { signal } = {}) => {
    if (signal?.aborted) return Promise.reject(new SessionV2ClientError('session_v2_request_cancelled'));
    if (!accepting) return Promise.reject(new SessionV2ClientError('session_v2_bridge_closed'));
    const poll = method === 'exchange' && value?.operation === 'bridge.poll';
    if (poll ? pollOutstanding : ordinaryCount >= 32) {
      return Promise.reject(new SessionV2ClientError('session_v2_queue_full'));
    }
    const result = new Promise((resolve, reject) => {
      const entry = { method, value, signal, poll, resolve, reject, queued: true };
      entry.cancelled = () => {
        if (!entry.queued) return;
        entry.queued = false;
        if (poll) waitingPoll = undefined;
        else ordinary.splice(ordinary.indexOf(entry), 1);
        signal?.removeEventListener('abort', entry.cancelled);
        reject(new SessionV2ClientError('session_v2_request_cancelled'));
        release(entry);
      };
      if (poll) { pollOutstanding = true; waitingPoll = entry; }
      else { ordinaryCount++; ordinary.push(entry); }
      signal?.addEventListener('abort', entry.cancelled, { once: true });
      if (signal?.aborted) entry.cancelled();
    });
    schedule();
    return result;
  };
  return { request: (value, options) => enqueue('request', value, options),
    exchange: (value, options) => enqueue('exchange', value, options),
    stop() { accepting = false; },
    async drain() { if (count() !== 0) await new Promise(resolve => drainers.push(resolve)); },
    snapshot: () => ({ pending: count(), accepting }) };
}

/** Testable single logical bridge. Heartbeat failure is terminal for tools
 * as well as polls, with no reopen, probe retry, automatic ACK or claim. */
export function createSessionV2BridgeSession({ client, authority, channelSource,
  onError = () => {}, closeRegistration = async () => {}, pollIntervalMs = 500 } = {}) {
  const queue = createSessionV2RequestQueue(client);
  let started = false;
  let closed = false;
  let bridgeID;
  let registeredID;
  let opening;
  let closing;
  let poller;
  let pendingTools = 0;
  const openingWaiters = createSessionV2Waiters();
  const close = () => {
    if (closing) return closing;
    closed = true;
    bridgeID = undefined;
    openingWaiters.settle(new SessionV2ClientError('session_v2_bridge_closed'));
    queue.stop();
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
  const toolHandler = createSessionV2ToolHandler({ request: (command, options) => queue.request(command, options),
    getBridgeID: () => closed ? undefined : bridgeID, channelSource });
  const handler = async (name, args, { signal } = {}) => {
    // The initialized notification may precede tools/call by only one frame.
    // Wait for that same admission, never create or retry another bridge.open.
    if (signal?.aborted) return sessionV2ToolError(new SessionV2ClientError('session_v2_request_cancelled'));
    if (pendingTools >= 32) return sessionV2ToolError(new SessionV2ClientError('session_v2_queue_full'));
    pendingTools++;
    try {
      if (started && opening && !closed) await openingWaiters.wait(signal);
      return await toolHandler(name, args, { signal });
    } catch (error) {
      return sessionV2ToolError(error);
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
          onError: code => terminal(new SessionV2ClientError(code)), intervalMs: pollIntervalMs });
        poller.start();
      })().catch(error => { terminal(error); }).finally(() => openingWaiters.settle());
      return opening;
    },
    snapshot: () => ({ started, closed, registered: bridgeID !== undefined, pendingTools,
      queue: queue.snapshot(), heartbeat: poller?.snapshot() }),
  };
}

export function createSessionV2BridgeServer({ handler } = {}) {
  const server = new Server({ name: 'blabee-claude', version: '0.3.0' }, {
    capabilities: { tools: {} }, instructions: SESSION_V2_WORKFLOW_INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: SESSION_V2_TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => handler(params.name,
    params.name === 'check_connection_v1' && params.arguments === undefined ? {} : params.arguments, { signal }));
  return server;
}

export async function runSessionV2MCP({ env = process.env, args = process.argv.slice(2), input = process.stdin,
  output = process.stdout, errorOutput = process.stderr, createClient = createSessionV2Client, pollIntervalMs = 500,
  resolveContext, contextErrorCode = safeSessionV2ErrorCode } = {}) {
  const writeDiagnostic = createSessionV2DiagnosticWriter(errorOutput);
  const diagnostic = code => writeDiagnostic(`[blabee-claude] 제품 MCP 연결을 확인하지 못했습니다 (${code}).\n`);
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
  const admissionWaiters = createSessionV2Waiters();
  let finishClosed;
  const closed = new Promise(resolveClosed => { finishClosed = resolveClosed; });
  const makeSession = (context, client) => createSessionV2BridgeSession({ client, authority: context.configuration.authority,
      channelSource: context.channelSource, pollIntervalMs,
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
  // Automatic sessions expose their SDK handshake before the actual native
  // SessionStart grant. Wait only after initialized, with the same bounded
  // admission; cancelling one tool must not cancel bootstrap for other tools.
  server = createSessionV2BridgeServer({ handler: async (name, args, options) => {
    if (!session && initialized && resolveContext) {
      try {
        if (closing || admission.signal.aborted) throw new SessionV2ClientError('session_v2_bridge_closed');
        await admissionWaiters.wait(options?.signal);
      }
      catch (error) { return sessionV2ToolError(error); }
    }
    return session ? session.handler(name, args, options)
      : sessionV2ToolError(new SessionV2ClientError('session_v2_bridge_not_registered'));
  } });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: 128 * 1024 });
  const cleanup = () => {
    if (closing) return closing;
    // Abort pending bootstrap sockets/timers synchronously. SDK EOF must not
    // wait for a SessionStart that will never arrive after the picker closes.
    admission.abort();
    admissionWaiters.settle(new SessionV2ClientError('session_v2_bridge_closed'));
    input.off('end', cleanup); input.off('close', cleanup); input.off('error', cleanup);
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
  // SDK writes can fail while RPCs drain or asynchronous destruction finishes.
  // Keep handling errors until the owned stream closes, without restarting
  // cleanup or reporting every later failure of the same terminal output.
  const outputFailed = () => {
    if (closing) return;
    diagnostic('session_v2_channel_notification_unknown'); void cleanup();
  };
  const outputClosed = () => { output.off('error', outputFailed); void cleanup(); };
  server.onclose = () => { void cleanup(); };
  server.onerror = () => { diagnostic('session_v2_unavailable'); void cleanup(); };
  server.oninitialized = () => {
    if (closing || initialized || !server.getClientVersion()) return;
    initialized = true;
    if (session) void session.start();
  };
  input.once('end', cleanup); input.once('close', cleanup); input.once('error', cleanup);
  output.on('error', outputFailed); output.once('close', outputClosed);
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
      admissionWaiters.settle();
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
  catch (error) {
    createSessionV2DiagnosticWriter(process.stderr)(`[blabee-claude] 제품 MCP 시작 실패 (${safeSessionV2ErrorCode(error)}).\n`);
    process.exitCode = 1;
  }
}
