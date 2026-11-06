import { cancelRun, check, parseArguments, reportRun, safeError } from './core.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['--run', '--operation']);
  check(['report', 'cancel'].includes(args['--operation']), 'operation_invalid');
  if (args['--operation'] === 'cancel') await cancelRun(args['--run']);
  process.stdout.write(`${JSON.stringify(reportRun(args['--run']), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`P1_FIXTURE_ERROR ${safeError(error)}\n`);
  process.exitCode = 1;
}
