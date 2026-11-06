import { INPUT_LIMIT, cancelRun, check, parseArguments, processHook, safeError } from './core.mjs';

// Bounded stdin; never log prompt text, transcript paths, environment values, or raw errors.
function readInput(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => finish(new Error('stdin_timeout')), 2_000);
    function finish(error, value) {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.pause();
      if (error) reject(Object.assign(new Error('input_invalid_or_incomplete'), { fixtureCode: 'input_invalid_or_incomplete' }));
      else resolve(value);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > INPUT_LIMIT) finish(new Error('input_limit'));
      else chunks.push(chunk);
    }
    function onEnd() {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('json_invalid')); }
    }
    function onError() { finish(new Error('stdin_error')); }
    stream.on('data', onData).once('end', onEnd).once('error', onError);
  });
}

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
let args;
let handedToProcessor = false;
try {
  args = parseArguments(process.argv.slice(2), ['--run', '--event']);
  const input = await readInput(process.stdin);
  check(!controller.signal.aborted, 'interrupted_before_input');
  handedToProcessor = true;
  const result = await processHook(args['--run'], args['--event'], input, { signal: controller.signal });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch (error) {
  if (args && !handedToProcessor) {
    try { await cancelRun(args['--run'], 'observation_error'); } catch { /* No unverified repair/retry. */ }
  }
  // Exit 2 is reserved exclusively for the one deliberate rewake trial.
  process.stderr.write(`P1_FIXTURE_ERROR ${safeError(error)}\n`);
  process.exitCode = 1;
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  process.stdin.destroy();
}
