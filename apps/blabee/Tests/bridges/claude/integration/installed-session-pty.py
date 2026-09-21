"""Owned fake Claude in a real PTY. Never launches Terminal or a real model."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import sys
import termios
import time

phase = 'setup'
diagnostic = ''


def main():
    global phase, diagnostic
    coordinator, node, payload, project, owner_socket, session_socket, runtime = sys.argv[1:]
    root = Path(project)
    fake = root / "fake claude ' $literal"
    fake.write_text('''#!/usr/bin/python3
import json, os, signal, sys, time
from pathlib import Path
if sys.argv[1:] == ['--version']:
    print('2.1.276 (Claude Code)')
    sys.exit(0)
prefix = 'BLABEE_CLAUDE_SESSION_V2_'
args = sys.argv[1:]
assert '--strict-mcp-config' not in args
assert '--dangerously-skip-permissions' not in args
print('PTY_CHECK:tty', flush=True)
assert all(os.isatty(fd) for fd in (0, 1, 2))
assert os.tcgetpgrp(0) == os.getpgrp() == os.getpid()
print('PTY_CHECK:environment', flush=True)
assert os.environ[prefix + 'NATIVE_SESSION_ID'] == args[args.index('--session-id') + 1]
assert os.environ['MCP_PROTOCOL_NEGOTIATION'] == 'legacy'
for role in ['OWNER', 'SELECTOR', 'CONTROL']:
    assert not os.environ.get(prefix + role + '_TOKEN')
print('PTY_CHECK:configuration', flush=True)
tokens = [os.environ[prefix + role + '_TOKEN'] for role in ['HOOK', 'BRIDGE']]
for option in ['--settings', '--mcp-config']:
    text = Path(args[args.index(option) + 1]).read_text()
    assert all(token not in text for token in tokens)
    json.loads(text)
print('PTY_CHECK:descriptors', flush=True)
descriptors = []
for fd in range(3, 256):
    try:
        os.fstat(fd)
        descriptors.append(fd)
    except OSError:
        pass
assert descriptors == []
received_interrupt = False
received_continue = False
def interrupted(signum, frame):
    global received_interrupt
    received_interrupt = True
def continued(signum, frame):
    global received_continue
    received_continue = True
    print('PTY_CHILD_CONTINUED', flush=True)
signal.signal(signal.SIGINT, interrupted)
signal.signal(signal.SIGCONT, continued)
print('PTY_CHILD_READY', flush=True)
deadline = time.monotonic() + 10
while not received_interrupt and time.monotonic() < deadline:
    time.sleep(0.01)
assert received_interrupt
assert received_continue
Path('pty-child.json').write_text(json.dumps({'tty': True, 'foreground': True,
    'private_fds_absent': True, 'native_permissions_preserved': True, 'real_model': False}))
sys.exit(23)
''')
    fake.chmod(0o700)
    config_root = root / "config"
    config_root.mkdir(mode=0o700)
    user_config = root / "isolated-claude-config"
    user_config.mkdir(mode=0o700)
    args = [coordinator, 'claude-installed-launcher-test', '--owner-socket', owner_socket,
            '--session-socket', session_socket, '--runtime-identity', runtime,
            '--cwd', project, '--claude-bin', str(fake), '--node-bin', node,
            '--payload-root', payload, '--configuration-root', str(config_root)]
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            for fd in range(3):
                os.dup2(slave, fd)
            os.close(master)
            if slave > 2:
                os.close(slave)
            environment = {k: v for k, v in os.environ.items() if not k.startswith('BLABEE_')}
            environment['CLAUDE_CONFIG_DIR'] = str(user_config)
            # A tiny invoking shell owns the terminal and observes its job.
            # The real Terminal path likewise keeps the user's shell alive.
            supervisor = os.fork()
            if supervisor == 0:
                os.setpgid(0, 0)
                os.kill(os.getpid(), signal.SIGSTOP)
                os.execve(coordinator, args, environment)
            signal.signal(signal.SIGTTOU, signal.SIG_IGN)

            def terminate_fixture(signum, frame):
                os.kill(supervisor, signal.SIGCONT)
                os.kill(supervisor, signal.SIGTERM)
                finish = time.monotonic() + 3
                while time.monotonic() < finish:
                    if os.waitpid(supervisor, os.WNOHANG)[0] == supervisor:
                        os._exit(143)
                    time.sleep(0.02)
                os.kill(supervisor, signal.SIGKILL)
                os.waitpid(supervisor, 0)
                os._exit(143)

            signal.signal(signal.SIGTERM, terminate_fixture)
            observed, gated = os.waitpid(supervisor, os.WUNTRACED)
            assert observed == supervisor and os.WIFSTOPPED(gated)
            os.tcsetpgrp(0, supervisor)
            os.kill(supervisor, signal.SIGCONT)
            stopped = False
            while True:
                observed, result = os.waitpid(supervisor, os.WUNTRACED)
                if os.WIFSTOPPED(result):
                    assert not stopped and os.tcgetpgrp(0) == supervisor
                    stopped = True
                    os.tcsetpgrp(0, os.getpgrp())
                    print('PTY_SUPERVISOR_STOPPED', flush=True)
                    # A background resume must not seize the terminal.
                    os.kill(supervisor, signal.SIGCONT)
                    time.sleep(0.15)
                    assert os.tcgetpgrp(0) == os.getpgrp()
                    print('PTY_BACKGROUND_PRESERVED', flush=True)
                    os.tcsetpgrp(0, supervisor)
                    os.kill(supervisor, signal.SIGCONT)
                else:
                    os.tcsetpgrp(0, os.getpgrp())
                    assert stopped and os.WIFEXITED(result)
                    os._exit(os.WEXITSTATUS(result))
        except BaseException:
            os._exit(99)
    os.close(slave)
    output = bytearray()
    status = None
    interrupted = False
    suspended = False
    deadline = time.monotonic() + 25
    try:
        phase = 'supervisor'
        while time.monotonic() < deadline:
            readable, _, _ = select.select([master], [], [], 0.05)
            if readable:
                try:
                    data = os.read(master, 8192)
                    if data:
                        output.extend(data)
                        if not suspended and b'PTY_CHILD_READY' in output:
                            os.write(master, b'\x1a')
                            suspended = True
                        if not interrupted and b'PTY_CHILD_CONTINUED' in output:
                            os.write(master, b'\x03')
                            interrupted = True
                        if len(output) > 65536:
                            raise RuntimeError('output_limit')
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            observed, value = os.waitpid(pid, os.WNOHANG)
            if observed == pid:
                status = value
                while select.select([master], [], [], 0)[0]:
                    try:
                        chunk = os.read(master, 8192)
                        if not chunk:
                            break
                        output.extend(chunk)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                break
        if status is None:
            os.killpg(pid, signal.SIGTERM)
            raise RuntimeError('supervisor_timeout')
        phase = 'child_exit'
        # Only fixed fixture markers and a numeric status leave this process.
        markers = [value for value in ['tty', 'environment', 'configuration', 'descriptors']
                   if ('PTY_CHECK:' + value).encode() in output]
        native_errors = [code for code in ['path_invalid', 'configuration_invalid', 'socket_invalid',
                         'claude_version_unsupported', 'node_version_unsupported', 'tty_required',
                         'spawn_failed', 'terminal_handoff_failed', 'mcp_name_conflict']
                         if ('claude_installed_' + code).encode() in output]
        diagnostic = ':status=' + str(status) + ':checks=' + ','.join(markers) + ':codes=' + ','.join(native_errors)
        assert suspended and interrupted and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 23
        assert b'PTY_SUPERVISOR_STOPPED' in output and b'PTY_BACKGROUND_PRESERVED' in output
        phase = 'supervisor_report'
        reports = []
        for line in output.decode('utf-8').splitlines():
            if line.startswith('{'):
                reports.append(json.loads(line))
        summary = next(value for value in reports if value.get('cp05_supervisor'))
        assert summary['child_status'] == 23 and summary['restored_foreground'] is True
        phase = 'child_report'
        child = json.loads((root / 'pty-child.json').read_text())
        assert child['tty'] and child['foreground'] and child['private_fds_absent']
        print(json.dumps({'ok': True, 'tty': True, 'foregroundRestored': True,
                          'childExitObserved': True, 'privateFDsAbsent': True,
                          'suspendResumed': True, 'backgroundPreserved': True, 'realModel': False}))
    finally:
        if status is None:
            try:
                os.kill(pid, signal.SIGTERM)
                finish = time.monotonic() + 4
                reaped = False
                while time.monotonic() < finish:
                    if os.waitpid(pid, os.WNOHANG)[0] == pid:
                        reaped = True
                        break
                    time.sleep(0.02)
                if not reaped:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        os.close(master)


try:
    main()
except BaseException:
    # No argv/environment/raw child output: failures never reflect credentials.
    sys.stderr.write('[cp05-pty-fixture] failed:' + phase + diagnostic + '\n')
    sys.exit(1)
