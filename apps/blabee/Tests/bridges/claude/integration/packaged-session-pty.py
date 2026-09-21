"""Owned CP-07 PTY fixtures; no Terminal application or real Claude model."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import sys
import termios
import time


def main():
    coordinator, node, payload, project, owner_socket, session_socket, runtime, store, mode = sys.argv[1:]
    root = Path(project)
    fake = root / "fake-claude"
    fake.write_text('''#!/usr/bin/python3
import json, os, subprocess, sys, time
from pathlib import Path
if sys.argv[1:] == ['--version']:
    print('2.1.276 (Claude Code)')
    sys.exit(0)
args = sys.argv[1:]
settings_path = args[args.index('--settings') + 1]
mcp_path = args[args.index('--mcp-config') + 1]
mcp = json.loads(Path(mcp_path).read_text())['mcpServers']['blabee-claude']
root = Path.cwd()
store = root / 'runtime-payload' / 'payloads'
node = Path(mcp['command'])
payload = Path(mcp['args'][0]).parent.parent
assert store in node.parents and store in payload.parents
assert all(os.isatty(fd) for fd in (0, 1, 2))
assert os.environ['PATH'] == '/usr/bin:/bin'
Path('paths-ready.json').write_text(json.dumps({'immutablePaths': True}))
if Path('orphan-mode').exists():
    # This process is intentionally outside the owner's group. No credential
    # is passed; its only job is a delayed disk import after the owner dies.
    source = """
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
writeFileSync('node-waiting', 'ready');
while (!existsSync('allow-import')) await new Promise(r => setTimeout(r, 10));
const { McpServer } = await import(pathToFileURL(process.argv[1]));
writeFileSync('delayed-import.json', JSON.stringify({ok: typeof McpServer === 'function'}));
"""
    orphan = subprocess.Popen([str(node), '--input-type=module', '-e', source,
        str(payload / 'node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js')],
        env={'PATH': '/usr/bin:/bin', 'HOME': str(root)}, start_new_session=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    Path('fixture-pids.json').write_text(json.dumps({'claude': os.getpid(), 'node': orphan.pid}))
    while True:
        time.sleep(0.1)
else:
    # Wait until the harness removes the original bundle input. Both command
    # Hooks and stdio MCP must now resolve solely inside the prepared store.
    while not Path('allow-import').exists():
        time.sleep(0.01)
    result = subprocess.run([str(node), str(root / 'runtime-driver.mjs'), settings_path, mcp_path],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
    report = json.loads(result.stdout)
    assert report['channelAcknowledged'] is True
    Path('normal-report.json').write_text(json.dumps(report))
''')
    fake.chmod(0o700)
    config = root / 'config'
    config.mkdir(mode=0o700)
    cli_config = root / 'isolated-claude-config'
    cli_config.mkdir(mode=0o700)
    if mode == 'owner-kill':
        (root / 'orphan-mode').touch()
    args = [coordinator, 'claude-packaged-launcher-test', store,
            '--owner-socket', owner_socket, '--session-socket', session_socket,
            '--runtime-identity', runtime, '--cwd', project, '--claude-bin', str(fake),
            '--node-bin', node, '--payload-root', payload, '--configuration-root', str(config)]
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        for fd in range(3):
            os.dup2(slave, fd)
        os.close(master)
        if slave > 2:
            os.close(slave)
        environment = {k: v for k, v in os.environ.items() if not k.startswith('BLABEE_')}
        environment['CLAUDE_CONFIG_DIR'] = str(cli_config)
        os.execve(coordinator, args, environment)
    os.close(slave)
    child_status = None
    owned_pids = []
    output_bytes = 0

    def wait_for(predicate):
        nonlocal child_status, output_bytes
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.02)[0]:
                try:
                    output_bytes += len(os.read(master, 16384))
                    assert output_bytes < 65536
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            if child_status is None:
                observed, status = os.waitpid(pid, os.WNOHANG)
                if observed == pid:
                    child_status = status
            if predicate():
                return
            time.sleep(0.01)
        raise RuntimeError('bounded_fixture_timeout')

    try:
        wait_for(lambda: (root / 'paths-ready.json').exists())
        assert json.loads((root / 'paths-ready.json').read_text())['immutablePaths'] is True
        if mode == 'owner-kill':
            wait_for(lambda: (root / 'fixture-pids.json').exists() and (root / 'node-waiting').exists())
            owned_pids = list(json.loads((root / 'fixture-pids.json').read_text()).values())
            os.kill(pid, signal.SIGKILL)
            wait_for(lambda: child_status is not None)
            assert os.WIFSIGNALED(child_status) and os.WTERMSIG(child_status) == signal.SIGKILL
        # Only the explicit per-test bundle copy is removed, never source or
        # the immutable runtime tree the child is still using.
        shutil.rmtree(root / 'bundled-runtime')
        (root / 'allow-import').touch()
        if mode == 'owner-kill':
            wait_for(lambda: (root / 'delayed-import.json').exists())
            assert json.loads((root / 'delayed-import.json').read_text())['ok'] is True
            report = {'ownerKilled': True, 'delayedImport': True}
        else:
            wait_for(lambda: child_status is not None)
            assert os.WIFEXITED(child_status) and os.WEXITSTATUS(child_status) == 0
            report = json.loads((root / 'normal-report.json').read_text())
        report.update(ok=True, immutablePaths=True, realModel=False)
        print(json.dumps(report))
    finally:
        # Exact fixture PIDs only; no process-name sweep.
        if not owned_pids and (root / 'fixture-pids.json').exists():
            owned_pids = list(json.loads((root / 'fixture-pids.json').read_text()).values())
        for owned in owned_pids:
            try:
                os.kill(owned, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if child_status is None:
            try:
                os.kill(pid, signal.SIGTERM)
                wait_for(lambda: child_status is not None)
            except BaseException:
                try:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
                except (ProcessLookupError, ChildProcessError):
                    pass
        os.close(master)


try:
    main()
except BaseException:
    # Never print child output, arguments, environment or runtime credentials.
    sys.stderr.write('[cp07-pty-fixture] failed\n')
    sys.exit(1)
