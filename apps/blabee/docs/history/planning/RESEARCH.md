# Blabee Codex 통합 조사

상태: v0.1 기획 근거 + M0 실증 반영
날짜: 2026-08-20
범위: Codex 우선 macOS MVP. Claude Code는 범위에서 제외한다.

## 핵심 결론

첫 번째 MVP는 **수명 주기 Hook을 사용하는 Codex 플러그인**을 범용 통합 경로로 채택하고, 이후 완전 제어 모드를 위해 **Codex app-server**를 남겨두어야 한다.

- 플러그인 Hook은 Codex 수명 주기 계층에서 동작하므로 Terminal, iTerm, VS Code 터미널, Orca 중 무엇을 사용하든 영향을 받지 않는다.
- `SessionStart`는 모든 저장소의 `AGENTS.md`를 편집하지 않고도 Blabee의 조건부 결정 규칙을 주입할 수 있다.
- `Stop`은 마지막 어시스턴트 메시지를 받을 수 있으며, Pet에서 선택한 뒤 구체적인 계속 사유와 함께 `decision: "block"`을 반환할 수 있다. 로컬 `codex-cli 0.148.0`에서는 새 `UserPromptSubmit`을 만들지 않고 같은 세션·턴을 `stop_hook_active=true`로 계속한다.
- `PermissionRequest`는 지원되는 네이티브 승인 요청의 허용/거부 결정을 중계할 수 있다. 다만 첫 공개 MVP는 이 기능으로 권한을 대신 승인하지 않고, Pet 알림과 원래 Codex 화면으로의 이동만 제공한다.
- 일반적인 `requestUserInput` 중계와 완전한 스레드/턴 제어는 app-server로 처리하는 편이 낫지만, 현재 이 인터페이스는 실험 단계다.

따라서 MVP는 터미널 키 입력 주입, OCR, AppleScript 또는 Blabee 전용 터미널 없이도 일반 `codex` CLI 세션을 지원할 수 있다.

## 확정된 제품 정책

다음 항목은 더 이상 미결정 사항이 아니라 v0.1 설계 기준이다.

### 반고정 결정 카드

결정 카드는 네 슬롯의 **위치 의미만 고정**하고, 실제 다음 작업은 현재 작업 맥락에 맞게 구성한다.

| 슬롯 | 고정 의미 | 패킷별 동적 값 |
|---|---|---|
| `1` | 현재 패킷에서 Blabee가 권장하는 다음 작업 실행 | 표시 라벨, 실제 작업, 실행 프롬프트, 근거 |
| `2` | 현재 패킷의 유효한 대안 작업 실행 | 표시 라벨, 실제 작업, 실행 프롬프트, 장단점 |
| `3` | 현재 체크포인트에서 보류 | 재개 캡슐의 식별자와 요약 |
| `4` | 직전 사람이 입력한 작업 프롬프트 단위 롤백 | 에피소드 시작 프롬프트와 기준 체크포인트 식별자 |

`1`과 `2`는 `계속`, `재설계`처럼 고정된 명령이 아니다. 각 선택지는 표시 번호 외에 안정적인 `option_id`와 전체 의미를 함께 전달해야 하며, Pet은 숫자 하나를 추정해 Codex로 보내면 안 된다. 안전하고 의미 있는 대안이 없으면 `2`를 다른 기능으로 재사용하지 않고 비활성화한다. `3`과 `4`의 의미는 모든 카드에서 고정한다. 재설계가 필요할 때는 `1` 또는 `2`의 구체적인 작업이 될 수 있지만, 슬롯 `2` 자체의 영구 의미는 아니다.

### 직전 프롬프트 기준 롤백

`4`를 선택하면 **현재 작업 에피소드를 연 사람이 직접 입력한 프롬프트가 Codex에 제출되기 직전 상태**로 복원한다. 이 프롬프트로 시작해 현재 결정 카드가 생성될 때까지의 도구 호출, 재시도, 하위 에이전트 작업, Pet의 `1`·`2` 연속 선택 및 파일 변경 전체를 하나의 `prompt-bounded episode`로 취급한다.

- 공개 v0.1은 활성 episode 하나만 롤백한다.
- `source_prompt_id`는 현재 카드를 직접 만든 최신 프롬프트를, `episode_root_prompt_id`는 사람이 입력해 episode를 연 프롬프트를 가리킨다. 롤백 기준점은 프롬프트 텍스트가 아니라 `episode_id`와 `episode_baseline_checkpoint_id`로 식별한다.
- Pet의 `1` 또는 `2` 선택은 안정적인 옵션 ID와 전체 의미를 담은 `same_turn_stop` 전용 연속 진행 지시로 전달된다. 이 지시는 대기 중인 `Stop`을 해제해 같은 턴에서 실행되고 기존 episode와 기준점을 유지한다. 같은 토큰을 `UserPromptSubmit` 경로에서 재사용할 수 없다. 내부 형식 보정은 별도의 `submitted_envelope` 경로이며 같은 결정 경계에서 한 번만 허용한다.
- 사람이 새 작업 프롬프트를 직접 제출할 때만 기존 episode를 닫고 새로운 episode와 기준점을 만든다.
- 공개 v0.1에서는 episode 시작 프롬프트 직전 Git 작업 트리가 깨끗할 때만 롤백을 활성화한다. 이미 변경이 있으면 `1`, `2`, `3`은 사용할 수 있지만 `4`는 비활성화하고 이유를 표시한다.
- 무시 파일, 하위 모듈, Git LFS 객체, 저장소 밖 파일 및 외부 시스템 부작용은 복원 범위에서 제외한다. 해당 episode가 이런 경계를 건드리면 완전 롤백을 약속하지 않고 `4`를 비활성화한다.
- `assume-unchanged`, `skip-worktree`/sparse 상태, `core.filemode=false`, Git이 추적하지 않는 POSIX 모드 변경은 M0에서 복원 가능하다고 주장하지 않고 롤백을 비활성화한다. 저장소 밖 변경과 외부 효과를 포함한 다섯 위험 신호는 `변경 없음`이 명시적으로 입증되지 않으면 `unknown`으로 보고 fail-closed한다.
- 임시 안전 한도는 파일당 16 MiB, 체크포인트당 128 MiB, 프로젝트별 보관량 1 GiB다. 한도를 넘으면 롤백 적용 범위를 부분적이라고 표시하고 `4`를 비활성화한다.
- 실제 복원 직전에는 복구용 스냅샷을 하나 더 만들어 잘못된 롤백에서도 되돌아올 수 있게 한다.

### 통합, 권한, 버전 및 시간 초과

- 제품 경로는 Hook-first로 유지한다. 최종 메시지 센티널은 격리된 일회성 타당성 실험에서만 사용하고, 운영 제안 채널은 플러그인에 번들된 로컬 MCP 도구로 고정한다.
- 공개 v0.1의 네이티브 권한 요청은 Pet에 알림을 표시하고 원래 Codex 화면을 여는 데까지만 지원한다. Pet에서 허용/거부를 대신 전송하는 기능은 포함하지 않는다.
- 내부 알파는 로컬에서 검증된 `codex-cli 0.148.0`에 고정한다. 공개 버전은 검증된 버전 allowlist와 `blabee doctor` 호환성 진단을 사용하고, 매주·새 Codex 버전 감지 시·Blabee 출시 전에 계약 픽스처를 다시 점검한다.
- Stop 대기 중 60초에 알림을 다시 표시하고 120초에 요청을 만료한다. 자동으로 어떤 슬롯도 선택하지 않으며, 재개 캡슐을 저장하고 늦게 입력된 단축키를 거부한다.
- 로컬 코디네이터에 2초 안에 닿지 못하면 Codex 종료를 막지 않고 fail-open한다. 120초 만료 뒤에는 저장한 재개 캡슐을 통한 명시적 재개만 허용하며, 실제 Codex 재개 명령의 형태는 Hook 계약 스파이크에서 검증한다.
- 여러 Codex 세션이 동시에 기다릴 수 있지만 전역 단축키 대상은 화면에서 명시적으로 선택된 전면 카드 하나뿐이다. 새 카드가 기존 대상을 자동으로 빼앗지 않으며 프로젝트·세션 연결이 모호하면 모든 숫자 동작을 끈다.
- `high`·`critical` 위험 작업은 전역 숫자 단축키로 시작하지 않고 펼친 위험 확인을 요구한다. Pet의 작업 확인과 Codex 네이티브 권한 승인은 서로 다른 단계다.
- 프로젝트별 1 GiB 한도에서는 종료된 episode부터 정리하고 활성·보류 기준선, 대기 패킷 참조, 최신 복구 스냅샷을 보호한다. Git 저장소가 아닌 프로젝트에서는 1·2·3만 제공하고 롤백은 비활성화한다.

코디네이터 구현 언어는 제품 의미론과 분리된 증거 기반 선택으로 남긴다. 계약 실험은 TypeScript/Node로 빠르게 수행할 수 있지만, macOS 공개 런타임은 네이티브 Swift 헬퍼를 우선 후보로 두고 시작 시간, 메모리, 서명·공증, 업데이트 복잡도를 측정한 뒤 확정한다.

## 검증된 Codex 사실

### AGENTS.md

Codex는 실행 또는 TUI 세션이 시작될 때 `AGENTS.md`를 한 번 탐색한다. 전역 지침과 프로젝트 지침을 저장소 루트부터 현재 작업 디렉터리까지 병합하며, 현재 위치에 가까운 지침일수록 나중에 적용된다. 병합된 프로젝트 지침의 기본 한도는 32 KiB다.

시사점:

- `AGENTS.md`는 영구 지침이지 런타임 전송 수단이 아니다.
- 이 파일을 편집해도 이미 실행 중인 세션에는 안정적으로 반영되지 않는다.
- 모든 저장소에 큰 Blabee 스키마를 넣으면 컨텍스트를 소모하고 관련 없는 답변에도 영향을 준다.
- 사용한다면 Blabee는 작고, 버전이 명시되며, 되돌릴 수 있는 프로젝트 블록만 삽입해야 한다.

출처: [AGENTS.md를 활용한 사용자 지정 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

### Skill과 플러그인

Skill은 작업별 지침을 묶으며 명시적 또는 암시적으로 활성화할 수 있다. 플러그인은 Skill, 수명 주기 Hook, 번들 MCP 서버 설정을 함께 배포할 수 있다.

시사점:

- Blabee Skill은 결정 제안 규칙과 예시를 두기에 적합하다.
- Skill만으로는 작업 완료를 감지하거나 Pet의 선택을 올바른 활성 턴으로 되돌려 보낼 수 없다.
- 플러그인이 올바른 설치 단위이며, Skill은 그 안에 포함되는 구성 요소다.

출처: [Skill 만들기](https://learn.chatgpt.com/docs/build-skills), [플러그인 패키징](https://developers.openai.com/plugins/build/plugins)

### Hook

Blabee와 관련해 검증된 Hook 기능은 다음과 같다.

| Hook | 유용한 입력/출력 | Blabee 활용 방식 |
|---|---|---|
| `SessionStart` | 추가 개발자 컨텍스트를 반환할 수 있음 | 활성화된 프로젝트에 조건부 결정 규칙 적용 |
| `UserPromptSubmit` | 프롬프트와 턴 ID를 받으며 컨텍스트를 추가할 수 있음 | 턴 시작 전 체크포인트 및 상관관계 토큰 생성 |
| `PreToolUse` | 지원되는 도구 호출을 실행 전에 확인 | 안전 가드 및 최초 변경 시점의 보조 처리 |
| `PostToolUse` | 도구 입력과 응답을 확인 | 근거 및 변경 신호 기록 |
| `PermissionRequest` | 허용, 거부 또는 판단 유예 가능 | v0.1에서는 요청 감지, Pet 알림, 원래 Codex UI 이동에만 사용 |
| `Stop` | 턴 ID와 마지막 어시스턴트 메시지를 받음 | Pet의 선택을 기다린 뒤 같은 세션에서 계속 |

`Stop`을 통한 계속 실행은 MVP의 핵심 원시 기능이다. 사유와 함께 `decision: "block"`을 반환하는 것은 해당 턴을 거부하는 동작이 아니다. `codex-cli 0.148.0`은 그 사유를 같은 턴의 Hook prompt로 추가한 뒤 턴 루프를 계속한다. 이 버전 동작은 장기 고정 API로 가정하지 않고 버전별 계약 테스트로 보호한다.

출처: [Hook](https://learn.chatgpt.com/docs/hooks)

### Codex app-server

app-server는 스레드, 턴, 항목, 스트리밍 이벤트, 승인, Skill 및 구조화된 최종 출력을 위한 JSON-RPC 원시 기능을 제공한다. 또한 `codex --remote`를 통해 원격 공식 Codex TUI를 지원한다.

유용한 기능:

- `thread/start`, `thread/resume`, `thread/list`
- `turn/start`, `turn/steer`, `turn/completed`
- 턴의 최종 어시스턴트 메시지에 적용하는 `outputSchema`
- 명령/파일/권한 승인 요청
- 안정적인 요청 ID와 질문 ID를 제공하는 `item/tool/requestUserInput`
- 불러온 여러 스레드 구독

제약 사항:

- CLI에는 app-server가 실험 기능으로 표시된다.
- WebSocket 전송은 실험 기능이며 지원 대상이 아니라고 문서에 명시되어 있다.
- 독립적으로 실행 중인 임의의 기본 TUI에 수동으로 연결해 서버 요청의 제어권을 넘겨받는 계약은 문서화되어 있지 않다.
- Pet에서 네이티브 질문을 완전히 처리하려면 Blabee가 클라이언트 경로를 소유하거나 프록시해야 할 가능성이 크다.
- `thread/rollback`은 폐기 예정이며 대화 기록만 다룬다. 작업 공간을 롤백하는 기능이 아니다.

출처: [Codex App Server](https://learn.chatgpt.com/docs/app-server)

### 비대화형 구조화 출력

`codex exec --json`은 JSONL 이벤트를 출력하며, `--output-schema`는 최종 응답을 제약한다. 테스트와 일회성 자동화에는 유용하지만 대화형 Pet의 주 전송 경로로는 적합하지 않다.

출처: [비대화형 모드](https://learn.chatgpt.com/docs/non-interactive-mode)

## 통합 선택지

| 선택지 | 장점 | 단점 | MVP 결정 |
|---|---|---|---|
| `AGENTS.md`로 형태를 강제한 모든 최종 답변 파싱 | 빠른 프로토타입 제작 | 침습적이고 확률적이며 정보 제공형 답변에도 영향을 줌 | 주 경로로는 제외 |
| Skill만 사용 | 버전이 명시된 의미론적 워크플로 | 수명 주기나 응답 라우팅 기능 없음 | 의미론적 구성 요소로 사용 |
| 플러그인 + Hook | 터미널에 독립적이며 같은 세션에서 계속 실행 가능 | 일반적인 네이티브 질문 중계가 불완전함 | **MVP 주 경로** |
| app-server 클라이언트/프록시 | 의미론적 이벤트와 요청을 완전히 제어 | 실험 기능이며 관리형 클라이언트 토폴로지가 필요함 | 2단계 / 계약 검증 스파이크 |
| PTY/OCR/AppleScript | 기존 UI를 대상으로 할 수 있음 | 터미널에 종속적이고 취약함 | 핵심 경로에서 제외 |

## 별도 LLM 불필요 결론

MVP의 Blabee에는 자체 OpenAI API 키나 추론 백엔드가 필요하지 않다.

- 기존 Codex 턴이 결정 제안이 필요한지 판단한다.
- 로컬 번들 MCP 도구 또는 구조화된 Hook 계약이 제안을 Blabee로 전달한다.
- Git 근거, 위험 게이트, 체크포인트, 상태 전이, 단축키는 결정론적 로컬 코드로 처리한다.
- Codex가 필수 제안을 빠뜨리거나 형식에 맞지 않게 만들면 Blabee는 같은 Codex 세션에서 최대 한 번만 형식 수정을 위한 계속 실행을 요청할 수 있다.

최종 메시지에 임시 센티널을 넣어 파싱하는 방식은 로컬 MCP 계약을 붙이기 전 왕복 가능성만 확인하는 일회성 실험으로 제한한다. 공개 제품이 센티널 문구나 일반 자연어 파싱에 의존해서는 안 된다.

이 결론이 LLM을 전혀 사용하지 않는다는 의미는 **아니다**. 사용자의 Codex 계정, 할당량 및 속도 제한은 계속 적용된다.

## macOS 배포 근거

제품은 Developer ID로 서명되고 공증된 DMG로 배포하는 네이티브 `.app`이어야 한다. DMG는 전달용 컨테이너일 뿐이며, 실제 런타임 제품은 앱, 로컬 헬퍼, Codex 플러그인으로 구성된다.

- AppKit은 여러 Space와 전체 화면 환경에서 함께 표시될 수 있는 앰비언트 패널을 위해 플로팅 창 레벨과 컬렉션 동작을 제공한다.
- Apple은 macOS 소프트웨어와 UDIF 디스크 이미지 공증을 지원한다.
- Mac App Store로 배포하면 임의의 저장소와 외부 Codex 프로세스를 다룰 때 App Sandbox 제약이 추가되므로, MVP에는 Developer ID를 통한 직접 배포가 더 적합하다.
- Hook/app-server 통합은 핵심 경로에서 화면 스크래핑이나 전역 키보드 감시를 요구하지 않는다. 따라서 화면 기록 또는 손쉬운 사용 권한을 핵심 요구 사항으로 삼지 않아도 된다.

출처: [NSWindow 레벨](https://developer.apple.com/documentation/appkit/nswindow/level-swift.struct), [NSWindow 컬렉션 동작](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct), [macOS 소프트웨어 공증](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)

## 로컬 환경 근거

- 현재 로컬 CLI: `codex-cli 0.148.0`.
- `codex --help`에는 `--remote`, 플러그인 관리 및 Hook 신뢰 제어 기능이 제공된다.
- 이 빌드의 `codex app-server`는 stdio, Unix 소켓 및 WebSocket 전송을 지원한다.
- 내부 알파는 이 버전에 고정한다. 공개 지원 범위는 계약 픽스처를 통과한 allowlist로 관리하고 `blabee doctor`가 설치된 Codex 버전과 Hook/플러그인 기능을 사전 점검한다.

## M0 실증 결과와 설계 수정

2026-08-21 현재 disposable `spikes/m0/` 구현으로 다음을 확인했다.

- `npm test`는 체크포인트 36개, Hook/코디네이터 15개, 런타임 2개로 총 53/53 통과했다.
- 실제 `codex-cli 0.148.0` 임시 Git 프로젝트에서 프로젝트 로컬 `.codex/hooks.json`과 `.codex/config.toml`만으로 `SessionStart → UserPromptSubmit → MCP emit_decision → Stop 대기 → Pet 1번 → 같은 턴 연속 진행 → 후속 Stop 완료`가 성공했다. 마지막 JSONL `agent_message`는 정확히 `M0_CONTINUED`였다.
- 터미널 키 입력 주입과 별도 LLM API 키는 사용하지 않았다. 올바른 프로젝트 trust 전체-table override와 `--dangerously-bypass-hook-trust`는 격리된 harness 전용이며 제품 기본 동작이 아니다.
- Pet 작업의 `same_turn_stop` 토큰과 내부 형식 보정의 `submitted_envelope` 토큰을 상호배타적으로 만들고, 토큰을 제외한 봉투 전체를 봉인해 필드 변조·추가 필드·재사용을 거부했다.
- `continuation_completed`는 정확한 후속 `Stop`을 본 전송 수명 주기 완료이지 일반 작업의 성공 판정이 아니다. 라이브 fixture의 작업 성공은 마지막 JSONL `agent_message`가 정확히 `M0_CONTINUED`인 것으로 별도 확인했다. 120초는 선택 전 패킷 대기에 적용되고, 제출 봉투의 토큰 만료는 내부 형식 보정 경로에서 검증했다. dispatch 이후 작업의 deadline/outcome은 후속 상태 머신 과제다.
- Unix socket은 `0600`으로 제한했다. 다만 활성 소켓 중복 실행 방지, peer 인증, 내구성 원장과 재시작 복구는 운영 런타임 과제다.
- Git 롤백은 `os.tmpdir()` 아래 합성 fixture에서만 실행된다. 실제 사용자 프로젝트에는 연결되지 않았으며 특수 인덱스 상태, 비-Git 모드, 불명확한 외부 효과에서 fail-closed한다.
- Node/Swift/C 단기 벤치마크는 후보 비교 근거일 뿐 운영 런타임을 확정하지 않는다. 또한 M0 상태 머신은 한 턴에서 결정 1회와 연속 진행 1회만 입증했으며, 반복 Pet 결정 사이클은 다음 단계의 sequence/revision 계약이 필요하다.

같은 턴 Stop 동작 근거: [Codex 0.148.0 turn loop](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/core/src/session/turn.rs#L484-L511), [동일 turn ID Hook 테스트](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/core/tests/suite/hooks.rs#L1302-L1405)

## 필수 스파이크

1. 격리된 테스트에서만 임시 최종 메시지 센티널을 사용해 `SessionStart → 결정 제안 → Stop 대기 → Pet 선택 → Stop 계속 실행` 왕복 가능성을 먼저 확인한다.
2. 같은 흐름을 번들 로컬 MCP 제안 도구로 다시 검증하고, `session_id`, `source_turn_id`, `source_prompt_id`, `episode_root_prompt_id`, `episode_id`, `option_id`를 Hook 페이로드와 안정적으로 연결한다. 공개 경로 진입 조건은 이 실험의 통과다.
3. 깨끗한 Git 작업 트리에서 사람이 입력한 프롬프트 제출 직전 `episode_baseline_checkpoint_id`를 만들고, Pet의 1·2 연속 진행까지 포함한 해당 episode 하나를 정확히 복원하는지 검증한다. 사람이 새 프롬프트를 입력했을 때만 다음 episode가 생기는지도 확인한다. 기존 변경, 무시 파일, 하위 모듈, LFS, 저장소 밖 변경, 크기 초과 및 동시 편집에서는 롤백이 비활성화되어야 한다.
4. `PermissionRequest` 감지와 원래 Codex UI 이동이 네이티브 안전 정책을 약화하지 않는지 검증한다. 허용/거부 중계 능력은 후속 단계의 별도 실험으로 남기며 공개 v0.1 UI에는 노출하지 않는다.
5. 코디네이터 2초 연결 제한, 60초 재알림, 120초 만료, 자동 선택 금지, 늦은 단축키 거부, 재개 캡슐 저장과 연결 실패 시 fail-open 동작을 검증한다.
6. 플러그인 설치, Hook 신뢰, 업데이트 및 제거 흐름을 검증한다.
7. `codex-cli 0.148.0` 내부 알파 픽스처를 고정하고, 지원 allowlist의 각 CLI 버전별 프로토콜 픽스처와 `blabee doctor` 실패 메시지를 검증한다.
8. TypeScript/Node 실험 헬퍼, 네이티브 Swift 헬퍼, 소형 독립형 시스템 바이너리의 시작 시간, 유휴 메모리, 배포 크기, 서명·공증 및 업데이트 복잡도를 측정해 공개 코디네이터 런타임을 선택한다.

공개 v0.1 이후의 별도 관리형 모드 스파이크에서는 두 번째 구독자가 app-server 서버 요청을 안전하게 미러링할 수 있는지 확인하고, 불가능하다면 투명한 브로커를 명세한다. 이 검증은 Hook-first MVP의 출시 선행 조건이 아니다.
