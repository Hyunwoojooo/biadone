function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Only compose a reviewable command; this function never changes Codex settings. */
export function codexConnectionCommand(appDirectory: string, origin: string): string {
  if (!appDirectory.startsWith('/') || /[\r\n\0]/.test(appDirectory)) throw new Error('에디터 실행 경로를 확인해 주세요.');
  const address = new URL(origin);
  if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('로컬 에디터 주소만 연결할 수 있습니다.');
  const directory = appDirectory.replace(/\/$/, '');
  return ['codex', 'mcp', 'add', 'biadone-studio', '--env', `STUDIO_URL=${address.origin}`, '--', 'node', '--import', `${directory}/node_modules/tsx/dist/loader.mjs`, `${directory}/server/mcp.ts`].map(shellQuote).join(' ');
}
