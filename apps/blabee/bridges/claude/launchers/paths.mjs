import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIDGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = resolve(BRIDGE_ROOT, '../..');
