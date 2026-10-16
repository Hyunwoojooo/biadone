"""Owned automatic-launch fixture in a real PTY; never invokes a model."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import sys
import time

phase = 'setup'


def main():
    global phase
    coordinator, node, payload, project, owner_socket, session_socket, runtime, source = sys.argv[1:]
    assert source in ('startup', 'resume', 'picker-cancel', 'preflight-cancel')
    root = Path(project)
    fake = root / "automatic claude ' $literal"
    driver = str(Path(__file__).with_name('auto-connect-session-driver.mjs'))
    forwarded = ["--", "literal --settings ' $(untouched)"] if source == 'startup' else ['--resume']
    body = r'''#!/usr/bin/python3
import json, os, subprocess, sys, time, uuid
from pathlib import Path
if sys.argv[1:] == ['--version']:
    if __SOURCE__ == 'preflight-cancel':
        Path(__file__).with_name('auto-preflight-started').write_text('started')
        time.sleep(0.75)
        sys.exit(99)
    print('2.1.282 (Claude Code)')
    sys.exit(0)
try:
    Path(__file__).with_name('auto-native-child-started').write_text('started')
    args = sys.argv[1:]
    assert all(os.isatty(fd) for fd in (0, 1, 2))
    assert os.tcgetpgrp(0) == os.getpgrp() == os.getpid()
    assert '--dangerously-load-development-channels' not in args
    assert args[0] == '--mcp-config' and args[2] == '--settings'
    assert args[4:] == __FORWARDED__
    assert '--session-id' not in args and '--fork-session' not in args
    assert '--dangerously-skip-permissions' not in args
    descriptors = []
    for fd in range(3, 256):
        try:
            os.fstat(fd)
            descriptors.append(fd)
        except OSError:
            pass
    assert descriptors == []
    assert not any(key.startswith('BLABEE_CLAUDE_SESSION_V2_') for key in os.environ)
    tokens = [os.environ['BLABEE_CLAUDE_BOOTSTRAP_' + role + '_TOKEN'] for role in ['HOOK', 'BRIDGE']]
    for path in [args[1], args[3]]:
        text = Path(path).read_text()
        assert all(value not in text for value in tokens)
        json.loads(text)
    environment = dict(os.environ)
    # The observed native ID is selected by Claude, not the Blabee owner.
    environment['CLAUDE_CODE_SESSION_ID'] = str(uuid.uuid4())
    result = subprocess.run([__NODE__, __DRIVER__, args[3], args[1], __SOURCE__],
        env=environment, capture_output=True, text=True, timeout=25)
    if result.returncode != 0:
        # The driver reports only a fixed fixture phase, never raw requests.
        for phase in ['initialize', 'picker', 'start', 'readiness', 'end']:
            if ('failed:' + phase) in result.stderr:
                print('AUTO_DRIVER_FAILED:' + phase, flush=True)
        raise RuntimeError('driver_failed')
    report = json.loads(result.stdout)
    report.update({'argumentsPreserved': True, 'privateFDsAbsent': True})
    Path('auto-child.json').write_text(json.dumps(report))
    print('AUTO_CHILD_COMPLETE', flush=True)
    sys.exit(23)
except Exception:
    print('AUTO_CHILD_FAILED', flush=True)
    sys.exit(97)
'''
    for key, value in [('__FORWARDED__', forwarded), ('__NODE__', node), ('__DRIVER__', driver), ('__SOURCE__', source)]:
        body = body.replace(key, repr(value))
    fake.write_text(body)
    fake.chmod(0o700)
    config = root / 'auto-config'
    config.mkdir(mode=0o700)
    user = root / 'auto-user-config'
    user.mkdir(mode=0o700)
    arguments = [coordinator, 'claude-installed-launcher-test', '--owner-socket', owner_socket,
                 '--session-socket', session_socket, '--runtime-identity', runtime,
                 '--cwd', project, '--claude-bin', str(fake), '--node-bin', node,
                 '--payload-root', payload, '--configuration-root', str(config),
                 '--observe-session', '--'] + forwarded
    child, master = pty.fork()
    if child == 0:
        environment = {key: value for key, value in os.environ.items() if not key.startswith('BLABEE_')}
        environment['CLAUDE_CONFIG_DIR'] = str(user)
        os.execve(coordinator, arguments, environment)
    output = bytearray()
    status = None
    cancelled = False
    deadline = time.monotonic() + 35
    try:
        phase = 'supervisor'
        while time.monotonic() < deadline:
            if source == 'preflight-cancel' and not cancelled and (root / 'auto-preflight-started').exists():
                os.kill(child, signal.SIGTERM)
                cancelled = True
            if select.select([master], [], [], 0.05)[0]:
                try:
                    output.extend(os.read(master, 8192))
                    if len(output) > 65536:
                        raise RuntimeError('output_limit')
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            observed, result = os.waitpid(child, os.WNOHANG)
            if observed == child:
                status = result
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
        for value in ['initialize', 'picker', 'start', 'readiness', 'end']:
            if ('AUTO_DRIVER_FAILED:' + value).encode() in output:
                phase = 'driver_' + value
        expected_status = 143 if source == 'preflight-cancel' else 23
        assert status is not None and os.WIFEXITED(status) and os.WEXITSTATUS(status) == expected_status
        phase = 'report'
        reports = [json.loads(line) for line in output.decode('utf-8').splitlines() if line.startswith('{')]
        supervisor = next(value for value in reports if value.get('cp05_supervisor'))
        assert supervisor['child_status'] == expected_status and supervisor['restored_foreground'] is True
        if source == 'preflight-cancel':
            assert cancelled and not (root / 'auto-native-child-started').exists()
            report = {'source': source, 'cancelledBeforeSpawn': True, 'realModel': False}
        else:
            report = json.loads((root / 'auto-child.json').read_text())
        report.update({'ok': True, 'foregroundRestored': True})
        assert report['realModel'] is False
        print(json.dumps(report))
    finally:
        if status is None:
            try:
                os.kill(child, signal.SIGTERM)
                deadline = time.monotonic() + 4
                while time.monotonic() < deadline:
                    if os.waitpid(child, os.WNOHANG)[0] == child:
                        break
                    time.sleep(0.02)
                else:
                    os.kill(child, signal.SIGKILL)
                    os.waitpid(child, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        os.close(master)


try:
    main()
except BaseException:
    sys.stderr.write('[auto-connect-pty-fixture] failed:' + phase + '\n')
    sys.exit(1)
