# T-011 운영 어댑터 구현 보고서

상태: **코드 구현과 Keychain 없는 제품 결합 검증 조건부 완료, 실제 사용자 환경 실운영 승인 아님**

검토일: 2026-08-22

## 1. 이번에 구현한 범위

### Codex Plugin

`Plugin/blabee/`에 버전 `0.1.0` Plugin을 구현했다.

- Skill은 완료·부분 완료·실패·차단처럼 다음 선택이 필요한 의미 있는 작업 경계에서만 `emit_decision`을 사용하도록 제한한다.
- 설명, 구조 설명, 상태 확인, 일반 질문과 Codex 네이티브 권한 요청을 반고정 결정 카드로 강제하지 않는다.
- `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest` Hook을 제품 실행 파일에 연결한다.
- MCP는 `blabee-coordinator mcp`의 구조화된 `emit_decision`만 사용한다.
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
- Pet `select`

하나의 `blabee-coordinator daemon`이 UDS를 소유한다. 저수준 append, direct semantic selection과 token consume은 운영 UDS allowlist에 없다.

Pet은 숫자만 보내지 않는다. v1 `blabee_selection_request`의 16개 필드를 모두 제출하며, coordinator는 현재 packet·revision·option과 9-field binding을 byte-exact로 확인한다.

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
→ MCP emit_decision #1
→ Stop(false) 대기
→ Pet get_state + full 16-field select #1
→ Stop block으로 action #1 전달
→ 같은 turn에서 MCP emit_decision #2 staging
→ Stop(true): 경계 #1 transport 완료·close + 경계 #2 활성화·대기
→ Pet get_state + full 16-field select #2
→ Stop block으로 action #2 전달
→ 마지막 Stop(true): 경계 #2 transport 완료·close
```

두 경계는 같은 session·turn·prompt·episode lineage를 유지하고 `boundary_sequence` 1→2로 진행한다. 후속 Stop 완료는 전송 수명 주기 종료일 뿐 작업 성공 증거로 취급하지 않는다.

## 3. 토큰과 로컬 전송 보호

- 사람 프롬프트 correlation token은 지정된 `UserPromptSubmit` `additionalContext`에 한 번 전달하고 MCP proposal의 지정 필드로만 되돌려 받는다.
- exact binding 뒤에는 correlation token을 action·summary 같은 자유 텍스트에 복사한 proposal을 journal write 전에 거부한다.
- 지정된 첫 Hook context를 제외한 MCP·Pet·UDS·Hook 공개 응답과 DB/WAL/SHM에서 correlation token 재노출이 없음을 회귀 검사한다.
- action continuation의 원문 token은 process-local secret corpus에 등록하고 Stop block 응답 전에 `route_consume_pet_action`으로 즉시 한 번 소비한다.
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

- 부모 최종 `npm run test:t011`: **23/23 통과**
- Swift Operational 집중 테스트: **12/12 통과, 최종 동결 소스 3회 연속 재통과**
- Swift Routing 회귀 테스트: **16/16 통과**
- 새 두 경계 제품 결합 gate 단독 반복: **3/3 통과**
- 최신 UDS 종료 집중 6개 × 3회: **18/18 통과**
- 결합 gate 추가 전 UDS 종료 집중 6개 × 5회: **30/30 통과**
- Plugin launcher `sh -n`: 통과
- 실제 Codex CLI `0.149.0`을 사용한 격리 Plugin 설치·cache-buster 업데이트·제거: 통과

테스트는 임시 `0700` 디렉터리, 임시 DB·키·socket·authority root와 test-only in-memory freshness store를 사용했다. 로그인 Keychain과 사용자 Codex 설정은 건드리지 않았다.

Plugin/Skill 제공 Python validator는 검증 로직에 들어가기 전에 로컬 `PyYAML` 부재로 실행되지 않았다. 새 dependency를 설치하지 않았으며, 대신 실제 Codex CLI Plugin lifecycle과 자체 package 계약 검사를 통과시켰다.

Swift 빌드는 통과했지만 기존 `kSecUseAuthenticationUIFail`의 macOS 11 이후 deprecated 경고가 남는다. signed Data Protection Keychain과 `LAContext` 전환은 T-012의 배포 차단 조건이다.

부분 실패 주입은 open/seal, 선택, transport completion/close, scheduler expiry/timeout의 pre-commit 실패와 commit 뒤 응답 유실을 포함한다. open→seal은 journal에서 인접하게 유지하고 최초 seal 시도의 연속 단조 anchor를 재시도에도 보존한다. commit 여부가 모호한 선택은 원문 continuation token을 재발급하지 않은 채 authoritative journal과 재조정하며, authority 조회가 실패하는 동안 250 ms 간격으로 재시도한다. 만료·timeout·close notice는 후속 경계를 잘못 제거하거나 waiter를 고착시키지 않고 exactly-once terminal 상태로 수렴함을 검증했다.

## 5. 아직 남은 실환경 게이트

- 실제 사용자 Codex 설치에서 Hook 해시와 신뢰 화면을 사람이 검토하는 흐름
- 로그인 Keychain을 사용하는 제품 daemon의 실제 사용자 환경 왕복
- 장시간 macOS sleep/복귀와 daemon lifecycle. 현재 waiter·staged proposal·retry marker는 process-local이므로 daemon 재시작 중 완전 복원하지 않는다.
- 네이티브 Pet UI: T-010
- PATH 설치, launchd 자동 시작, `blabee doctor`, Developer ID 서명·공증 DMG, Data Protection Keychain, 터미널 매트릭스: T-012
- 실제 사용자 저장소 롤백: 현재 비활성

로그인 Keychain 제품 daemon 검증은 비밀번호 창을 다시 띄울 수 있으므로 이번 자동 검증에서는 실행하지 않았다. 전체 `npm test`도 기존 Keychain 환경 timeout을 다시 유발할 수 있어 T-011 집중 범위로 제한했다.

## 6. 판정

T-011의 코드와 Keychain 없는 실제 제품 구성요소 결합은 조건부 완료다. 다만 수동 Hook 신뢰와 로그인 Keychain 제품 daemon까지 확인하기 전에는 `AGENT_TASKS.md` 상태를 `in_progress`로 유지한다. 이는 실제 사용자 환경이나 공개 배포 승인이 아니다.

현재 사용자가 추가로 결정할 제품 사항은 없다. 다음 구현 단계는 T-010 네이티브 Pet이며, 그 뒤 T-012 설치·서명·진단·터미널 qualification으로 이어진다.

## 7. 코드 그래프 한계

codebase-memory 프로젝트 `Users-joo-BiaDone`의 Tier 2 generation은 `2026-08-20T14:59:09Z`로 이번 변경보다 오래됐다. T-011 신규 경로는 `not_tracked`, 수정 문서는 일부 `metadata_changed`이므로 그래프 완전성을 완료 근거로 사용하지 않았다. 이 판정은 최신 소스 직접 검토와 실행 결과를 기준으로 한다.
