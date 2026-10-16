# Claude Code 연결 호환성

검토일: 2026-10-11. 현재 제품은 [일반 MCP·Stop Hook](PUBLIC_MCP_HOOK.md)을 사용한다.
소스·SDK 검사와 실제 설치·모델 검증을 구분한다.

## 버전과 확인 범위

최신 공개판은 [Claude Code 2.1.296](https://github.com/anthropics/claude-code/releases/tag/v2.1.296)이다.
[공식 release API](https://api.github.com/repos/anthropics/claude-code/releases/tags/v2.1.296)의 발행 시각은
2026-10-09 19:28:59 UTC, 한국 시각 2026-10-10 04:28:59다.
로컬 `/Users/joo/.local/bin/claude` symlink 대상은 `versions/2.1.289`였다. CLI를 업데이트하거나 실행하지 않았다.

| 대상 | 확인한 범위 | 확인하지 않은 범위 |
| --- | --- | --- |
| 2.1.282 | 2026-09-27 native 세션의 MCP ACK·Stop 알림·claim·완료 왕복 | 현재 변경의 설치 앱 동작 |
| 2.1.289 | 현재 로컬 설치 파일과 기존 버전 허용 조건 | 이번 변경의 실제 모델 왕복 |
| 2.1.296 | 공식 변경사항과 기존 버전 허용 조건 | 해당 CLI의 초기화·실제 Hook 출력·모델 왕복 |
| MCP SDK 1.30.0 | 실제 제품 Node 서버의 6개 초기화·명시적 ACK fixture | 실제 2.1.296 클라이언트와의 연결 |

`ClaudeInstalledLaunchConfiguration.supportsVersion`은 2.1.282 이상인 2.x를 허용한다.
이는 기능 하한 검사이며 이후 버전의 native 동작을 보증하지 않는다. 이번에 허용 범위를 넓히지 않는다.

## 최신 변경사항에 대한 대응

- [2.1.292](https://github.com/anthropics/claude-code/releases/tag/v2.1.292)는 stdio MCP의 새 협상을 기본 시도한다.
  현재 launcher는 소유한 Claude 자식에 `MCP_PROTOCOL_NEGOTIATION=legacy`를 이미 지정한다.
  [공식 MCP 안내](https://code.claude.com/docs/en/mcp)에 따라 이를 유지한다. 해당 자식의 다른 MCP에도
  적용되는 값이므로 실제 수용 때 함께 확인한다.
- [2.1.290](https://github.com/anthropics/claude-code/releases/tag/v2.1.290)의 async Stop 경로 수정과
  2.1.296의 Hook 출력·UserPromptSubmit 중단·완료한 MCP 턴의 재실행 수정은 CLI 자체 변경이다.
  선택 재전송, 만료 연장, Stop 문자열의 부분 일치 허용을 추가할 근거로 사용하지 않는다.
  2.1.292는 Hook 출력 안의 `<system-reminder>`를 escape한다. 현재 제한된 선택 알림에는 그 태그를
  넣지 않지만, 최신 native의 전체 wrapper와 실제 UPS 입력이 기존 해시와 일치하는지는 아직 검증하지 않았다.
- [공식 Hook 안내](https://code.claude.com/docs/en/hooks)에 따르면 `onFailure: "block"`은 Stop/asyncRewake에
  적용되지 않는다. 해당 설정을 추가하지 않는다. 현재 SDK는 빈·form·form/URL `elicitation`을 처리하므로
  `bareElicitationCapability`를 일괄 추가하거나 SDK를 교체할 근거도 없다.

## 이번 연결 업데이트

MCP 초기화·도구 목록은 실제 SessionStart 등록 이전에도 응답한다. 유효한 SDK 초기화 이후 첫 도구 호출이
등록보다 먼저 오면 같은 등록과 단 한 번의 `bridge.open`을 기다린다. 초기화 전 호출은 계속 거절한다.
등록 대기는 최대 32개이며 개별 취소는 그 슬롯만 반환한다. open 대기 중 취소도 도구 슬롯을 반환하되,
이미 진행 중인 open RPC는 결과를 기다리고 반복하지 않는다. EOF·출력 실패·등록 실패는 대기를 끝낸다.
자동 ACK·claim·재호출은 만들지 않는다.

`daemon`, `purge`, `self-hosted-runner`, `--desktop`은 원본 CLI로 직접 전달한다.
[공식 CLI 안내](https://code.claude.com/docs/en/cli-reference)의 daemon 명령은 앞에 주입된 설정 옵션 때문에
다른 경로로 해석될 수 있다. `--resume daemon`과 `-- daemon`은 대화 이름·프롬프트로 유지한다.
인식하지 못하는 옵션 형식도 기존대로 직접 전달한다.

SDK 회귀는 2025-03-26/2025-11-25와 빈·form·form/URL capability를 실제 제품 서버에 전달한다.
가상의 2026-07-28 요청은 SDK가 2025-11-25로 응답하는지 검사한다. 이는 2026-07-28 프로토콜 자체의 구현이나
실제 Claude의 새 협상 성공을 뜻하지 않는다.

## 변경 파일과 검증 결과

| 범위 | 변경 파일 |
| --- | --- |
| 연결 소스 | [session-v2-mcp.mjs](../../../../bridges/claude/src/session-v2-mcp.mjs), [ClaudeAutoConnectCommand.swift](../../../../bridges/claude/swift/service/ClaudeAutoConnectCommand.swift) |
| Node 회귀 | [auto-connect](../../../../Tests/bridges/claude/auto-connect.test.mjs), [cancellation](../../../../Tests/bridges/claude/session-v2-cancellation.test.mjs), [compatibility](../../../../Tests/bridges/claude/session-v2-compatibility.test.mjs) |
| Swift 회귀 소스 | [ClaudeAutoConnectCommandTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeAutoConnectCommandTests.swift) |
| 문서 | 이 문서, [README](../../../../bridges/claude/README.md), [AUTO_CONNECT](AUTO_CONNECT.md), [TASK_STATUS](TASK_STATUS.md) |

| 검사 | 결과 |
| --- | --- |
| `npm test --prefix bridges/claude` | 145/145 통과 |
| `node --test Tests/bridges/claude/integration/product-wire-schema.test.mjs` | 195/195 통과 |
| `npm run check --prefix bridges/claude` | 53개 파일 통과; 추가 실패 회귀 파일도 별도 문법 검사 통과 |
| 변경 범위 diff·문서 로컬 링크 | 통과 |
| Swift 회귀 실행·빌드·설치·실제 모델 | 실행하지 않음 |

초기 Node 실행은 샌드박스의 임시 Unix socket 생성 거부(`listen EPERM`)로 실패했다.
소켓이 허용된 환경에서 같은 검사를 다시 실행해 위 결과를 확인했다. 테스트용 임시 IPC만 사용했다.
로그는 `build/claude-tests/update-20261011/`의 `node-tests-verified.log`, `product-wire.log`, `syntax.log`다.

## 남은 수용

빌드·Swift 테스트·패키징·서명·설치·실제 Claude 실행은 이번 작업에서 하지 않는다.
Swift 관리 명령 회귀는 소스에 추가했으며 실행은 후속 검증이다. native 검사 도구는 현재 2.1.282에 고정되어 있다.
최신 후보 검사에서는 실행 파일·예상 버전·결과 기록을 같은 후보로 맞춘 뒤 [ACCEPTANCE](ACCEPTANCE.md)를 수행한다.
검증된 Stop wrapper 전체 해시와 실제 새 UserPromptSubmit binding은 유지한다.

ACK, 제안 저장, 실제 카드 표시·사용자 클릭, Stop 알림, 단일 claim, 선택 작업 실행, `recorded:true`,
새 입력에 의한 이전 선택 취소를 각각 확인한다. 테스트나 도구 목록만으로 설치 앱의 성공을 보고하지 않는다.
