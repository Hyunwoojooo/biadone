# Claude 브릿지와 독립 검증용 런타임

승인 범위: 독립 앱, Claude Hook·MCP 연결, 선택 반환, 자동 검증. 기존 Codex용 소스·앱·서비스·설정은 변경하지 않는다. 이 문서는 현재 개발용 Claude 구현을 설명한다. 목표 공통 계약의 기준은 [SHARED_ENGINE_PLAN.md](SHARED_ENGINE_PLAN.md)다.

상태 (2026-09-18): 아래 구성과 IPC 계약을 구현했고 실제 Claude Code의 채널 수신·모델 ACK를 확인했다. 선택 전달 뒤의 UserPromptSubmit이 선택을 무효화하던 경로를 수정했으며, 후속 대화형 세션의 Pet A 선택 → 선택한 파일 생성 → 완료 보고를 확인했다. 사용자 클릭·journal·실제 파일 확인과 자동 테스트 결과는 [QA_REPORT.md](QA_REPORT.md)에 구분해 기록한다. 공통 Swift 엔진 통합과 배포 검증은 별도 단계다.

S-01 준비에서 연결 규칙과 실패 검증표를 정리했고, 후속 **C-L01에서는 새 입력 뒤 이전 claimed 작업의 결과 기록을 개발용 Coordinator에 구현**했다. Node Coordinator와 개발용 Pet은 브릿지를 검증하는 상대 구현이며, 최종 공통 Swift 엔진의 연결 계약·인증·durable session 매핑을 완성한 것으로 간주하지 않는다. S-00의 재현 가능한 통합 기준점·소유권 합의와 S-01 전체 완료는 남아 있다. 첫 사용자 흐름은 새 Claude 세션의 제안 → 선택 → 실행 → 결과 표시이며, 승인 중계와 기존 세션 연결은 후속 범위다.

## 구현 구성

2026-09-18 공통화 후속: 사용자가 현재 본체 코드 기준의 통합을 선택했다. 첫 연결 계층과 SQLite fixture에 이어, 실제 공통 Coordinator의 [인증된 Claude 접속 경로](PRODUCT_INGRESS.md)를 추가했다. 어댑터의 단일 소스는 상위 Swift package의 `Sources/ClaudeCoreAdapter/`에 있으며 `shared-engine/` fixture도 이를 참조한다. 아래 개발용 Hook/MCP·Node Coordinator의 대체 런타임으로 자동 활성화되지는 않는다. 사전 등록한 capability 인증과 실제 native Hook 출처·launcher 등록·공통 Pet 전환은 구분한다.

- Swift/AppKit Pet: `src/pet/`, `blabee-claude.app`, 메뉴 막대와 선택 패널. Node coordinator를 자식으로 실행하고 자기 자식만 종료한다.
- Node coordinator: `src/coordinator/`, 전용 UDS와 원자적 JSON journal. 외부 DB 의존성은 추가하지 않는다.
- Claude bridge: `src/bridge/`, 공식 MCP SDK의 stdio Channels와 도구, command Hooks.
- 실행 도구: `scripts/`, 빌드와 기존 설정을 수정하지 않는 Claude 세션 launcher.
- 생성물·테스트 runtime: 모두 `build/` 아래.

## 개발용 Claude IPC 계약 v1

UDS에서 연결당 JSON 한 줄의 요청과 응답을 교환한다. 최대 128 KiB, 연결 timeout 적용. 기본 socket은 `build/runtime/blabee-claude/blabee-claude.sock`이다.

요청: `{protocol:"blabee-claude.v1",provider:"claude",type,auth?,payload:{...}}`.
성공: `{ok:true,result:{...}}`; 실패: `{ok:false,error:{code,message}}`.

- `health`: 인증 없이 제품 식별자와 버전만 반환.
- `session.register`: 새 UUID `session_id`, 절대 `cwd`를 등록. 중복 ID는 거부. 반환 `{session_id,session_token}`. Launcher가 토큰을 자기 Hook/MCP 자식에게만 전달한다.
- `hook`: session token 인증. `{session_id,event,session_id_native,prompt_id?,prompt_sha256?,cwd}`. 이벤트는 `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`. native ID/cwd가 등록과 다르면 거부. `prompt_sha256`은 UserPromptSubmit 원문 전체의 SHA-256이며 원문은 전달하지 않는다. 현재 세션·bridge·boundary·packet에서 발송한 미처리 선택 메시지 전체와 정확히 일치하면 실제 새 native `prompt_id`를 기록하되 선택과 작업 boundary를 유지한다. 그 외 새 입력은 새 `boundary_id`를 발급하고 아직 claim하지 않은 이전 선택을 무효화한다. 이미 claimed 작업은 `selection.superseded`로 기록하고 최신 화면에서 분리하며, 원래 결과를 보고할 자격은 현재 세션 권한 아래에서 보존한다. 반환 `{boundary_id,prompt_id}`.
- `bridge.open`: session token 인증. `{session_id}` → `{bridge_id}`. 서비스가 논리 MCP 등록의 UUID를 발급한다. UDS 요청마다 새 등록을 만들지 않는다. 다른 등록이 열리면 이전 등록과 연결 확인은 만료된다. 아직 claim하지 않은 선택만 무효화하고 이미 시작한 작업이 중단됐다고 기록하지 않는다.
- `bridge.close`: session token 인증. `{session_id,bridge_id}` → `{closed:true}`. 현재 등록의 연결·수신 확인을 닫는다. 이전 등록의 늦은 종료는 새 등록에 영향을 주지 않는다.
- `proposal.emit`: session token 인증. `{session_id,bridge_id,boundary_id,summary,options:[{id,title,description,task,done_when}]}`. 2–4개의 유일한 option, 엄격한 길이·필드·최신 boundary 검증. 서버가 `packet_id`, `revision`을 발급한다. Stop과 채널 수신 확인 이후에만 선택 가능.
- `bridge.poll`: session token 인증. `{session_id,bridge_id}`. 현재 등록의 heartbeat를 갱신한다. 확인 메시지는 `{event:{kind:"readiness_probe",probe_id,nonce,expires_at}}`, 작업 선택은 기존 `{event:{selection_id,delivery_token}}`, 대기 중이면 `{event:null}`을 반환한다. 각 메시지는 한 번만 전달하며 자동 재전송하지 않는다.
- `readiness.begin`: session token 인증. `{session_id,bridge_id}` → `{probe_id,expires_at,status:"awaiting_ack"}`. 사용자 요청으로 새 확인을 시작한다. 응답에는 nonce가 없으며 그 값은 채널 메시지로만 전달한다. 기본 기한은 30초다.
- `readiness.ack`: session token 인증. `{session_id,bridge_id,probe_id,nonce}` → `{ready:true,expires_at}`. 같은 세션·등록에서 이미 발송한 최신 확인의 nonce와 기한을 검증한다. 준비 증거의 기본 유효 기간은 5분이다. `expires_at`은 UTC epoch milliseconds다. 이 요청은 작업 boundary·proposal·selection·claim을 생성하지 않는다.
- `selection.claim`: session token 인증. `{session_id,bridge_id,selection_id,delivery_token}`. 현재 bridge와 최신 session/boundary/packet/선택 여부를 검증하고 한 번만 claim. 반환 `{selection_id,task,done_when,boundary_id,prompt_id}`. 새 내부 boundary를 발급해 후속 제안에 사용하며, 미보고 claim의 원래 작업·선택 binding을 세션별로 별도 보관한다. peer 이벤트의 native prompt ID를 만들지 않는다. 처리 후 응답이 유실돼도 같은 ref의 재요청은 현재 `invalid_selection`으로 거절된다. 이는 현재 개발 구현의 복구 한계이며 공통 목표 계약이 아니다.
- `selection.complete`: session token 인증. `{session_id,bridge_id,selection_id,outcome:"completed"|"failed",note}`. 현재 유효한 세션·논리 bridge와 해당 세션이 실제 claim한 미보고 선택을 검증한다. 새 입력 이후에도 원래 claim의 결과를 기록하며, 현재 selection과 claim boundary까지 일치할 때만 최신 화면·phase를 갱신한다. 과거 작업의 결과는 새 카드·선택·준비 상태를 바꾸지 않는다. 반환은 기존 `{recorded:true,reported_by:"model"}`이고, 모델 보고임을 구분한다. 결과 저장 뒤 미보고 claim을 제거하므로 중복 요청·응답 유실 뒤 재요청은 `invalid_completion`이며 첫 결과를 덮어쓰지 않는다.
- `ui.list`: UI token 인증. 반환 `{sessions:[{session_id,cwd,phase,prompt_id,boundary_id,connected,continuation_ready,packet?,selection?}]}`. `connected`는 heartbeat, `continuation_ready`는 현재 등록에서 확인한 수신 증거와 연결의 유효성이다. packet은 `{packet_id,revision,summary,options}`; selection은 `{selection_id,option_id,status,note?}`. 인증값과 확인 nonce는 UI 목록에 노출하지 않는다.
- `ui.select`: UI token 인증. `{session_id,packet_id,revision,option_id}`. 현재 ready 상태·살아 있는 bridge·유효한 채널 수신 확인을 모두 요구한다. 연결은 살아 있지만 수신 확인이 없으면 `channel_unverified`로 거부한다. 중복·오래된 카드·다른 제품은 거부한다. 세션별 미보고 claim의 상한은 32건이며, 한도에 도달하면 새 선택을 수락하기 전에 거부한다. 결과 기록으로 한 자리를 회수하면 새 선택이 가능하다.

`bridge_id`는 모델 도구 인자가 아니며 MCP 프로세스가 등록 응답에서 받아 주입한다. 이전 등록의 poll·도구 요청·확인·종료는 거부한다. heartbeat가 끊긴 뒤 다시 polling한다고 이전 수신 확인을 되살리지 않는다. nonce와 준비 권한은 파일에 저장하지 않으며 재시작하면 다시 확인해야 한다. nonce를 작업 내용에 반사해 저장하려는 입력도 거부한다. 이 계약은 개발 전용 `blabee-claude.v1`의 조정된 변경으로, 구형 서비스와 새 브릿지 조합은 지원하지 않는다. 상위 `Contracts/v1/`과 Codex wire 형식은 변경하지 않는다.

앱이 생성한 UI token은 coordinator 자식의 `BLABEE_CLAUDE_UI_TOKEN`으로 전달하고 로그나 파일에 쓰지 않는다. session token은 launcher와 MCP/Hook 사이에만 전달한다. 개발 버전의 같은 OS 사용자 내 통신 경계이며 설치 제품의 코드 서명 attestation 완료를 의미하지 않는다. 도구 실행 승인은 Claude 네이티브 화면에 둔다.

C-L01은 도구 요청·응답과 UI 목록의 wire 형식을 바꾸지 않는다. 원래 claim의 작업·완료 기준·binding을 claim/result 감사 이벤트에 함께 기록해, 최신 카드가 교체되거나 앞선 이벤트가 보관 범위를 벗어나도 결과 자체를 원래 작업에 연결할 수 있게 한다. token·nonce·prompt 원문/해시는 보관하지 않는다. 기존 journal의 최근 1,000개 이벤트와 재시작 시 최근 900개 이력 복구 정책을 유지하며, 영구적인 전체 작업 기록이나 과거 작업 목록 UI를 제공하는 것은 아니다. 세션 종료는 결과 작성 권한을 폐기하고, Coordinator 재시작은 미보고 claim 권한을 복원하지 않는다.

## Bridge/launcher 계약

- `src/shared/channel.mjs`: 선택 메시지 본문·notification·`<channel source="blabee-claude" selection_id="…">` 전체 형식을 한 곳에서 만든다. Hook 확인은 trim·부분 문자열 검사가 아닌 전체 SHA-256 일치만 허용한다. 같은 native prompt ID와 같은 형식의 미claim Hook 재시도만 멱등 처리한다. 해시·원문은 UI·journal에 보관하지 않으며 history에는 `prompt_kind`만 기록한다.
- `src/bridge/hook.mjs`: stdin Claude Hook JSON을 받아 IPC로 정규화. `BLABEE_CLAUDE_SESSION_ID`, `BLABEE_CLAUDE_SESSION_TOKEN`, `BLABEE_CLAUDE_RUNTIME` 사용. UserPromptSubmit/SessionStart에서 additionalContext로 boundary 및 도구 지침 전달. 통신 실패는 stderr 진단 후 기존 Claude 작업을 막지 않는다.
- `src/bridge/mcp.mjs`: `emit_decision`, `claim_selection`, `complete_selection`, `check_connection`, `ack_readiness_probe` 도구와 `claude/channel` capability. MCP 초기화 후 논리 등록을 한 번 열며, 등록 전 도구 호출은 거부한다. 선택 이벤트에는 ref만 넣고 저장 task는 claim 도구 응답으로 제공한다. 확인 메시지에는 작업 명령을 넣지 않으며 MCP가 자체 응답하지 않는다. 수신 확인 없는 이벤트를 자동 반복하지 않는다. 종료 도중 늦게 완료된 등록도 닫고 polling을 시작하지 않는다.
- Launcher는 UUID와 신규 등록 token을 발급받아 `claude --session-id UUID --mcp-config GENERATED --settings GENERATED --dangerously-load-development-channels server:blabee-claude`로 새 대화형 세션을 시작한다. 기존 `claude` 바이너리·프로필·권한을 변경하지 않는다. 기본 권한 우회 옵션을 추가하지 않는다.
- session별 설정 파일은 `build/sessions/UUID/` 아래 생성하며 비밀값은 파일에 저장하지 않는다. 사용자가 입력한 cwd를 유지한다. 기존 실행 세션에 사후 부착하는 기능과 resume은 이번 버전에 포함하지 않는다.

선택 continuation 예외는 현재 미처리 delivery의 일회용 token까지 포함한 메시지 일치 확인이다. native 입력의 출처를 인증하거나 Hook 자체로 claim하는 기능이 아니다. Claude 2.1.276에서 관측한 선택 Channel → UserPromptSubmit 순서를 지원하며, 같은 버전의 설치 바이너리에서 Hook에 전체 channel wrapper가 전달되는 기본 경로를 정적으로 확인했다. [공식 Hook 입력](https://code.claude.com/docs/en/hooks)은 channel origin 필드를 보장하지 않는다. 다른 메시지가 합쳐진 입력·형식 변경·재생은 일반 입력으로 처리해 이전 선택을 무효화한다. readiness Channel의 작업 경계 처리는 이번 선택 수정 범위에 포함하지 않는다.

## 구현 책임

- Coordinator 담당: `src/coordinator/`, `tests/coordinator*.test.mjs`.
- Pet 담당: `src/pet/`, Swift 테스트 또는 자체 진단 모드. 앱 실행 파일에 `--runtime ABS --node ABS --service ABS`를 지원한다. bundle 안 `Resources/runtime-config.json`은 `{runtime,node,service}`다.
- Bridge 담당: `src/bridge/`, `Plugin/`, `tests/bridge*.test.mjs`.
- Root: 공유 `src/shared/`, package/scripts, 전체 통합 테스트, 문서·QA.

## 검증

최신 binding·중복 클릭·cross-session·재시작 후 재실행 차단·strict provider 검증을 자동 테스트한다. 실제 child MCP protocol 테스트에서 제안→Stop→선택→채널 이벤트→claim→완료를 검증한다. 앱 build/중복 실행 잠금/IPC 연결을 검증한다. 실제 Claude 계정·Channels 활성화·대화형 승인·모델 동작은 별도 live 증거로 기록하며 자동 protocol 테스트와 구분한다.

## 공통 계약에 연결하기 전 남은 차이

아래는 현재 소스에서 확인한 차이다. 목표 필드·전이·실패 상황의 상세 기준과 S-01-P1~P5 상태는 [공통화 계획](SHARED_ENGINE_PLAN.md)을 따른다. 현재 동작을 확인하는 테스트가 통과해도 목표 동작이 구현됐다는 뜻은 아니다.

| 항목 | 현재 개발 구현과 남은 작업 | 후속 작업 |
| --- | --- | --- |
| 프로젝트·세션·권한 | launcher UUID와 Claude 전용 runtime으로 분리한다. 공통 scope·core session/incarnation registry와 인증된 durable 매핑은 없다. 같은 native ID를 두 provider에서 사용하는 공통 엔진 fixture가 필요하다. | S-01 → S-03 |
| 제안 내용 | Claude의 문자열 `task`·`done_when`을 Swift action에 대응시키는 것만으로 충분하지 않다. Swift가 요구하는 outcome·side effects·constraints의 실제 근거를 받아야 하며 누락 값을 추측해 채우지 않는다. | S-01 → S-04 |
| claim 응답 유실 | Claude는 재요청을 거절한다. Codex의 동일 binding·delivery turn·digest 재요청에 대한 멱등 재응답을 보존하면서 provider별 복구 계약을 정해야 한다. | S-01 |
| 시작한 작업의 결과 | C-L01은 개발용 Coordinator에서 원래 claim의 결과를 별도 기록하고 최신 카드를 보존한다. 기존 Codex queued claim을 직접 연결하는 경로는 closed/open boundary가 맞지 않는다. 첫 공통 계층에서는 public `consume_pet_action` → `complete_transport`로 원래 boundary를 유지하고 결과 뒤 닫는 경로를 검증한다. 실제 provider 전송 의미·영속 감사·앱 통합 계약은 남아 있다. | C-L01 완료 / 첫 core fixture 추가 / full S-01 미완료 |
| native lifecycle | `SessionStart.source`, `SessionEnd.reason`, background 상태를 버리고 `StopFailure`는 받지 않는다. Stop이 없는 중단·오류와 관측하지 못한 상태를 구분해야 한다. | C-L02 |
| Channel과 Hook | 현재 선택 메시지 전체와 정확히 일치하는 continuation만 지원한다. readiness 메시지가 작업 Hook을 유발하는 경우, 여러 메시지의 batch, 다른 native prompt 순서는 추가 계약·fixture가 필요하다. | C-L03 / S-01 |
| 재시작·공통 화면 | Claude 재시작은 history만 보존하고 권한을 복원하지 않는다. Codex의 기존 durable queue 복구와 legacy Pet v1 형식을 보존하며 새 공통 계약을 검증해야 한다. | S-01 → S-03 / S-05 |

사용자는 **공통 엔진 연결을 먼저 진행**하도록 순서를 정했다. C-L02의 오류·중단·background 관측과 C-L03은 후속 범위로 유지한다. C-L01의 결과 기록은 과거 실행 권한을 되살리거나 이미 폐기된 세션의 보고를 허용하지 않는다. 자동 검증과 실제 Claude 모델에서의 확인 범위는 QA 기록을 따른다.
