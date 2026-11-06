# 실제 Claude Hook·MCP와 공통 엔진 연결

2026-09-18 선택 작업의 연결 규격이다. 공통 `blabee-coordinator` 실행 파일 안에 새 Claude 세션 모드를 추가했다. launcher·Hook·MCP는 Claude용 브릿지이고, 작업 제안·선택·claim·결과 기록은 기존 `CoordinatorSwift`와 SQLite를 사용한다. 기존 개발용 Node 서비스와 공통 Pet 전환을 구분한다.

## 현재 연결 범위

```text
신뢰한 launcher ── 전용 grant 파이프 ── 공통 Coordinator / ClaudeNativeSession
       │                         ↑                ↑
       ├─ Claude Code ─ command Hook ─ hook 자격   │
       │             └ stdio MCP ─── bridge 자격 ─┤
       └─ 사용자 선택 호출자 ───────── selector 자격 ─┘
```

launcher는 새 세션마다 별도 private runtime을 만들며 공통 엔진 실행 파일을 자기 자식으로 실행한다. `--pet`이면 같은 host의 공통 Pet가 selector 역할로 화면·클릭을 연결한다. [공통 Pet 규격](COMMON_PET.md)을 따른다. 설치된 앱·기존 Codex/Claude 세션에는 등록하거나 연결하지 않는다. 하나의 설치 앱에서 여러 provider를 등록·배포하는 작업은 남아 있다.

## 발급·전달·회수

- launcher가 새 scope/session UUID와 서로 다른 32바이트 난수 네 개를 만든다. Hook, MCP bridge, 사용자 selector, owner control 자격은 별개다.
- grant는 상속한 FD 3 파이프로 Coordinator에 한 번 전달한다. 일반 파일·argv·stdout으로 전달하지 않는다. 서버는 pipe/socket 타입, 16 KiB 한도, 5초 수신 기한, schema·cwd·만료를 검사한다.
- FD 4는 owner 수명 감시용이다. owner가 종료되거나 강제 종료돼 파이프가 닫히면 호스트도 종료한다. interactive Claude와 다른 프로세스 그룹이므로 터미널 Ctrl-C가 호스트를 함께 종료하지 않는다.
- Claude 부모 프로세스에는 Hook·MCP 자격만 전달한다. 생성된 MCP 설정은 `${BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN}`을 참조하고 실제 값을 저장하지 않는다. MCP 자식 환경에서 Hook·selector·control 값은 비워 둔다. selector/control은 trusted owner와 grant를 받은 host 메모리에만 남는다. `--pet`의 UI는 host 내부 selector를 사용한다.
- `SessionEnd`, owner의 `session.end`, 만료는 모든 역할을 거부한다. launcher는 Claude 종료 뒤 host를 닫는다. SIGTERM 때는 즉시 권한을 회수하면서 소유한 Claude 자식에 최대 2.5초 종료 시간을 준 뒤 필요하면 강제 종료한다.
- `native-session.used`는 비밀이 없는 일회용 runtime 표식이다. 같은 runtime에서 새 호스트를 시작하거나 이전 grant를 복구하지 않는다. 기본 만료는 1시간이며 자동 연장하지 않는다.

DB/key는 runtime의 `native-storage`, 실행 권한 잠금은 `native-authority` 아래에 둔다. 제품 freshness account는 canonical DB 경로 digest를 포함한 `claude-native-v1-...`로 Codex primary와 분리한다. 인증된 요청으로 저장 경로를 바꾸지 못한다. 테스트 모드만 메모리 freshness를 사용한다.

이 인증은 동일 사용자 아래의 로컬 capability 경계다. Claude 부모가 가진 환경이나 같은 사용자 프로세스를 상대로 native Hook 출처·모델 신원을 증명하는 서명/attestation은 아니다. 자격의 권한 분리와 실제 모델의 올바른 수행 여부를 동일시하지 않는다.

## native 관측과 버전 계약

새 UDS type은 `blabee.runtime-identity.v1/claude_session_v1`이다. payload는 `schema_version=blabee.claude-session.v1`, `provider=claude`, `scope_id`, `session_id`, `role`, `auth_token`, `request`를 요구한다. 내부 request는 `schema_version=1.0`, 새 request UUID, operation과 operation별 필드로 구성된다. 공개 runtime identity만으로 요청할 수 없다.

| 역할 | 허용 범위 |
| --- | --- |
| `hook` | SessionStart / UserPromptSubmit / Stop / SessionEnd 관측 |
| `bridge` | 연결 epoch, poll, probe 시작·ACK, 제안, claim, 완료 보고 |
| `selector` | 기존 snapshot, 별도 버전 `pet.snapshot`, 현재 카드의 사용자 선택, `dismiss_interaction`으로 현재 제안 카드 닫기 |
| `control` | snapshot, 세션 종료 |

이 세션 모드에서는 저수준 `claude_bridge_v1`을 허용하지 않아 readiness나 Hook 경계를 우회할 수 없다. 기존 앱의 [사전 등록 ingress](PRODUCT_INGRESS.md)와 구별한다.

Hook은 stdin의 실제 `session_id`, `cwd`, `prompt_id`를 확인한다. UserPromptSubmit에는 실제 prompt 원문의 SHA256만 전달하며 원문은 저장하지 않는다. 원래 native prompt ID와 내부 boundary/turn ID는 다르다. 공통 엔진용 9개 binding 값은 서버가 만들며 native turn ID가 있었다고 기록하지 않는다. 명시적인 resume/fork, subagent, 다른 cwd/session, 누락된 필수 관측은 지원하지 않는다.

새 실제 사용자 입력은 미claim 선택과 이전 카드를 무효화한다. 이미 claim한 A는 원래 binding으로 완료를 보고할 수 있으며 최신 C/D 카드에는 영향을 주지 않는다. Stop은 선택 시점의 입력과 정지 상태를 확인할 뿐 작업 성공을 만들지 않는다. 종료·재시작 후 이전 claim의 보고 권한은 복원하지 않는다.

같은 native session·canonical cwd·main agent임을 확인한 후 필수 prompt ID/text를 읽지 못하면 Hook 역할로 `ObservationUnavailable`을 전송한다. reason은 `invalid_prompt_id` 또는 `invalid_prompt_text`뿐이며 native ID를 만들지 않는다. 서버는 이전 미claim 카드·readiness를 무효화한다. scope가 다른 입력은 상태를 변경하지 않는다. 세션의 256개 prompt 관측 한도를 넘긴 새 입력도 이전 선택을 먼저 무효화한다.

MCP의 버전 있는 도구는 다음 다섯 개다.

1. `check_connection_v1`: probe ID·기한만 반환한다. nonce는 Channel로만 보낸다.
2. `ack_readiness_probe_v1`: 모델이 받은 probe ID·nonce를 반환해야 한다.
3. `emit_decision_v1`: 최신 boundary, 실제 task_goal·outcome·부수효과·각 선택의 constraints를 모두 요구한다. 빈 제약 배열은 명시할 수 있으나 누락값을 채워 주지 않는다.
4. `claim_selection_v1`: 전달된 참조로 원래 선택 작업을 한 번 확인하고 새 내부 boundary를 반환한다.
5. `complete_selection_v1`: 원래 selection ID로 확인한 결과를 기록한다. 출처는 `model`이다.

모든 client는 응답의 버전·scope·session·role·request ID·runtime identity를 검사한다. 전송 결과가 불명확하면 요청을 자동 재전송하지 않는다. MCP poll과 도구 요청은 같은 FIFO에서 처리한다.

## 연결 확인과 선택 조건

현재 native 구현은 probe 생성 시점부터 5분의 기한을 사용하며, ACK 후에도 같은 만료 시각을 유지한다. ACK 시점부터 5분을 새로 계산하지 않는다. 기존 독립 개발 버전의 30초 probe와 구분한다. 현재 MCP epoch의 heartbeat가 5초 안에 있어야 한다. 새 bridge epoch·연결 종료·heartbeat 만료는 기존 확인을 무효화하며 polling만으로 확인을 복원하지 않는다.

snapshot의 `ready`는 독립 ACK와 현재 연결이 확인됐다는 뜻이다. 실제 선택에는 유효한 카드와 현재 native prompt의 Stop도 필요하다. Channel 쓰기 성공, MCP 연결, claim, 모델 완료 보고는 각각 다른 증거다.

Swift 서버가 만든 Channel 본문을 MCP가 그대로 전달한다. Hook 분류는 그 본문 또는 명시적으로 지원하는 전체 `<channel source="blabee-claude" ...>` wrapper의 정확한 해시만 인정한다. 부분 문자열·trim·유사 메시지로 이전 선택을 보존하지 않는다. probe와 선택의 해시·일회용 참조는 분리하고 새 native prompt ID는 실제 관측으로만 기록한다. 이 wrapper는 자동 테스트에서 검증한 형식이며 모든 실제 Claude 렌더러와의 호환성을 증명하지 않는다.

## 실행과 검증

일반 `claude`로 연 세션에는 이 브릿지가 자동 등록되지 않는다. `tests/` 등 작업 폴더를 고르거나 README를 읽는 동작은 MCP 등록이 아니다. [README의 현재 공통 엔진 실행 안내](../../history/claude/README_PRE_LAYOUT.md)에 이 컴퓨터의 준비된 제품 빌드와 테스트 폴더를 사용하는 명령을 기록했다. `claude:shared`가 전용 host를 시작하며 기존 개발용 `npm run app`/`npm run doctor`는 필요하지 않다. 새 세션의 도구 이름에는 `_v1`이 붙는다.

설치된 앱을 교체하지 않는 자동 검증:

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm run test:shared-engine
npm run test:native-session
npm run test:product-ingress
npm run test:common-pet
```

`test:native-session`은 실제 공통 실행 파일·UDS·SQLite·Hook 자식·stdio MCP SDK를 사용한다. 테스트 define에서만 제공하는 `claude-session-host-test`는 메모리 freshness 저장소를 사용한다. fixture가 모델 역할과 사용자 선택을 수행한다. 제품 Keychain이나 실제 Claude 모델·Pet 클릭을 검증한 것으로 계산하지 않는다. 최종 실행 결과는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)에 별도로 기록한다.

실제 모델을 확인할 다음 단계의 명령은 다음과 같다. `--coordinator-bin`에는 이 변경을 포함한 **테스트 define 없는 공통 제품 빌드**를 명시한다. 이전 설치 바이너리는 새 명령을 지원하지 않을 수 있다.

```sh
npm run claude:shared -- --coordinator-bin /absolute/path/to/blabee-coordinator --cwd /absolute/path/to/test-project
```

위 명령은 화면 없이 연결한다. 끝에 `--pet`을 붙이면 공통 Pet를 열며, 준비된 `npm run claude:live`는 이 플래그를 포함한다. UI 클릭은 같은 host 내부의 selector로 처리하므로 Claude에게 selector 자격을 전달하지 않는다. 숨긴 패널은 메뉴 막대의 `Blabee · Claude`로 다시 연다.

launcher는 Claude Code 2.1.248 이상인 2.x 계열을 검사하고 새 `--session-id`, `--mcp-config`, `--strict-mcp-config`, 세션용 Hook 설정, 개발 Channels를 명시한다. 추가 인수는 `--model`, `--effort`, `--verbose`만 허용한다. native permissions는 바꾸지 않는다. Hook 설정은 기존 설정과 병합되며 조직 정책은 계속 적용된다. [CLI](https://code.claude.com/docs/en/cli-reference), [Hook 규격](https://code.claude.com/docs/en/hooks#command-hook-fields), [관리 MCP 정책](https://code.claude.com/docs/en/managed-mcp#servers-passed-with---mcp-config-or---strict-mcp-config).

현재 Channels preview 호환을 위해 소유한 Claude 자식에만 `MCP_PROTOCOL_NEGOTIATION=legacy`를 설정한다. 전역 환경·설정은 바꾸지 않는다. SDK 의존성도 기존 1.30.0을 유지한다. Channels는 계정·조직에서 허용돼야 하며 개발 서버 승인·도구 권한 승인은 Claude의 화면을 따른다. [MCP client runtime](https://code.claude.com/docs/en/mcp#mcp-client-runtimes), [Channels preview](https://code.claude.com/docs/en/channels#research-preview), [환경 변수 확장](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).

공통 경로의 실제 Claude readiness·제안·A claim·파일 실행·완료 보고는 2026-09-18 확인됐다. 이후 1시간 grant가 만료된 세션에서는 새 launcher가 필요함도 확인했다. 장시간 세션 수명, 설치 앱에 여러 provider 등록, native metadata의 완전한 영속화·복구, C-L02 오류/중단 관측과 패키징은 후속 작업이다. 실제 UI 표시와 모델 실행의 검증 범위는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)를 따른다.
