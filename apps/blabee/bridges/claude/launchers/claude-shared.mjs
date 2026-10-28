#!/usr/bin/env node
import { launchSharedClaude, parseSharedArguments } from './shared-launcher.mjs';

try {
  if (process.argv.slice(2).some(value => value === '--help' || value === '-h')) {
    console.log('claude:shared --coordinator-bin ABS [--cwd PATH] [--pet] [--claude-bin ABS] [--contracts ABS] [--runtime FRESH_PRIVATE_ABS] [-- --model MODEL --effort LEVEL]');
  } else {
    const options = parseSharedArguments(process.argv.slice(2));
    process.exitCode = await launchSharedClaude(options, {
      onRuntime: host => {
        console.error(`[blabee-claude] common engine · UI ${options.pet ? 'on' : 'off'} · project ${JSON.stringify(host.cwd)}`);
      },
    });
  }
} catch (error) {
  const code = typeof error?.code === 'string' && /^[a-z_]{1,80}$/.test(error.code)
    ? error.code : 'shared_launcher_failed';
  console.error(`[blabee-claude] ${code}`);
  process.exitCode = 1;
}
