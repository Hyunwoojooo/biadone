import { parseArguments, prepareRun, safeError } from './core.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['--run', '--mode'], ['--origin']);
  const run = prepareRun(args['--run'], args['--mode'], args['--origin'] ?? 'native-prepared');
  process.stdout.write(`${JSON.stringify({
    directory: run.directory, mode: run.mode,
    settings: `${run.directory}/settings.json`,
    native_execution: 'NOT_RUN', instruction: '격리 환경을 확인한 뒤 README의 수동 실행 절차를 사용하세요.',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`P1_FIXTURE_ERROR ${safeError(error)}\n`);
  process.exitCode = 1;
}
