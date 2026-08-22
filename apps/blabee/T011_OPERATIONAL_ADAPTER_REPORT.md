# T-011 운영 어댑터 구현 보고서

상태: **코드 구현·로컬 사용자 Hook/Keychain/Pet 1차 왕복 조건부 완료, 재시작·sleep·전체 Pet 입력 자격과 공개 배포는 미승인**

검토일: 2026-08-22

## 1. 이번에 구현한 범위

### Codex Plugin

`Plugin/blabee/`에 버전 `0.1.0` Plugin을 구현했다.

- Skill은 완료·부분 완료·실패·차단처럼 다음 선택이 필요한 의미 있는 작업 경계에서만 `emit_decision`을 사용하도록 제한한다.
- 설명, 구조 설명, 상태 확인, 일반 질문과 Codex 네이티브 권한 요청을 반고정 결정 카드로 강제하지 않는다.
- `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest` Hook을 제품 실행 파일에 연결한다.
- MCP는 `blabee-coordinator mcp`의 구조화된 `emit_decision`만 사용한다.
- 현재 Hook의 `source_prompt_id`만 달라진 정확한 오류에서는 같은 proposal·binding·token을 유지한 채 그 필드만 한 번 보정한다. 그 밖의 오류, secret 동반 오류와 두 번째 실패는 재시도하지 않는다.
- Hook에서 제품 실행 파일이나 daemon을 사용할 수 없으면 빈 성공 응답으로 fail-open해 일반 Codex 사용을 막지 않는다.
- 운영 Plugin에는 M0 임시 센티널과 fake coordinator가 없다.

Blabee는 별도 LLM API나 API key를 요구하지 않는다. Codex가 만든 구조화 제안을 로컬 Swift coordinator와 Pet이 전달·표시하는 구조다.

### Swift 운영 application과 UDS

`CoordinatorOperationalApplication`이 기존 SQLite journal, semantic application과 routing/time 계층을 다음 고수준 요청으로 연결한다.

- 프로젝트 활성화
- 세션 시작
- 사람이 제출한 프롬프트 경계 등록
- 결정 제안 접수
- Stop 대기·전달·후속 완료
- PermissionRequest 알림 등록
- Pet `get_state`/`pet_snapshot`
- Pet `focus_interaction`
- Pet `select`

하나의 `blabee-coordinator daemon`이 UDS를 소유한다. 저수준 append, direct semantic selection과 token consume은 운영 UDS allowlist에 없다.

Pet은 14개 exact identity 필드로 현재 `waiting` 전면 카드를 먼저 명시적으로 설정하고, 이어서 v1 `blabee_selection_request`의 16개 필드를 모두 제출한다. coordinator는 현재 packet·revision·option과 9-field binding을 byte-exact로 확인하며 `select` 요청 자체로 전면 카드를 바꾸지 못하게 한다.

반고정 슬롯은 다음과 같다.

1. 패킷별 동적 권장 작업
2. 패킷별 동적 대안 또는 `no_safe_meaningful_alternative` 비활성
3. 보류
4. 롤백 자리지만 현재 빌드에서는 `rollback_not_enabled_in_build`로 비활성

## 2. 실제로 연결해 검증한 두 경계 흐름

Keychain을 사용하지 않는 test-harness에서 실제 제품 Hook/MCP CLI, 실제 `SQLiteJournal → CoordinatorRoutingApplication → CoordinatorOperationalApplication → UnixDomainSocketServer`, Pet UDS API를 다음 순서로 연결했다.

```text
SessionStart
→ UserPromptSubmit
→ proposal 없는 최초 Stop(false): finalization self-check 1회
→ MCP emit_decision #1
→ Stop(true) 대기
→ Pet get_state + 14-field focus + full 16-field select #1
→ Stop block으로 action #1 전달
→ 같은 turn에서 MCP emit_decision #2 staging
→ Stop(true): 경계 #1 transport 완료·close + 경계 #2 활성화·대기
→ Pet get_state + 14-field focus + full 16-field select #2
→ Stop block으로 action #2 전달
→ 마지막 Stop(true): 경계 #2 transport 완료·close
```

두 경계는 같은 session·turn·prompt·episode lineage를 유지하고 `boundary_sequence` 1→2로 진행한다. 후속 Stop 완료는 전송 수명 주기 종료일 뿐 작업 성공 증거로 취급하지 않는다.

최초 Stop까지 proposal이 없으면 코디네이터는 action-type 결과인지 한 번만 다시 확인하도록 상수 `block`을 반환한다. 같은 inactive Stop 재전달에는 byte-identical 응답을 재생하고, 그 뒤에도 proposal 없는 active Stop이 오면 빈 응답으로 fail-open해 루프를 만들지 않는다. self-check 뒤 제출된 경계만 해당 active Stop을 waiter로 받아 Pet 선택을 기다린다. 설명·구조·상태·일반 질문은 self-check 후에도 proposal을 만들지 않는다.

제품 바이너리 통합 시험은 private marker가 든 짧은 assistant 결과로 이 누락 복구를 시작해 1번 선택과 두 경계 완료까지 통과했고, marker와 correlation/continuation token이 공개 출력·DB/WAL/SHM에 남지 않음을 확인했다. Pet은 카드와 in-flight가 없는 연결 상태를 `준비됨`으로 표시하며 실제 `in_flight_count > 0`에서만 `작업 중`을 표시한다. 새 release를 ad-hoc 서명한 `build/local-dogfood-finalization-fix`를 별도 준비했고 source·앱 번들·marketplace의 Skill SHA-256 일치와 `codesign --verify --deep --strict`를 확인했다. 현재 사용자에게 설치돼 실행 중인 이전 dogfood 빌드는 교체하지 않았으므로 Plugin 갱신·프로세스 재시작 뒤 실사용 검증이 필요하다.

## 3. 토큰과 로컬 전송 보호

- 사람 프롬프트 correlation token은 지정된 `UserPromptSubmit` `additionalContext`에 한 번 전달하고 MCP proposal의 지정 필드로만 되돌려 받는다.
- exact binding 뒤에는 correlation token을 action·summary 같은 자유 텍스트에 복사한 proposal을 journal write 전에 거부한다.
- 지정된 첫 Hook context를 제외한 MCP·Pet·UDS·Hook 공개 응답과 DB/WAL/SHM에서 correlation token 재노출이 없음을 회귀 검사한다.
- action continuation의 원문 token은 process-local secret corpus에 등록하고 Stop block 응답 전에 `route_consume_pet_action`으로 즉시 한 번 소비한다.
- 성공적으로 typed validation을 통과한 continuation token도 process-lifetime secret corpus에 등록한다. 유효하지 않은 typed 입력은 등록하지 않으며, 이후 허용 필드에 복사된 token은 SQLite transaction 전에 거부해 DB/WAL/SHM에 들어가지 못하게 한다.
- Stop block reason에는 원문 token 대신 non-secret continuation ID, binding과 봉인 action만 포함한다.
- test-harness token recorder가 발급 원문 token이 DB/WAL/SHM에 없는지 daemon 종료 전에 검사한다.
- Stop 원문 assistant message는 저장하지 않고 process-local HMAC digest와 요청 generation으로 최초 전달, 중복과 후속 완료를 구분한다.

UDS 보안 경계는 다음과 같다.

- runtime directory `0700`, socket과 lease `0600`
- 클라이언트와 서버 모두 같은 effective UID 확인
- 활성 socket 보존, 같은 UID의 stale socket만 회수
- 한 줄 요청 1 MiB 미만, 최대 동시 연결 64개
- 종료 전에 소유한 socket inode만 제거
- 정규화한 절대 DB 경로의 domain-separated SHA-256 identity로 별도 storage authority lease 획득
- 같은 DB·다른 socket의 두 번째 coordinator를 storage 초기화 전에 거부

storage authority는 symlink/hard-link/특수 mount까지 inode 기준으로 canonicalize하지 않는다. 서로 다른 경로 alias가 같은 파일을 가리키는 경우는 후속 보안 범위다.

## 4. 검증 결과

- 부모 최종 `npm run test:t011`: **24/24 통과**
- 전체 Node 회귀 `npm test`: **284/284 통과**
- 전체 Swift package: **Swift Testing 164/164 + XCTest 5/5 통과**
- Swift Operational 집중 테스트: **12/12 통과, 최종 동결 소스 3회 연속 재통과**
- Swift Routing 회귀 테스트: **16/16 통과**
- 새 두 경계 제품 결합 gate 단독 반복: **3/3 통과**
- 최신 UDS 종료 집중 6개 × 3회: **18/18 통과**
- 결합 gate 추가 전 UDS 종료 집중 6개 × 5회: **30/30 통과**
- Plugin launcher `sh -n`: 통과
- 실제 Codex CLI `0.149.0`을 사용한 격리 Plugin 설치·cache-buster 업데이트·제거: 통과
- 로컬 도그푸딩 준비 도구의 앱·자체 marketplace·PATH shim·안전 runbook과 격리 Codex 설치/제거: **4/4 통과**

위 자동 테스트는 임시 `0700` 디렉터리, 임시 DB·키·socket·authority root와 test-only in-memory freshness store를 사용했다. 아래의 별도 로컬 도그푸딩 실행에서는 사용자가 검토한 Plugin/Hook과 제품 primary login Keychain을 실제로 사용했다.

Plugin/Skill 제공 Python validator는 검증 로직에 들어가기 전에 로컬 `PyYAML` 부재로 실행되지 않았다. 새 dependency를 설치하지 않았으며, 대신 실제 Codex CLI Plugin lifecycle과 자체 package 계약 검사를 통과시켰다.

Swift 빌드는 통과했지만 기존 `kSecUseAuthenticationUIFail`의 macOS 11 이후 deprecated 경고가 남는다. signed Data Protection Keychain과 `LAContext` 전환은 T-012의 배포 차단 조건이다.

부분 실패 주입은 open/seal, 선택, transport completion/close, scheduler expiry/timeout의 pre-commit 실패와 commit 뒤 응답 유실을 포함한다. open→seal은 journal에서 인접하게 유지하고 최초 seal 시도의 연속 단조 anchor를 재시도에도 보존한다. commit 여부가 모호한 선택은 원문 continuation token을 재발급하지 않은 채 authoritative journal과 재조정하며, authority 조회가 실패하는 동안 250 ms 간격으로 재시도한다. 만료·timeout·close notice는 후속 경계를 잘못 제거하거나 waiter를 고착시키지 않고 exactly-once terminal 상태로 수렴함을 검증했다.

### 로컬 도그푸딩 준비 도구

`scripts/prepare-local-dogfood.mjs`는 명시한 새 절대 output root 하나에 다음 자료만 준비한다.

- 기존 macOS assembler가 만든 `Blabee.app`
- marketplace root 내부의 `.agents/plugins/marketplace.json`과 자체 `plugins/blabee` 복사본
- MCP의 PATH 검색을 위한 `bin/blabee-coordinator`와 Hook용 `BLABEE_COORDINATOR_BINARY`를 함께 설정하는 `bin/codex-with-blabee`
- exact app binary를 실행하는 `blabee-project-settings`, foreground `blabee-service`, `blabee-pet` wrapper. Codex·service·Pet·project-settings wrapper는 상속된 `BLABEE_SOCKET`을 지워 오래된 개발 socket으로 연결되지 않게 한다.
- preflight → 고유 marketplace 추가 → Plugin 추가 → 절대 프로젝트 활성화 → 전용 터미널 foreground service → 대상 프로젝트 Codex → `/hooks` exact hash 수동 신뢰 → Pet → 대표 프롬프트 순서를 배열로 고정한 `dogfood-summary.json`

준비 도구는 기존 output·symlink·특수 파일을 덮어쓰지 않고 저장소 또는 시스템 임시 디렉터리의 새 자식 경로만 받는다. output의 canonical absolute path SHA-256 앞 12자리로 marketplace 이름을 분리하며, 서로 다른 두 output의 marketplace를 하나의 격리 `CODEX_HOME`에 동시에 추가하고 설치·제거하는 시험을 통과했다. 실제 `CODEX_HOME`, Application Support, `/Applications`, Keychain, launchd를 변경하지 않으며 Plugin 설치·프로젝트 활성화·service·Pet도 실행하지 않는다. Hook 신뢰 우회도 사용하지 않는다.

실패 시 path 기반 recursive cleanup은 하지 않는다. 부분 output과 assembler staging은 검사할 수 있도록 남기며, 사람이 더 이상 프로세스가 사용하지 않는지 확인한 뒤 summary의 exact output root만 직접 정리한다. 이 정책은 inode/fd 기반 안전 삭제를 구현했다는 뜻이 아니다. 정상 실행 뒤 cleanup runbook도 Codex 종료, Pet 종료, service 터미널의 `Ctrl-C`, 같은 절대 프로젝트 비활성화, Plugin 제거, marketplace 제거까지만 안내한다. service를 한 번이라도 실행했다면 Application Support, DB, coordinator key file과 Keychain item은 남을 수 있고 자동 삭제하지 않으므로 완전 롤백으로 간주하지 않는다.

### 실제 사용자 로컬 도그푸딩

최종 로컬 자료 `build/local-dogfood-prompt-retry-v2`를 사용해 다음을 실제 사용자 환경에서 수행했다.

- output hash로 분리한 local marketplace와 `blabee` Plugin을 실제 Codex에 설치하고 이 프로젝트만 활성화했다.
- `/hooks`에서 네 Hook의 정확한 정의와 hash를 각각 검토해 신뢰했다. 신뢰 전체 우회 옵션은 사용하지 않았다.
- foreground 제품 `service`를 primary login Keychain과 실제 Application Support DB·key·UDS로 시작하고, 별도 제품 Pet을 연결했다.
- Codex `0.149.0`에서 MCP 제안 → Stop 대기 → Pet 선택 → 같은 turn continuation → 후속 Stop close 왕복을 두 번 관찰했다. 조사한 두 권장 선택은 각각 DB commit 직전 15 ms와 35 ms에 BLE mouse SenderID의 pointer button-up이 있었다. 물리 입력인지 UI 자동화 입력인지는 단정하지 않지만 `Option+3` 오매핑 증거는 아니다.
- 선택하지 않은 경계가 120초에 `interaction_expired`로 닫히고 늦은 입력을 받지 않는 fail-closed 경로도 관찰했다.

현재 Pet 소스의 기본 `Option+3`은 slot 3이고 격리 Carbon probe에서도 `.slot3`로 전달됐다. 후속 T-010 통제 시험에서는 실제 Codex 제안과 제품 service·Pet을 연결하고, 사용자가 `Option+Space` 무선택 → 카드 클릭 local focus → 포인터를 Pet 밖으로 이동 → 물리 `Option+3`을 수행했다. 불변 저널은 해당 경계에 `decision_selection_claimed(option_pause_*)` 한 건과 `decision_boundary_closed(episode_paused)`를 기록했고 이후 continuation은 0건이었다. 저널 자체에는 입력 장치 필드가 없으므로 물리 입력 판정은 통제된 사용자 수행 보고와 결과 이벤트를 결합한 것이며, 확장 카드 본문 시각 캡처는 T-010에 남긴다.

### Live prompt-only correction qualification

실제 사용자 Plugin·신뢰된 Hook·primary login Keychain foreground service에서 Codex
`0.149.0`에게 첫 `emit_decision`의 `source_prompt_id`만 의도적으로 틀리게 보내고,
전용 오류일 때만 해당 필드를 고쳐 한 번 재시도하도록 지시했다. 파일 변경과 셸 실행은
금지했다.

- 첫 MCP 호출은 `proposal_source_prompt_mismatch`로 실패했고 두 번째 호출 한 번만
  성공했다.
- Codex 세션 기록을 비밀값 없이 감사한 결과 두 요청은 같은 `proposal` 객체와 같은
  project/session/turn/episode/correlation wrapper를 공유했고,
  `only_source_prompt_id_differed=true`, `retried=true`, 두 번째 `accepted=true`였다.
- 시험 전 마지막 journal sequence 36 뒤에는 corrected 제출의
  `decision_boundary_opened` 37과 `decision_packet_sealed` 38만 추가됐다. 실패 호출은
  durable event나 packet document를 만들지 않았고 sealed event 8건과 packet document
  8건의 일대일도 유지됐다.
- corrected 카드는 공개 UDS exact focus 뒤 고정 보류 슬롯 3으로 한 번 닫았다. sequence
  39·40은 단일 `option_pause_*` claim과 `episode_paused`였고 최종 공개 state는
  interactions/pending 0, foreground null, selection disabled였다.
- Codex는 `T011_PROMPT_ONLY_CORRECTED`를 출력하고 exit 0으로 끝났다. 임시 선택
  드라이버와 foreground service는 삭제·종료했다.

따라서 prompt ID 하나의 transcription mismatch만 allowlist된 오류로 노출하고, 같은
proposal·binding·token을 유지한 필드 단독 1회 보정으로 수렴하는 live chain은 통과했다.
secret 또는 다른 binding mismatch의 비재시도는 실제 사용자 secret을 주입하지 않고 자동
계약 증거를 유지한다. Doctor는 app·embedded coordinator·Plugin/MCP·daemon·project
검사를 통과했지만 Codex `0.149.0`은 아직 공개 지원 allowlist에 없다.

### Foreground service 재시작 qualification

신뢰 전체 우회 옵션 없이 실제 사용자 Hook과 primary login Keychain 제품 service를 사용했다.

- 첫 Codex 경계는 저널 sequence 27 `decision_boundary_opened`, 28
  `decision_packet_sealed`까지만 기록된 미선택 pending 상태였다.
- Stop Hook이 대기하는 동안 foreground service를 `Ctrl+C`로 종료했다. 기존 Hook 요청은
  fail-open으로 exit 0 했고 자동 선택이나 continuation을 만들지 않았다.
- 동일 service를 재기동하자 sequence 29가
  `interaction_expired(reason=restart_elapsed_ambiguous, automatic_selection=false)`를
  기록했다. 공개 `get_state`는 interactions 0, routing pending 0, foreground null,
  selection disabled였다.
- 재기동 후 새 Codex 경계 sequence 30·31을 만들고 공개 UDS exact focus 뒤 권장 슬롯 1을
  한 번 선택했다. 응답은 `accepted=true`, `outcome=continuation`이었다.
- 저널 sequence 32~36은 recommended selection → continuation dispatched →
  `same_turn_stop` consumed → transport `completed` →
  `transport_terminal_observed` close 순서였고, Codex는 정확히
  `T011_RESTART_RECOVERED`를 출력했다.
- 최종 공개 상태는 다시 interactions 0, routing pending 0, foreground null,
  selection disabled였다. 임시 UDS 선택 드라이버와 검증 service는 종료·삭제했다.

따라서 process-local foreground·deadline·waiter를 복원하지 않고 persisted ambiguity를
terminal 처리한 뒤 새 세션이 정상 진행되는 제품 재시작 경로는 통과했다. 기존 Codex는
연결 단절 시 결정 대기 문구를 마지막 일반 출력으로 남기므로, 재시작 중 pending Stop의
사용자 안내 UX는 후속 제품 개선 여지로 남는다.

## 5. 아직 남은 실환경 게이트

- 장시간 macOS sleep/복귀. waiter·staged proposal·retry marker는 process-local이며 foreground service 재시작 시 복원하지 않고 fail-closed하는 경로는 통과했다.
- 네이티브 Pet의 확장 카드 본문 시각 캡처, 물리 슬롯 1·2·4와 고위험 확인 경로, 다중 디스플레이·Spaces·키보드 레이아웃, 실제 단축키 충돌과 호스트 앱 복귀 수동 qualification. local focus 뒤 물리 슬롯 3 pause는 통과했다.
- PATH 설치, launchd 자동 시작, `blabee doctor`, Developer ID 서명·공증 DMG, Data Protection Keychain, 터미널 매트릭스: T-012
- 실제 사용자 저장소 롤백: 현재 비활성

이번 로컬 실행은 `/Applications`, launchd, `SMAppService`, System Settings, Developer ID, 공증·DMG를 변경하지 않았다. 설치한 local Plugin과 프로젝트 활성화, Application Support DB·key와 primary login Keychain item은 내부 도그푸딩을 위해 남겨 두며 완전 롤백으로 간주하지 않는다.

## 6. 판정

T-011의 코드, 결정 누락 finalization gate, 준비 도구와 기존 실제 사용자 Plugin/Hook/primary login Keychain/Pet의 same-turn 왕복, foreground service 재시작 fail-closed·새 경계 복구와 live prompt-only correction은 조건부 완료다. T-010의 local focus 뒤 물리 슬롯 3 pause도 통과했다. 다만 새 변경을 포함한 설치본 dogfood, 실제 sleep/복귀와 남은 Pet 시각·환경 자격을 확인하기 전에는 `AGENT_TASKS.md` 상태를 `in_progress`로 유지한다. 이는 공개 배포 승인이나 전체 Codex 버전 지원 판정이 아니다.

현재 사용자가 제품 설계를 추가로 결정할 사항은 없다. 다음 게이트는 준비된 새 dogfood 앱·service·Plugin으로 기존 실행본을 안전하게 교체·재시작하고 실제 Codex에서 `짧은 작업 결과 → Pet 카드 → 1번 → 같은 턴 후속 작업`과 설명형 무카드 종료를 확인하는 것이다. sleep/복귀는 사용자가 실행 시점을 정할 때까지 뒤로 미루며, 공개 DMG·공증·updater도 내부 실사용 뒤로 미룬다.

## 7. 코드 그래프 한계

codebase-memory 프로젝트 `Users-joo-BiaDone`의 Tier 2 generation은 `2026-08-20T14:59:09Z`로 이번 변경보다 오래됐다. T-011 신규 운영·도그푸딩 경로는 `not_tracked`, 수정 문서는 일부 `metadata_changed`이므로 그래프 완전성을 완료 근거로 사용하지 않았다. 이 판정은 최신 소스 직접 검토와 실행 결과를 기준으로 한다.
