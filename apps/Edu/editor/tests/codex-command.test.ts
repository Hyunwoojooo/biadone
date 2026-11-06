import {describe, expect, it} from 'vitest';
import {codexConnectionCommand} from '../src/lib/codex';

describe('local Codex connection command', () => {
  it('uses the application path rather than the project data directory and preserves a custom port', () => {
    const command = codexConnectionCommand('/Users/example/My Studio', 'http://127.0.0.1:4999');
    expect(command).toContain('STUDIO_URL=http://127.0.0.1:4999');
    expect(command).toContain("'/Users/example/My Studio/server/mcp.ts'");
  });
  it('shell-quotes path metacharacters without command substitution', () => {
    const command = codexConnectionCommand("/tmp/Studio's $draft`x`", 'http://localhost:4317');
    expect(command).toContain("'/tmp/Studio'\\''s $draft`x`/server/mcp.ts'");
  });
  it('refuses remote origins, relative paths and multiline commands', () => {
    expect(() => codexConnectionCommand('/tmp/studio', 'https://example.com')).toThrow();
    expect(() => codexConnectionCommand('relative/path', 'http://localhost:4317')).toThrow();
    expect(() => codexConnectionCommand('/tmp/line\nbreak', 'http://localhost:4317')).toThrow();
  });
});
