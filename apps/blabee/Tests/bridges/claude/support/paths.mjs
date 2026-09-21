import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = resolve(TEST_ROOT, '../../..');
export const BRIDGE_ROOT = resolve(REPOSITORY_ROOT, 'bridges/claude');
export const STANDALONE_ROOT = resolve(REPOSITORY_ROOT, 'dev/claude-standalone');

// Keep Unix socket fixtures shallow when this checkout lives in a long worktree path.
export const BUILD_ROOT = resolve(REPOSITORY_ROOT, 'build/claude-tests');
