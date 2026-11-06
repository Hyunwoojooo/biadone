import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute, join } from 'node:path';

export const PROTOCOL = 'blabee-claude.v1';
export const PROVIDER = 'claude';
export const PRODUCT = 'blabee-claude';
export const BUNDLE_ID = 'com.biadone.blabee.claude';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEVELOPMENT_BUILD_ROOT = resolve(PROJECT_ROOT, '../../build/claude-standalone');
export const MAX_MESSAGE_BYTES = 128 * 1024;

export function runtimePath(value = process.env.BLABEE_CLAUDE_RUNTIME) {
  const candidate = value || join(DEVELOPMENT_BUILD_ROOT, 'runtime');
  if (!isAbsolute(candidate) || candidate.includes('\0')) throw new Error('Claude runtime must be absolute');
  const normalized = resolve(candidate);
  if (normalized.includes('/Library/Application Support/Blabee/') || normalized.endsWith('/Library/Application Support/Blabee')) {
    throw new Error('Codex runtime cannot be used by blabee-claude');
  }
  return normalized;
}

export function socketPath(runtime = runtimePath()) {
  const path = join(runtime, 'blabee-claude.sock');
  if (Buffer.byteLength(path) > 103) throw new Error('Claude socket path exceeds macOS limit; use a shorter dedicated runtime');
  return path;
}
