import net from 'node:net';
import { MAX_MESSAGE_BYTES, PROTOCOL, PROVIDER, runtimePath, socketPath } from './identity.mjs';

export async function request(type, payload = {}, { auth, runtime = runtimePath(), timeout = 3000 } = {}) {
  const message = JSON.stringify({ protocol: PROTOCOL, provider: PROVIDER, type, ...(auth ? { auth } : {}), payload }) + '\n';
  if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES) throw new Error('request_too_large');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath(runtime));
    let data = Buffer.alloc(0);
    let finished = false;
    function finish(error, result) {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.setTimeout(timeout, () => finish(new Error('coordinator_timeout')));
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(message));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_MESSAGE_BYTES) return finish(new Error('response_too_large'));
      const newline = data.indexOf(10);
      if (newline < 0) return;
      try {
        const response = JSON.parse(data.subarray(0, newline).toString('utf8'));
        if (response.ok !== true) {
          const error = new Error(response.error?.message || 'coordinator_rejected');
          error.code = response.error?.code;
          return finish(error);
        }
        finish(null, response.result);
      } catch (error) { finish(error); }
    });
    socket.on('end', () => { if (!finished) finish(new Error('coordinator_closed')); });
  });
}
