# Claude Code에서 Blabee 사용 가능성 조사

조사일: 2026-09-12 · 범위: 공식 문서, 로컬 CLI 정보, 기존 Blabee 소스의 읽기 전용 조사. 소스 근거는 조사 시작 시 커밋 `f0b4144b6315133585feaa81eb5ae4c3f11394e3`을 기준으로 한다.

## 결론

**Claude Code용 Blabee를 만들 수 있는 공식 확장 경로는 있다. 다만 현재 Codex용 플러그인을 복사해서 바로 사용할 수 있는 상태는 아니다.**

Claude Code는 Plugin, Hook, MCP, Skill을 제공한다. 이를 이용하면 세션 상태를 수집하고, 모델이 만든 선택지를 별도 Blabee 프로세스에 전달하는 구조를 구성할 수 있다. [Plugin reference](https://code.claude.com/docs/en/plugins-reference), [Plugin MCP servers](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers)

남은 핵심은 **Pet의 선택을 실행 중인 원래 Claude 세션에 전달하고, 저장된 선택과 연결해 한 번만 실행시키는 왕복**이다. 공식 외부 이벤트 경로는 있지만 현재 Blabee의 Codex queue 계약과 같지는 않다. 따라서 지원 가능성은 높게 판단하되, 실제 연동 성공은 아직 검증하지 않았다.

추천 방향은 `claude/` 안의 Claude 전용 Plugin·입력 변환기·전달기를 먼저 검증하는 것이다. 기존 Pet 전체를 복제하거나 공통 코드를 추출하는 작업은 이 왕복을 확인한 뒤 판단한다.

## 공식 기능과 Blabee 대응

아래에서 “가능”은 공식 기능을 이용한 구현 가능성을 뜻한다. 설치된 Blabee와의 호환성 테스트 결과는 아니다.

| 필요한 기능 | 공식 근거와 제약 | Blabee에 대한 판단 |
| --- | --- | --- |
| 플러그인 배포 | `.claude-plugin/plugin.json`, Hook, Skill, MCP 설정을 묶을 수 있다. | `claude/Plugin/`에 별도 패키지 구성 가능. Codex 설정을 그대로 복사하지 않는다. |
| 세션·입력·완료 감지 | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` Hook이 있다. 공통 입력에는 `session_id`, `cwd`, 그리고 첫 사용자 입력 이후 `prompt_id`가 포함된다. | Claude native ID와 Blabee 내부 ID를 대응시켜야 한다. |
| 구조화된 선택지 제출 | Plugin에서 stdio MCP 서버를 제공할 수 있다. | `emit_decision` 형태의 도구를 Claude에 제공하는 경로가 있다. |
| 모델의 사용 안내 | Skill의 설명과 내용으로 도구 사용을 안내할 수 있다. 자동 호출 여부는 모델이 판단한다. | 매 턴 반드시 제안한다는 보장은 별도 검증 대상이다. |
| Pet 선택의 재입력 | Inbox socket, Channels, Monitor 등 외부 입력 후보가 있다. | 아래 비교와 실제 왕복 검증 후 전달기를 결정한다. |
| 도구 실행 승인 | `PermissionRequest` Hook과 Channels의 permission relay가 있다. | Claude용 승인 요청 식별·검증이 필요하다. 첫 실험에서는 네이티브 승인 화면을 유지한다. |

근거: [Plugins](https://code.claude.com/docs/en/plugins-reference), [Hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers), [Skills](https://code.claude.com/docs/en/skills). 외부 입력 경로의 근거와 제약은 다음 절에 구분했다.

Hook 대응에서 확인한 세부 사항:

- Claude의 `prompt_id`는 v2.1.196부터 제공된다. Blabee가 생성하는 `source_prompt_id`와는 별도 식별자다.
- `UserPromptSubmit`의 `additionalContext`로 현재 Blabee binding과 작업 규칙을 전달할 수 있다. 문맥 주입 자체가 도구 호출 성공을 보장하지는 않는다.
- transcript 기록은 지연될 수 있으므로 완료 시점의 최신 응답은 `Stop.last_assistant_message`를 우선 참고한다.
- `PermissionRequest`에는 `tool_use_id`가 없다. `updatedPermissions`는 지속 권한을 변경할 수 있으므로 일회 승인과 구분한다. Hook의 허용이 일치하는 deny 규칙을 무효화하지 않는다. [Hooks reference](https://code.claude.com/docs/en/hooks)

## Pet에서 원래 세션으로 돌아가는 방법

| 후보 | 확인된 동작 | 채택 판단 |
| --- | --- | --- |
| 세션 Inbox socket | Hook·스크립트가 자기 세션에 게시할 수 있는 socket 주소와 인증 방법이 안내되어 있다. | 일반 `claude` 실행을 유지하려는 목표에 맞는 조사 우선 후보. 메시지 본문 계약과 수신 확인은 미확정. |
| Channels | MCP 서버가 `notifications/claude/channel` 이벤트로 실행 중인 세션에 입력을 보낸다. | 공개된 전송 형식이 있는 대안. Preview 활성화·배포 조건을 수용할 때 우선 실험 가능. |
| Plugin background monitor | 세션 동안 실행되는 프로세스의 stdout 줄을 Claude에 전달한다. | 작은 로컬 실험 후보. 실험적 기능과 실행 환경 제약이 있다. |
| Stop / 비동기 Hook | Stop은 종료를 막아 계속 작업하게 할 수 있고, `asyncRewake`는 유휴 세션을 깨울 수 있다. | 종료 시점 보조 수단. 지연된 Pet 선택을 위한 영속 queue 계약으로 가정하지 않는다. |
| `--resume` | 저장된 대화를 이어서 실행하는 CLI 기능이다. | 이미 실행 중인 같은 프로세스에 입력을 넣는 증거로 사용하지 않는다. |
| Agent SDK streaming input | SDK가 소유하는 실행에 사용자 입력을 공급할 수 있다. | 직접 실행하는 일반 Claude CLI와 운영 구조가 달라지므로 후순위 대안. |

각 후보의 근거와 미확인 사항은 아래와 같다.

### 1. 세션 Inbox socket

Claude Code는 `CLAUDE_CODE_MESSAGING_SOCKET`과 세션별 `CLAUDE_CODE_MESSAGING_TOKEN`을 Hook·Bash에 제공한다. 같은 기기의 메시지는 로컬 socket을 이용한다. 세션이 작업 중이면 도구 호출 사이에 읽고, 유휴 상태면 새 턴을 시작한다. macOS/Linux의 기본 최소 버전은 2.1.224이며, 모든 provider와 feature-flag fetching 비활성 환경의 같은 기기 지원은 2.1.248부터다. [Session inbox / availability](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket)

수신은 `crossSessionInbound`의 accept·hold·refuse 정책을 따른다. 검증된 자기 자식 프로세스에는 기본 정책의 예외가 있지만 외부 Pet을 자동으로 그 자식으로 간주할 수 없다. 수신 메시지는 다른 세션의 문맥으로 취급되며 사용자 동의나 권한 승인, 설정 변경 지시를 대신하지 못한다. [Incoming message controls](https://code.claude.com/docs/en/cross-session-messaging#how-a-session-treats-an-incoming-message)

**미확인:** 조사한 문서에는 socket 주소와 인증 첫 줄은 있지만, 외부 발신자가 사용할 완전한 메시지 본문 schema와 처리 완료 응답 계약은 찾지 못했다. 이 사실만으로 미지원이라고 단정하지도 않는다. Pet 전달기를 구현 가능한 계약으로 확정하려면 이 부분을 먼저 확인해야 한다.

### 2. Channels

stdio MCP 서버가 `claude/channel` capability를 선언하고 `content` 및 선택적인 `meta`로 이벤트를 전송한다. 작업 중 들어온 이벤트는 다음 턴에 묶여 전달될 수 있다. 전송 Promise의 성공은 처리 완료가 아니며, 서버 미로딩이나 정책 차단 시 이벤트가 조용히 버려질 수도 있다. Blabee는 별도의 수신·claim 확인을 두어야 한다. [Channels notification contract](https://code.claude.com/docs/en/channels-reference#notification-format)

Channels는 research preview다. 세션별 활성화가 필요하며 공식·조직 allowlist에 없는 자체 채널은 개발용 로딩 절차를 거친다. 조직 allowlist에 등록된 채널은 일반 `--channels` 경로를 사용할 수 있다. claude.ai 또는 Console API 인증을 지원하고, Team/Enterprise 및 관리되는 Console 조직은 정책 조건을 확인해야 한다. Bedrock·Google Cloud Agent Platform·Foundry에서는 지원하지 않는다. 현재 사용자의 인증 방식과 조직 정책은 조사하지 않았다. [Channels requirements and controls](https://code.claude.com/docs/en/channels)

**승인 연동의 후속 후보:** `claude/channel/permission` capability로 도구 승인 요청을 Pet에 전달하고 현재 호출에 한정한 allow·deny를 반환할 수 있다. 네이티브 승인창과 병렬이며 먼저 도착한 응답이 적용된다. 프로젝트 신뢰·MCP 서버 동의창은 대상이 아니다. 응답은 열린 `request_id`와 결합되며 일반 채팅 메시지는 승인 응답이 아니다. [Permission relay](https://code.claude.com/docs/en/channels-reference#relay-permission-prompts)

Blabee에서는 실제 사용자의 클릭, 대상 session·channel·요청 ID를 함께 검증해야 한다. 명령 미리보기의 생략 가능성과 만료·취소·처리 확인은 실제 실험 과제로 남긴다. 개발용 로딩도 조직의 Channels 차단 정책을 우회하지 않는다. [Relay request fields and preview conditions](https://code.claude.com/docs/en/channels-reference#permission-request-fields)

### 3. Monitor, Hook, SDK

Plugin background monitor는 `monitors/monitors.json` 또는 `experimental.monitors`로 선언하며, 대화형 CLI 전용 실험 기능이다. 플러그인을 비활성화해도 실행 중인 monitor는 세션 종료까지 남는다. 프로젝트의 `.claude/skills/`에서 발견되는 `@skills-dir` 플러그인은 background monitor를 로드하지 않는다. [Plugin background monitors](https://code.claude.com/docs/en/plugins-reference#monitors)

Monitor는 Bedrock·Google Cloud Agent Platform·Foundry, 그리고 `DISABLE_TELEMETRY` 또는 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`가 설정된 환경에서 사용할 수 없다. stdout 전달이 가능하다는 사실만으로 선택별 실행 확인이나 재시작 복구까지 지원한다고 보지는 않는다. [Monitor tool](https://code.claude.com/docs/en/tools-reference#monitor-tool)

일반 비동기 Hook의 결과는 다음 사용자 상호작용까지 기다릴 수 있다. `asyncRewake`와 Stop에는 각각 실행·반복·timeout 제약이 있으므로 무기한 선택 대기로 설계하지 않는다. [Asynchronous hooks](https://code.claude.com/docs/en/hooks)

`--resume`는 대화 재개 기능으로 평가했다. SDK streaming input은 제어하는 프로세스에 입력을 공급하는 별도 아키텍처 후보로만 남긴다. [CLI reference](https://code.claude.com/docs/en/cli-reference), [SDK streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)

## 기존 Blabee 코드에서 확인한 경계

아래 경로는 참고 근거이며 이번 작업의 수정 대상이 아니다. 줄 번호는 조사 시작 시 커밋 기준이다. 조사 도중 병렬 세션의 편집으로 일부 파일이 바뀌었으므로 현재 작업 파일의 줄 번호와는 다를 수 있다.

| 영역 | 확인한 현재 코드 | Claude용으로 필요한 대응 |
| --- | --- | --- |
| Hook 입력 | [CoordinatorOperationalApplication.swift](../../../app/coordination/CoordinatorOperationalApplication.swift) 1161·1292·2863행: `session_id`, `turn_id`, `prompt`, `cwd`를 사용하고 Blabee prompt·episode·correlation을 생성한다. Stop도 같은 turn을 대조한다. | `(provider, native session, native prompt)` 대응을 설계한다. Claude `prompt_id`를 Blabee `source_prompt_id`로 혼동하지 않는다. |
| 제안 MCP | [OperationalCLI.swift](../../../bridges/codex/swift/hooks/OperationalCLI.swift) 386·471행: 6개 binding 필드와 `proposal`만 허용한다. 서버는 최신 binding도 대조한다. | Claude 메타데이터는 입력 변환기에서 처리한다. 기존 wrapper에 임의 필드를 덧붙이지 않는다. |
| 다음 턴 전달 | [CoordinatorNextTurnDispatcher.swift](../../../engine/routing/CoordinatorNextTurnDispatcher.swift) 3행에 인터페이스가 있다. [main.swift](../../../app/entrypoints/main.swift) 846행은 Codex 구현을 단일 주입한다. | Claude 전달기와 그 수신 확인 계약을 별도로 검증한다. |
| Codex queue 의존 | [CodexQueueNextTurnDispatcher.swift](../../../bridges/codex/swift/delivery/CodexQueueNextTurnDispatcher.swift) 269·341행: `codex queue --thread … --message …` 및 정해진 receipt 형식을 검증한다. | CLI 이름만 바꿀 수 없다. Claude 후보별 동작 차이를 반영해야 한다. |
| 선택의 유효성과 중복 방지 | [CoordinatorOperationalApplication.swift](../../../app/coordination/CoordinatorOperationalApplication.swift) 2980·3084·3628·3664행: packet·revision·binding을 검증하고, 선택을 consume한 뒤 continuation ref와 durable claim을 연결한다. | 텍스트 수신만으로 실행을 허용하지 않는다. Claude 이벤트에서 현재 턴과 검증된 저장 action을 연결할 경로가 필요하다. |
| 도구 실행 승인 | 같은 파일 1513·1553행: 허용 키와 Bash 입력을 엄격히 제한한다. [CodexHookApprovalQualification.swift](../../../bridges/codex/swift/hooks/CodexHookApprovalQualification.swift) 110행: Codex 호출 프로세스·서명을 검증한다. | Claude를 Codex로 가장하지 않는다. Claude용 요청 검증을 마련하기 전에는 Pet 승인 기능을 활성화하지 않는다. |
| 패키지·통신 식별자 | [build-macos-app.mjs](../../../scripts/build-macos-app.mjs) 38·69행에 앱·bundle·서비스 이름이 고정되어 있다. [UnixDomainSocketTransport.swift](../../../app/service/UnixDomainSocketTransport.swift) 65·935행은 runtime identity를 검증한다. | 독립 실행이라면 앱 이름뿐 아니라 서비스 label·manifest·통신 상대 검증까지 함께 분리해야 한다. |
| Pet 중복 실행 잠금 | [PetApplication.swift](../../../app/ui/PetApplication.swift) 31·50행: 사용자별 고정 `Library/Application Support/Blabee/runtime/pet/instance-v1.lock`으로 두 번째 Pet 실행을 막으며 HOME override를 사용하지 않는다. | 폴더와 socket만 분리해서 Pet 두 개를 실행할 수는 없다. 별도 실험 UI 또는 Claude용 실행 식별·잠금 설계가 필요하다. |

Plugin 설정도 변환 대상이다. 현재 Codex의 `.codex-plugin`, `PLUGIN_ROOT`, MCP의 `cwd`·`env_vars`를 그대로 옮기지 않는다. Claude의 `${CLAUDE_PLUGIN_ROOT}` 및 플러그인 설치 위치를 기준으로 launcher와 MCP 설정을 구성해야 하며, 캐시에 설치될 패키지가 `../`로 바깥 파일을 참조한다고 가정하지 않는다. [Plugin paths and caching](https://code.claude.com/docs/en/plugins-reference)

## 권장하는 첫 검증

**Pet UI를 이식하기 전에, 분리된 Claude 세션에 선택 한 건이 되돌아오는 최소 왕복을 검증한다.** 아래는 제안이며 이번 조사에서는 실행하지 않았다.

1. **반환 경로 확인:** Inbox의 외부 메시지 계약과 현재 환경의 가용성을 확인한다. 구현 가능한 계약을 확보하지 못하면 공개 schema가 있는 Channels로 실험 범위를 정한다.
2. **최소 왕복:** Claude가 MCP로 제안 한 건을 등록하고, 간단한 선택 UI에서 고른 항목을 같은 세션이 받아 명시적인 claim을 남기는지 확인한다. 첫 작업은 무해한 완료 표식 출력 정도로 제한한다.
3. **정확성:** 유휴·작업 중 전달, 중복 클릭, 오래된 카드, 새 사용자 입력, 두 세션, 재시작을 확인한다. 재시도로 작업을 중복 실행하거나 다른 세션에서 실행하지 않아야 한다.
4. **Pet 및 승인 확대:** 왕복이 확인된 뒤 독립 Pet 실행을 설계한다. 도구 실행 승인은 별도 검증으로 다루고 기본 Claude 권한 판단을 보존한다.

공통 확인 기준:

- 선택 등록, 전송, Claude의 수신·claim, 실제 작업 성공을 각각 구분해 관찰한다.
- 외부 이벤트가 `UserPromptSubmit`을 발생시키는지, 어떤 `prompt_id`가 부여되는지 확인한다. 사용자 입력과 같은 Hook을 거친다고 미리 가정하지 않는다.
- 입력 이벤트에 native prompt ID가 없다면 제공자와 이벤트 ID를 명시한 별도 내부 binding을 설계한다. 존재하지 않는 Claude ID를 만들어 native ID인 것처럼 사용하지 않는다.
- 전달 payload는 검증 대상 ref로 취급하고, 저장된 선택·session·cwd·revision과 대조한 뒤 실행한다. ref만 있고 상세 조건이 없으면 실행하지 않는다.
- 일반 메시지를 네이티브 권한 승인으로 취급하지 않는다. 수신 hold·refuse와 사용자 거부를 존중한다.

## 다른 Codex 세션과의 분리

구현 파일·Plugin·픽스처는 이 `claude/` 안에, 실험 생성물은 `claude/build/` 안에 둔다. 별도 실행 프로세스를 만들 때 socket·DB·키 저장소·Pet lease·앱 및 서비스 식별자를 정해야 한다. 단순 경로 변경으로 기존 서명·통신 검증을 충족한다고 가정하지 않는다.

현재 `claude/`는 일반 하위 폴더이므로 부모 Git checkout의 브랜치를 공유한다. 독립 브랜치에서 커밋할 필요가 생기면 별도 worktree를 사용한다. 이번 조사에서는 브랜치를 전환하지 않았다.

## 조사 증거와 검증 한계

- 로컬 CLI: `/Users/joo/.local/bin/claude`, `claude --version` 결과 **2.1.269 (Claude Code)**. `--help`에서 Plugin·MCP·stream-json·resume 관련 옵션을 확인했다. 버전 요건 충족이 계정·정책·기능 활성화까지 증명하지는 않는다.
- 기준 HEAD: `f0b4144b6315133585feaa81eb5ae4c3f11394e3`. 조사 시작·종료 시 코드 조사자가 같은 HEAD를 확인했다. 최종 확인에서는 병렬 편집으로 작업 파일의 변경을 발견했다. 아래 대표 해시 4개는 해당 커밋의 파일과 일치함을 별도로 확인했다. 실제 구현 전 변경된 소스와 다시 대조해야 한다.
- 그래프 도구의 `list_projects`, `search_graph`, `check_index_coverage`가 모두 `Transport closed`로 실패했다. 현재 generation과 coverage는 확인할 수 없어 위에 명시한 소스를 직접 읽었다. 범위를 제한한 조사이며 전체 코드 감사가 아니다.
- 확인한 것은 공식 문서의 계약, CLI 정보, 현재 소스다. 새 Claude 세션·모델 호출·플러그인 설치·빌드·동작 테스트·실제 Pet 왕복은 실행하지 않았다. 인증·토큰 값과 사용자 설정도 조사하지 않았다.
- 문서 검증: README와 이 문서의 로컬 링크 12개, 코드 블록 구분, 후행 공백과 마지막 개행을 확인했다. Claude 공식 기능은 별도 조사자의 사실 검토를 반영했다. 문서 변경이므로 제품 테스트는 실행하지 않았다.
- 이번 변경은 이 조사 문서와 README의 안내다. 기존 Codex 제품 소스·설치 앱·서비스를 변경하지 않았고, commit·push하지 않았다.

코드 조사자가 기록한 대표 소스 SHA-256:

```text
OperationalCLI.swift
d5b1b41abb01157d7afc2e52259f290013916e988af62e68484b2f115fcb98fb
CoordinatorOperationalApplication.swift
56b1053d1cc99bd8eef19cd7225d2dc4bc9d068a705be24d151c56d040bc2421
CodexQueueNextTurnDispatcher.swift
9e00dd30606a1b939ae006a900a016edf4de3fb589cb454c2378856ef582850c
PetApplication.swift
4acd9099e857ec987411c4f40b7a9f565806896de3e64434a85a2cbf41272504
```
