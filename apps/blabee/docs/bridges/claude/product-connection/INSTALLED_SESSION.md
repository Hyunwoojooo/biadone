# CP-05: 제품용 Claude 실행기와 Hook/MCP 연결

2026-09-20. CP-05 소스와 격리 검증을 위한 연결 경로다. 설치 앱·실행 중인 Claude에
자동 적용하지 않으며 실제 모델, Terminal 조작, 서명된 설치 산출물의 수용 결과는
[작업 상태](TASK_STATUS.md)에 별도로 기록한다.

2026-09-21 추가: 일반 `claude`와 CLI `--resume`/`--continue`의 자동 연결은
[AUTO_CONNECT](AUTO_CONNECT.md)에 정의한다. 아래 기본 경로는 앱 버튼의 fixed-ID 실행이며,
자동 CLI 모드는 첫 실제 SessionStart 이후 등록하는 별도 초기화 경로를 사용한다.

## 실행 경로

`blabee-coordinator claude-installed-launcher`가 앱 소유 공통 서비스의 private owner
socket에 등록하고 새 대화형 Claude 자식을 소유한다. 같은 실행 파일의 진입점을
사용하므로 서비스와 launcher의 코드 서명·빌드 검사를 별도 Node owner로 우회하지 않는다.
`--terminal`은 같은 진입점을 새 macOS Terminal에서 시작하는 경로다. 앱의 버튼은 [CP-06 공통 Pet](PRODUCT_PET.md)에서 연결했다.
Terminal의 셸은 유지해 일시정지와 `fg` 복귀를 지원한다. 실제 자식의 stop을 관측하면
원래 터미널 상태를 복원하고 owner를 일시정지한다. background로 재개했을 때는 터미널을
가져오지 않으며 foreground로 복귀한 뒤 자식의 termios와 실행을 복원한다.

```text
공통 서비스의 private owner socket ← native launcher → Claude Code
                 │                         │              ├─ session-v2-hook.mjs
                 └─ scope/authority         │              └─ session-v2-mcp.mjs
                          ↑                └─ 5분 owner 갱신·자식 종료 관측
                    일반 UDS의 인증된 session-v2 요청
```

일회용 anonymous pipe로 받은 grant와 등록 응답의 authority·lease를 함께 검증한다.
private owner 연결은 Claude에 상속하지 않고, 자식에는 Hook·bridge 역할 자격만 전달한다.
권한 갱신은 기존 `ClaudeOwnerRenewalController`를 사용한다. 서비스 연결 상실은
Blabee 연결을 회수하는 사건이며 이미 실행 중인 Claude의 작업을 취소하는 사건으로 해석하지 않는다.

## 진입점과 설정

공개 진입점은 다음 인자만 받는다. 실제 경로는 CP-06 앱 조립이 공급하며 사용자가
내부 socket·runtime identity를 복사해 입력하는 제품 UX로 만들지 않는다.

| 인자 | 의미 |
| --- | --- |
| `--owner-socket` | 같은 서비스의 private 등록·갱신 socket |
| `--session-socket` | Hook·MCP 요청을 받는 공통 서비스 socket |
| `--runtime-identity` | 기대하는 서비스 빌드 식별자. 등록 권한 자체가 아님 |
| `--cwd` | 새 Claude를 시작할 프로젝트 절대 경로 |
| `--claude-bin`, `--node-bin` | 검증할 실행 파일 절대 경로 |
| `--payload-root` | `src/session-v2-hook.mjs`, `src/session-v2-mcp.mjs`를 포함하는 브릿지 경로 |
| `--configuration-root` | 선택적인 세션 설정 생성 위치 |
| `--terminal` | 이미 열린 TTY에서 실행하는 대신 Terminal 진입점을 사용 |
| `--observe-session` | 첫 실제 SessionStart로 native ID를 확인한 뒤 새 권한 등록 |
| `--` 뒤의 인자 | observe-session 모드에서 Claude에 그대로 전달 |

기본 모드는 임의 Claude 인자 전달을 받지 않는다. 자동 연결 모드는 Claude가 결정한 대화 ID를
사용하며 `--session-id`나 `--fork-session`을 강제로 추가하지 않는다. native trust와 도구 승인을 유지한다.
세션 설정은 Hook 다섯 종(`SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`,
`SessionEnd`)과 MCP만 추가한다. `--strict-mcp-config`로 다른 MCP를 제외하거나
사용자 설정 파일을 쓰지 않는다. 같은 서버 이름 충돌은 시작 전에 진단한다.

Hook은 command/args exec 형식으로 실행하며 실제 native ID·cwd·prompt 관측을 v2
정규화기에 전달한다. 이전 ID나 없는 prompt를 만들어 대체하지 않는다. generated JSON에는
capability 원문 대신 환경 참조만 들어가며 owner·selector 자격을 Hook/MCP에 전달하지 않는다.
MCP는 authority 여섯 값과 socket/runtime/cwd/source를 명시적 환경 참조로 전달한다.
Claude의 MCP 환경 상속 제한이 활성화되어도 필요한 public 값이 사라지지 않게 한다.

## v2 클라이언트와 모델 도구

모델 도구는 `check_connection_v1`, `ack_readiness_probe_v1`, `emit_decision_v1`,
`claim_selection_v1`, `complete_selection_v1` 다섯 개다. `_v1` 이름과 내부
`blabee.claude-session.v2` transport 버전은 독립적이다. 기존 개발 v1 launcher는 그대로다.

| 작업 | 제품 v2 성공 응답의 의미 |
| --- | --- |
| 연결 확인 시작 | `status: "pending"`, `probe_id`, 연속 시각의 `expires_at_nanoseconds`. nonce를 포함하지 않음 |
| Channel ACK | `acknowledged: true`. 작업 완료·세션 lease 갱신이 아님 |
| 제안 | `packet_id`, `revision` |
| 선택 claim | 검증한 `blabee.claude-action.v1`의 action 값. 성공 전 작업 실행 금지 |
| 결과 보고 | 원래 `selection_id`, `recorded: true`, `reported_by: "claude"` |

MCP 결과의 text JSON은 기존과 같이 `{ "ok": true, "result": ... }` 형태다.
내부 연속 시각을 추측한 wall-clock 시간으로 변환하지 않는다.

클라이언트는 private socket 소유권·권한, 메시지 크기·UTF-8·JSON 구조, 외부 runtime/request ID와
내부 role/operation/authority/request ID를 검증한다. 응답 유실·변형 이후 mutation을
자동 재시도하지 않는다. MCP는 초기화 뒤 한 번만 논리 연결을 열고 도구와 poll을
같은 제한된 큐로 직렬화한다. 알림 전송 실패는 연결을 종료하며 ACK나 claim을 만들어내지 않는다.

CP-05는 명시적인 `check_connection_v1` 요청으로 probe를 시작한다. 설계의 **시작 시 최초
probe 1회**는 실제 Hook·MCP 준비를 함께 관측하는 [CP-06 앱/서비스 조립](PRODUCT_PET.md)에서 연결했다. CP-05 단계의 명시적 도구 검증과 구분한다.
현재 MCP 초기화만으로 자동 probe나 ready를 만들었다고 보고하지 않는다.

## Channel 출처와 호환성 범위

현재 제품 진입점은 개발 preview의 `server:blabee-claude` selector와
`blabee-claude` source만 사용한다. 서비스 enrollment allowlist를 임의로 넓히지 않는다.
제품 Hook continuation은 등록된 source, 정확한 전체 wrapper·본문, 현재 일회성 참조가
일치해야 한다. 본문만 복사한 입력, 다른 source, 여러 메시지를 합친 입력은 continuation으로
인정하지 않는다. v1 개발 경로의 기존 fixture 호환은 유지한다.

Plugin selector(`plugin:<plugin>@<marketplace>`)와 실제 Channel source
(`plugin:<plugin>:<server>`)는 다르다. source 바인딩 자체는 별도 fixture로 검증하며,
승인된 plugin 설치·배포 자격을 획득했다는 의미는 아니다. 이 경로의 패키징은 CP-07이다.

현재 후보는 MCP SDK 1.30.0과 자식에만 지정하는 `MCP_PROTOCOL_NEGOTIATION=legacy`를
유지한다. 이는 해당 Claude의 다른 MCP 협상에도 영향을 주므로 다른 실제 MCP와의
호환성은 별도 실사용 검증이 필요하다. CLI 최소 버전 gate는 모든 이후 버전의 수용 증거가 아니다.

근거: [CLI 인자](https://code.claude.com/docs/en/cli-reference),
[설정 병합](https://code.claude.com/docs/en/settings#settings-precedence),
[Hook exec 형식](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form),
[StopFailure](https://code.claude.com/docs/en/hooks#stopfailure),
[Channel preview](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview),
[MCP 협상과 Channels](https://code.claude.com/docs/en/mcp#push-messages-with-channels).

## 검증 명령

`bridges/claude/`에서 `npm run test:installed-session`을 사용한다. 개별 검증은
`npm run test:installed-session -- --source`, `--native`, `--node`, `--production`으로 분리한다.
Swift 실행은 공통 잠금을 사용해 직렬화하고 생성물은 `build/claude-tests/cp05/`에 둔다.
500회 장기 fixture를 이 명령에 포함하지 않는다.

`installed-session-driver.mjs`는 테스트용 Claude 역할을 맡는다. 실제 command Hook과
stdio MCP 자식, private enrollment, 일반 UDS, 공통 registry·SQLite를 사용하지만
모델을 호출하거나 사용자 클릭을 대신한 실사용 성공을 주장하지 않는다. 실제 서비스와
서명 검사를 대신하는 unsigned peer 허용은 test define 안에만 있다.
Hook과 MCP는 native 실행기가 생성한 JSON을 사용하며 MCP는 일반 환경만 상속한 뒤
명시적 환경 참조를 확장한다. 별도 PTY fixture는 테스트 자식의 Ctrl-Z·background·fg·Ctrl-C,
private FD 비상속, 종료 상태와 foreground 복구를 확인한다. Terminal 앱은 열지 않는다.

공통 Pet 조립은 CP-06에 연결했다. 남은 후속: CP-07 불변 payload·서명·설치, CP-08 실제 모델 ACK·선택·결과와
장시간·수면·compact·다중 세션 수용 검증.
