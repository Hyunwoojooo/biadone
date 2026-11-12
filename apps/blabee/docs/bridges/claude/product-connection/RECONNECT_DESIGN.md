# Claude 연결 재수립 설계 (초안, 2026-11-12)

상태: 설계만. 구현하지 않았다. [1순위 해결 방안](../../../development/BLABEE_P1_SOLUTIONS_20261112.md) 4·5번의 단계 3이다.
단계 1(보내지 못한 heartbeat 허용)과 단계 2(잠자기 시간을 lease 만료에서 제외)는 2026-11-12에 구현했다.

## 문제

열린 `claude` 창의 Blabee 연결은 한 번 끊기면 다시 붙지 않는다. 지금 끊기는 경우:

| 사건 | 현재 결과 | 근거 |
| --- | --- | --- |
| Blabee 서비스 재시작, 앱 업데이트 | scope 폐기(`serviceReplaced`), MCP 서버 종료 | `ClaudeSessionRegistry.disconnectAll`, `session-v2-mcp.mjs` terminal |
| 깨어 있는 상태로 lease 만료(타이머 정지 등) | owner 연결 종료 | `ClaudeOwnerRenewalController.observeClock` |
| MCP 서버 재시작(`/mcp` 재연결, 크래시) | 두 번째 `bridge.open`이 `end()` | `ClaudeNativeSession.swift` `bridge_reopen_forbidden` |
| 창 안 `/resume`, `/clear`(세션 ID 변경) | bootstrap `sessionChanged`로 종료 | `ClaudeAutoConnectBootstrap.perform` |

사용자에게 보이는 것은 Claude 화면에 섞여 나오는 stderr 한 줄과, 이후 조용히 동작하지 않는 Hook·MCP다.
[TECH_SPEC](TECH_SPEC.md)은 이 경우들을 "미지원·새 Claude 시작 안내"로 정했다. 이 설계는 그 결정을 바꾸는 제안이다.

## 원칙 (바꾸지 않는 것)

- 이전 boundary·카드·선택·claim을 이어받지 않는다. 재수립 뒤에는 새 프롬프트가 새 boundary를 연다.
- 실패한 mutation을 자동 재전송하지 않는다.
- 옛 역할 자격(token)으로 새 epoch를 발급하지 않는다. 재수립은 항상 새 owner enrollment와 새 역할 자격이다.
- Codex socket이나 다른 서비스로 넘어가지 않는다.

## 제안

### 닻: 실행기(launcher)

`claude`를 감싸는 `ClaudeInstalledLauncher` 프로세스는 Claude 자식이 살아 있는 동안 계속 산다. 자식 PID, 실행 폴더,
bootstrap 소켓과 두 bootstrap 자격(hook·bridge)을 가진 유일한 주체다. 재수립은 이 프로세스가 주도한다.

### 1. owner 재등록

- `ClaudeOwnerRenewalController`가 `expired`·`revoked(serviceReplaced)`·`transportFailed`로 끝나면, 실행기는 종료 대신
  "재등록 대기"로 간다. `ended`(SessionEnd)·`childExited`·`userDisconnected`는 지금처럼 끝낸다.
- 서비스 소켓이 다시 열리면(app-owned 서비스 재시작, 업데이트 후 새 앱) 실행기는 **새 owner 연결**로 enroll한다.
  `ObservedSession`은 마지막으로 관측한 native session id와 source `resume`이다. 대화를 이어받아 새 프로세스로 시작한 것과 같은 의미다.
- 새 enrollment는 새 scope·새 역할 자격·새 lease를 만든다. 서비스는 옛 scope의 기록만 보존한다.
- 재시도 간격: 1초에서 시작해 30초까지 늘린다. 서비스 버전이 바뀌어 enroll이 계약 오류로 거부되면 멈추고 안내한다.

### 2. bootstrap 상태

- 지금 상태 기계는 `.pending → .starting(native) → .ready(native, env) → .ended`다.
- `.ready`에서 owner가 끊기면 `.reconnecting(native)`로 간다. 이 상태의 `grant` 요청은 `pending`을 돌려준다.
  Hook은 `pending`이면 아무것도 주입하지 않고 exit 0한다(현재 `auto_connect_pending` 처리).
- 재등록이 끝나면 `.ready(native, newEnvironment)`로 돌아간다. 다음 Hook `grant`부터 새 역할 환경을 받는다.

### 3. MCP 서버

- terminal 오류에서 종료하지 않고 `resolveContext`(bootstrap `waitForGrant`)로 돌아간다. 새 grant가 오면 새 client로 `bridge.open`한다.
- 새 scope에서는 첫 `bridge.open`이므로 `bridge_reopen_forbidden`에 걸리지 않는다. 같은 scope 안의 재개방 금지는 유지한다.
- 대기 중 도구 호출은 `session_v2_bridge_not_registered`로 바로 거절한다. 모델은 다음 턴에 다시 시도할 수 있다.

### 4. 창 안 세션 변경(`/resume`, `/clear`)

- 실행기가 SessionStart(resume/clear/startup)의 새 native id를 bootstrap에서 받으면, 지금처럼 끝내는 대신 위 1을 같은 경로로 수행한다.
- 조건: 요청한 프로세스가 같은 Claude 자식 트리여야 한다(bootstrap이 이미 peer 프로세스 트리와 시작 시각을 확인한다).
- 옛 세션의 scope는 `sessionEnded`로 회수한다.

### 5. 사용자 표시

- 실행기는 stderr 대신 서비스에 상태를 보고하고, Pet의 Claude 세션 목록에 "다시 연결 중"·"다시 연결됨"·"연결 끊김(이유)"을 보여준다.
- 재수립된 창의 첫 Hook은 `systemMessage`로 한 번 알린다: "Blabee가 다시 연결됐습니다. 이전 카드는 이어지지 않습니다."

## 영향 범위

| 파일 | 변경 |
| --- | --- |
| `bridges/claude/swift/service/ClaudeInstalledLauncher.swift` | 재등록 루프, 상태 보고 |
| `bridges/claude/swift/service/ClaudeAutoConnectBootstrap.swift` | `.reconnecting` 상태, 세션 변경 시 재등록 |
| `bridges/claude/swift/session/ClaudeSessionRegistry.swift` | 같은 실행기의 새 enrollment를 이전 scope와 별도로 수락 |
| `bridges/claude/src/session-v2-mcp.mjs`, `auto-connect-mcp.mjs` | terminal 뒤 grant 대기로 복귀 |
| `bridges/claude/src/auto-connect-hook.mjs` | 재연결 안내, `pending` 처리 |
| `Contracts/bridge/claude-owner.v1.json` | 재등록 사유 필드가 필요하면 추가 |
| `TECH_SPEC.md`, `AUTO_CONNECT.md`, `SESSION_LIFECYCLE.md` | 수명 표 갱신 |

## 열린 질문

1. 재등록 시 enrollment가 요구하는 peer 서명 검사는 실행기 자신을 대상으로 하는가, Claude 자식을 대상으로 하는가? 업데이트로 앱 서명이 바뀐 뒤 옛 실행기 바이너리가 새 서비스에 enroll할 수 있어야 한다.
2. 업데이트 중에는 Claude payload 사용 기록이 업데이트를 막는다(`ClaudeRuntimePayloadUse`). 실행기가 살아 있는 채로 업데이트를 허용하려면 이 기록과의 관계를 먼저 정해야 한다.
3. Claude Code가 `/mcp` 재연결이나 원격 제어 연결 때 MCP 서버를 새 프로세스로 띄우는지 실제로 확인해야 한다.

## 검증 계획

- 단위: bootstrap 상태 전이, MCP 서버의 terminal 후 재grant, 실행기 재등록 루프(가짜 서비스).
- 통합: `test:installed-session`에 서비스 재시작 시나리오 추가.
- 수동: 열린 `claude` 창에서 앱 재시작, 앱 업데이트, `/resume`, `/clear` 뒤 다음 프롬프트에서 카드가 오는지.
