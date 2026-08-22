# Blabee 작업 현황

업데이트: 2026-08-22

## 현재 단계

M0 연동 계약과 T-006 런타임 독립 v1 계약을 확정한 뒤 T-005 런타임 선택, T-007a 참조 코어, T-007b-A/A2 Swift 영속·freshness 커널, T-007b-B1 의미 application, T-007b-B2 routing/time 계층과 T-007b-C 같은 턴 반복 게이트까지 구현했다. T-011은 Codex Plugin의 Skill·4개 Hook·MCP, Swift 고수준 operational application, Pet state/full-selection API, 단일 UDS/storage owner와 비침습 로컬 도그푸딩 준비 도구를 구현했다. 이 도구로 실제 사용자 Codex에 Plugin을 설치하고 프로젝트를 활성화했으며, 네 Hook을 각각 신뢰한 primary login Keychain 제품 service·Pet에서 같은-turn continuation 두 번과 선택 없는 만료를 관찰했다. T-010은 이 API에 연결되는 비활성 floating `NSPanel`, 다중 세션 foreground, 반고정 결정 카드, 안전 범위의 단축키 설정 UI·동적 label, 위험 확인과 PermissionRequest 알림을 구현했다. 실제 WindowServer 1차 qualification에서 비활성 포커스, Picker·저장/재시작, 실제 Carbon 충돌, frame 왕복, 14-field focus와 16-field select까지 통과했고 실제 연속 시계의 60초 reminder·120초 expiry와 늦은 UDS 입력 거부도 통과했다. 후속 실제 도그푸딩에서는 `Option+Space` 무선택, 카드 클릭 local focus, 포인터를 Pet 밖에 둔 물리 `Option+3`을 연속 수행했고 저널이 단일 pause claim과 `episode_paused`, continuation 0건을 기록했다. 이어 실제 foreground service를 pending 경계 중 재시작해 기존 카드를 자동 선택 없이 `restart_elapsed_ambiguous`로 폐기하고 공개 상태를 비웠으며, 재기동 후 새 경계는 `T011_RESTART_RECOVERED` same-turn continuation과 terminal close까지 통과했다. 실제 prompt-only correction도 첫 prompt ID 단독 mismatch를 저널 쓰기 전에 거부하고 동일 proposal·나머지 binding의 prompt ID만 고친 한 번의 재시도를 수락했으며 corrected 경계는 pause로 닫혔다. T-012a는 앱·Codex·Plugin/MCP/Hook·daemon·프로젝트 범위를 변경 없이 검사하는 `blabee-coordinator doctor`와 순수 `doctor_status`를 구현했다. T-012b-1은 단일 실행 파일과 exact Contracts/Plugin을 담은 로컬 `Blabee.app` 조립, 정확한 앱 무인자 실행의 Pet 진입, entitlement 없는 ad-hoc Hardened Runtime 검증을 추가했다. T-012b-2는 exact 번들·Application Support 고정 경로를 사용하는 제품 `service`, strict 프로젝트 설정 ingress와 등록 전 정적 LaunchAgent 계약을 추가했다. T-012b-3a는 exact 앱 전용 프로젝트 enable/disable 명령, 원자 `service.json` writer와 reader의 ancestor symlink hardening을 추가했다. T-012b-3b는 Pet 프로젝트 온보딩 UI와 수동적 상태 조회, 명시적 버튼 전용 `SMAppService` 등록·해제 어댑터 계약을 연결했다. T-010은 확장 카드 시각 캡처·다중 디스플레이·Spaces·키보드 레이아웃·sleep·호스트 앱 매트릭스, T-011은 실제 sleep/복귀, T-012는 실제 `SMAppService`·signed Keychain·Developer ID·공증·DMG와 터미널 매트릭스가 남아 각각 `in_progress`다. 실제 사용자 저장소 롤백도 아직 구현하지 않았다.

## M0 및 M1 검증 결과

| 범위 | 결과 | 증거 |
|---|---|---|
| 전체 자동 테스트 | 통과 | 실제 UDS·test-only Keychain을 포함한 최신 `npm test` 284/284 통과. 전체 Swift도 Swift Testing 164/164+XCTest 5/5 통과. 유효한 continuation token을 process-lifetime secret corpus에 등록하지 않던 결함은 WAL 유출 회귀로 재현한 뒤 수정했고, 유효하지 않은 typed 입력은 corpus를 오염시키지 않는 검사까지 추가했다. 이전 Keychain timeout은 최신 전체 실행에서 재현되지 않음 |
| v1 계약 패키지 | 완료 | 스키마 10개, Fixture JSON 33개, 계약 테스트 114/114 통과 |
| Hook/코디네이터 | 조건부 완료 | Hook 집중 17/17과 M0 전체 55/55 통과. 실패 진단의 원문 correlation/continuation token도 가린다. 실제 Codex CLI `0.149.0`에서 결정 두 사이클과 `M0_CONTINUED_TWICE`를 확인했지만 지원 버전 승인은 아님 |
| 체크포인트/복원 | 임시 픽스처 검증 완료 | 운영체제 임시 디렉터리 아래 합성 Git 저장소에서 36개 테스트 통과 |
| 런타임 비교 | 완료, Swift 선택 | Node·Swift 공통 NDJSON 계약과 복구·부하·진단·ad-hoc 서명·측정용 DMG를 비교해 Swift를 제품 런타임으로 선택. Node는 참조, C는 정식 JSON 파서가 없는 health 기준선 |
| T-007a 참조 코어 | 완료 | 순수 reducer/replay, CAS 선택 선점, sealed packet document·verification sidecar, prototype-key 안전 projection, command/replay 동등성, 같은 턴 lineage·패킷 의미 검증과 NFC 식별자 규칙 포함 33/33 통과. `InMemoryJournal`은 참조 전용 |
| T-007b-A/A2 제품 영속 커널 | 조건부 완료 | A/A2 기준 Swift unit 27/27, Node persistence 통합 40/40 통과. SQLite/CAS/MAC/HMAC과 Keychain freshness를 제공하며 제품 호출은 B1 의미와 B2 routing/time 경계를 거쳐야 한다. 공개 dispatch는 T-011 운영 adapter 전까지 차단 |
| T-007b-B1 Swift 의미 application | 조건부 완료 | 12개 이벤트와 11개 command, exact RFC3339 ns, exact/범위 제한 정수 transport, NFC 저장 ID와 byte-exact 참조, CAS/token/effect 경계, 제품 `execute_command`, raw append compile-time 차단을 구현. Swift 전체 45/45와 제품 gate 1/1 통과 |
| T-007b-B2 Swift routing/time | 조건부 완료 | 세션별 pending 하나, 다중 세션 queue, 명시적 foreground/no-steal, exact binding selection, continuous clock reminder/expiry/timeout을 구현. Pet·형식 보정 토큰의 고정 120초 소비 권위와 transport 완료 시각도 외부 wall 입력 대신 연속 단조 시각으로 강제하며 restart ambiguity를 fail-closed한다. T-007b-B2 완료 당시 Swift package 전체 62/62와 제품 gate 통과 |
| T-007b-C 같은 턴 반복 | 조건부 완료 | `0.149.0` 실제 Hook+M0에서 경계 1→2와 결정 두 사이클, Swift 제품 게이트에서 같은 lineage의 16개 이벤트 persist/replay를 각각 통과. 실제 Hook→Swift 운영 연결은 T-011 |
| T-011 운영 어댑터와 Plugin | 구현·제품 결합·실제 사용자 왕복·재시작·live prompt 보정 조건부 완료 | `npm run test:t011` 24/24, Swift Operational/UDS/prompt-only correction 회귀 통과. 작업형 결과가 proposal 없이 끝나면 최초 inactive Stop이 한 번만 finalization self-check를 요청하고, 생성된 경계를 다음 active Stop의 Pet waiter로 연결한다. 실제 제품 Hook→MCP→Pet 통합 시험은 이 누락 복구 뒤 두 경계를 완료하고 assistant 원문 marker와 correlation/continuation token 비노출을 확인했다. Pet의 빈 연결 상태는 `준비됨`, 실제 in-flight만 `작업 중`이다. ad-hoc 서명된 새 번들은 `build/local-dogfood-finalization-fix`에 준비했고 source/앱/marketplace Skill hash와 strict codesign을 확인했다. 기존 실행본은 교체하지 않았다. 새 설치본 dogfood와 sleep, launchd·SMAppService·공개 배포는 미검증 |
| T-010 네이티브 macOS Pet | 실제 macOS 1차·deadline·물리 pause qualification 조건부 완료 | Pet 35/35, Operational 14/14, Routing 필터 18/18(Routing 16 + Pet 2), Swift package XCTest 5/5 + Swift Testing 106/106 통과. 격리된 실제 WindowServer에서 호스트 active/key/focus 유지와 입력 연속성, Picker·저장/재시작·Carbon 충돌·frame·14-field focus·16-field select, 실제 60/120초 deadline을 확인했다. 실제 도그푸딩의 통제 시험에서 `Option+Space` 무선택과 local Pet focus 뒤 포인터 밖 물리 `Option+3`을 수행했고, 저널 sequence 25·26이 단일 `option_pause_*` claim과 `episode_paused`를 기록했으며 뒤 continuation은 0건이었다. 입력 장치는 통제된 사용자 수행 보고, 결과는 불변 저널을 근거로 한다. 확장 카드 시각 캡처와 다중 디스플레이·Spaces·키보드 레이아웃·sleep·Terminal/VS Code/Orca 복귀는 남음 |
| T-012a 읽기 전용 Doctor 기반 | 구현·자동 계약 검증 완료, 공개 배포 미승인 | `doctor_status`는 일반 operational 경로와 journal/time 변경을 우회한다. Doctor 18/18, Operational 15/15, T-011 24/24, v1 계약 114/114가 통과했다. 로컬 도그푸딩에서는 app·embedded coordinator·Plugin/MCP·daemon·project 검사가 통과했고 Codex `0.149.0` allowlist와 Hook 신뢰의 기계적 판정은 의도대로 남았다. signed Keychain·DMG·공증·터미널 매트릭스와 path/process-group hardening은 미완료 |
| T-012b-1 로컬 앱 번들 기반 | 로컬 조립·ad-hoc 자격 완료, 공개 배포 미승인 | `Blabee.app`에 고정 plist, 단일 release 실행 파일, exact Contracts/Plugin과 assembly manifest를 포함한다. 패키징 5/5, Swift Pet/Doctor/진입 55/55, T-011 24/24, 계약 114/114가 통과했다. 실제 번들은 `adhoc,runtime`과 deep/strict 검증을 통과했고 Info.plist 변조 후 서명 검증은 실패했다. 로컬 dogfood는 output root에서만 실행했으며 `/Applications`, launchd, Developer ID, 공증, DMG는 건드리지 않음 |
| T-012b-2 제품 service·정적 LaunchAgent | foreground 제품 자격 완료, 자동 시작 미승인 | `service`는 exact app/Resources/real Contracts와 Application Support 고정 경로만 사용하고 추가 인자·환경 경로 우회를 거부한다. strict `service.json`과 정적 LaunchAgent exact 네 키를 구현했다. Product 10/10, 패키징 7/7, T-011 24/24와 ad-hoc strict 서명 계약이 통과했다. 후속 dogfood에서 foreground service와 primary login Keychain은 실행했지만 SMAppService·launchctl·자동 시작은 실행하지 않음 |
| T-012b-3a 프로젝트 설정 writer | 안전한 설정 변경 계약 자격 완료, 제품 UI·자동 시작 미승인 | exact 앱 전용 `project-settings`, current-user 0700/0600·single-link 경계, mutex+flock, strict locked RMW, file/directory fsync와 atomic rename을 구현했다. reader도 Application Support ancestor symlink를 거부한다. Writer 12/12, fresh reader+writer 23/23, Swift Pet 78/78, 이 단계 완료 당시 전체 Swift Testing 150/150+XCTest 5/5, release build와 패키징 7/7 통과. 후속 dogfood에서 foreground service와 primary login Keychain을 실행했지만 SMAppService·launchctl·자동 시작은 실행하지 않음 |
| T-012b-3b Pet 온보딩 UI·서비스 상태 계약 | UI·fake adapter 자격 완료, 실제 자동 시작 미승인 | 수동 상태/설정 조회, 명시적 버튼 전용 등록·해제·System Settings·프로젝트 변경, single-flight와 configured/active 분리를 구현했다. Onboarding 10/10, Pet 88/88, 최신 전체 Swift Testing 161/161+XCTest 5/5, T-011 24/24, 패키징 7/7, 계약 114/114가 통과했다. 후속 dogfood에서 Application Support와 primary Keychain을 사용했지만 실제 SMAppService·System Settings 변경은 하지 않음 |
| 프로젝트 로컬 MCP 검색 | 완료 | 직접 MCP `-c` 주입 없이 임시 프로젝트 `.codex/config.toml`만으로 전체 왕복 통과 |
| 설명 전용 음성 계약 | 완료 | 결정 제안·대기 0건, 파일 변경 없음, 마지막 메시지 `M0_EXPLAINED` |
| 플러그인 구조 | 실제 로컬 설치·신뢰 조건부 완료 | 실제 Codex CLI `0.149.0`의 격리 lifecycle과 실제 사용자 marketplace/Plugin 설치를 통과했다. 네 Hook은 `/hooks`에서 각각 검토·신뢰했다. 제공 Python validator는 PyYAML 부재로 실행하지 않았고 공개 배포 신뢰 UX는 별도 |
| PermissionRequest 제품 동작 | 부분 완료 | Pet은 새 요청 수를 알리고 Allow/Deny 없이 알림 증가를 polling한 시점의 frontmost 외부 앱으로 돌아가는 best-effort 코드와 회귀 검사를 갖췄다. 요청에 원래 PID/창 identity가 없어 정확한 Codex 창 복귀와 Terminal/VS Code/Orca 실환경 UX는 미검증 |

실제 계약 픽스처에서 관찰한 순서는 다음과 같다.

```text
project_enabled
→ session_started
→ human_episode_started
→ [decision_proposal_received
   → decision_wait_started
   → pet_action_selected
   → continuation_dispatched
   → continuation_consumed
   → continuation_completed] × 2
```

Blabee는 Pet 선택을 사람이 제출한 `UserPromptSubmit`으로 보내지 않는다. Codex 공식 문서상 Stop Hook의 `reason`은 모델에게 새 사용자 프롬프트처럼 작동하는 continuation prompt다. `0.149.0` 격리 계약에서는 별도의 사람이 제출한 `UserPromptSubmit` 없이 같은 session·turn lineage가 유지되고 후속 Stop의 `stop_hook_active`가 `true`로 재진입했다. Blabee는 각 경계의 전체 바인딩을 검증하고 전송 수명 주기 종료를 정확히 한 번 관찰하지만, 이를 작업 성공으로 간주하지 않는다.

실제 반복 계약 출력은 `mcp_config_source = project_config_only`, `decision_cycle_count = 2`, `final_assistant_message = M0_CONTINUED_TWICE`, `terminal_input_injection = false`, `separate_llm_api_key = false`였다.

`--explanation-only` 음성 계약에서는 `project_enabled`, `session_started`, `human_episode_started`만 관찰했고 `decision_proposal_received = 0`, `decision_wait_started = 0`, `result.txt` 없음, `final_assistant_message = M0_EXPLAINED`를 확인했다.

## 확정된 제품 결정

1. 결정 카드는 반고정 구조다. `1`은 패킷별 권장 작업, `2`는 패킷별 대안 작업 또는 비활성, `3`은 보류, `4`는 사람이 입력한 직전 작업 프롬프트 직전으로 롤백이다.
2. 1·2 선택은 숫자만 전달하지 않는다. 코디네이터가 봉인된 패킷에서 작업의 제목·목표·제약·완료 기준 전체를 다시 읽고, Codex `0.148.0`에서는 대기 중인 `Stop`을 통해 같은 세션·턴·에피소드에 전달한다.
3. 사람이 새 작업 프롬프트를 직접 제출할 때만 새 에피소드와 롤백 기준선을 만든다. Pet 연속 진행과 Hook 내부 재시도는 같은 에피소드에 남는다.
4. 공개 v0.1 자동 롤백 후보는 깨끗한 작업 트리에서 시작하고 범위가 완전한 프롬프트 에피소드 하나다. ignored 파일, 하위 모듈, LFS, 저장소 밖 파일, 크기 초과, 동시 편집, 브랜치·HEAD 변경, 외부 부수 효과가 있으면 비활성화한다.
5. 센티널은 격리된 M0 smoke test에만 사용한다. 운영 결정 제안 채널은 프로젝트 로컬 MCP `emit_decision`이다.
6. 공개 v0.1의 네이티브 권한 요청은 Pet 알림과 권한 요청 화면으로 돌아가기 위한 best-effort 앱 복귀만 제공한다. 요청에 원래 PID/창 identity가 없으며 Pet은 허용·거부를 대신 전송하지 않는다.
7. 알파 기준은 Codex `0.148.0`이다. Hook/MCP 기능뿐 아니라 같은 턴 Stop 전이를 버전별 계약 테스트로 확인한 뒤 지원 허용 목록에 넣는다.
8. 로컬 코디네이터 연결은 2초로 제한하고 실패하면 일반 Codex를 막지 않는다. 60초에 한 번 알리고 120초에 자동 선택 없이 만료하며 늦은 입력을 거부한다.
9. 여러 세션의 패킷은 대기열에 둘 수 있지만 전역 단축키는 사용자가 명시적으로 선택한 전면 카드 하나에만 적용한다.
10. Blabee는 별도 LLM API 키나 추론 서비스를 요구하지 않는다.

## 작업 상태

- 완료: T-001, T-002, T-003, T-005, T-006, T-007
- M0 합성 픽스처 검증 완료: T-008. 실제 사용자 작업공간 연결은 아직 하지 않았다.
- 진행 중: T-004, T-010, T-011, T-012. T-010은 실제 macOS 1차·deadline·local focus 뒤 물리 pause qualification까지 통과했으며 확장 카드 시각 캡처·디스플레이·Space·키보드 레이아웃·sleep·호스트 앱 매트릭스가 남았다. T-011은 실제 Plugin/개별 Hook 신뢰/primary login Keychain/Pet 왕복, foreground service 재시작 fail-closed·새 경계 복구와 live prompt-only correction까지 통과했고 실제 sleep/복귀가 남았다. T-012는 실제 LaunchAgent 등록/승인·signed Keychain·DMG·공증·버전 allowlist·터미널 매트릭스가 남았다.
- 대기: T-009, T-013, T-014.

## 다음 작업

1. 준비된 `build/local-dogfood-finalization-fix`의 marketplace/Plugin으로 기존 dogfood 실행본을 안전하게 교체·재시작한 뒤, 사용자가 재현한 `짧은 작업 결과 → Pet 4개 선택지 → 1번 → 같은 턴 후속 작업`을 실제 Codex에서 확인한다. 설명·상태 질문은 카드 없이 끝나고 빈 Pet은 `준비됨`인지 함께 확인한다.
2. 사용자가 실행 시점을 정하면 T-011/T-010 공통 실제 sleep/복귀 게이트를 수행한다. 대기 카드가 있는 상태와 없는 상태를 나눠 continuous deadline, foreground service 생존·재연결, 늦은 선택 거부와 새 경계 왕복을 확인한다.
3. T-010의 확장 카드 시각 캡처와 다중 디스플레이·Spaces·키보드 레이아웃·시각 만료·호스트 복귀 매트릭스를 순서대로 검증한다. 물리 `Option+3` pause 경로는 통과했으므로 반복하지 않는다.
4. 사용자 배포 작업은 뒤로 미루고 T-009의 읽기 전용 도입과 실제 evidence/risk 수집부터 구현한다. 실제 저장소 rollback mutation은 별도 사용자 승인 전까지 계속 비활성화한다.
5. T-004에서 PermissionRequest 알림의 앱 복귀 가능 범위를 실환경에서 확정한다. 현재 구현은 polling 시점의 frontmost 외부 앱으로 돌아가는 best-effort이며 Allow/Deny는 중계하지 않는다.
6. 내부 실사용 뒤 T-012b-3c의 실제 `SMAppService`, signed Data Protection Keychain, Developer ID·공증·DMG·updater, exact Codex allowlist와 Terminal/iTerm/VS Code/Orca 매트릭스를 순서대로 검증한다.

## 알려진 위험과 경계

- `0.148.0`은 기존 한 사이클만, `0.149.0`은 격리된 두 사이클만 검증했다. 어느 쪽도 반복 제품 지원을 자동 승인하지 않으며 exact-version allowlist와 정기 호환성 테스트가 필요하다.
- T-011은 Keychain 없는 두 경계 제품 gate에 더해 실제 사용자 Plugin 설치·네 Hook 개별 신뢰·primary login Keychain service·Pet의 same-turn 왕복 두 번, foreground service 재시작과 live prompt-only correction을 통과했다. 재시작 전 미선택 카드는 자동 선택 없이 `restart_elapsed_ambiguous`로 폐기됐고 재기동 후 새 경계는 same-turn continuation과 terminal close까지 완료됐다. prompt-only 첫 실패는 저널을 쓰지 않았고 세션 기록상 prompt ID만 달랐으며 한 번의 corrected 제출만 수락됐다. 후속 T-010 통제 시험의 물리 `Option+3`은 단일 pause claim과 `episode_paused`로 닫혔고 continuation을 만들지 않았다. 저널에는 입력 장치 필드가 없으므로 물리 입력 판정은 사용자의 통제된 수행 보고와 결과 이벤트를 결합한 것이다. 확장 카드 시각 캡처와 실제 장시간 sleep은 아직 통과하지 않았다.
- 도그푸딩 준비 실패는 TOCTOU가 있는 path 기반 recursive delete를 피하기 위해 partial output/staging을 자동 삭제하지 않는다. 사람이 exact root를 검사하고 수동 정리해야 한다. cleanup runbook도 Codex/Pet/service 종료, 프로젝트 비활성화, Plugin/marketplace 제거까지만 되돌리며 service 실행 뒤 Application Support·DB·key file·Keychain item은 남을 수 있어 완전 롤백이 아니다.
- Stop 입력에는 경계 ID가 없으므로 T-011은 process-local HMAC observation, request generation, delivery digest와 phase gate로 동일 Stop 재전달·후속 active Stop을 구분한다. timeout으로 승격된 staged 경계와 finalization self-check 뒤 생성된 경계에만 active Stop을 새 waiter로 한 번 허용한다. proposal 없는 self-check는 같은 inactive Stop에 동일 block을 재생하고, 다음 active Stop에도 proposal이 없으면 fail-open해 반복을 막는다. 이 process-local 상태는 daemon 재시작 시 복원하지 않으며, 종료된 세션의 fallback은 daemon 수명 동안 세션당 최대 하나 남을 수 있다.
- T-007b-A2는 Keychain checkpoint보다 오래되거나 같은 sequence에서 head가 다른 authentic DB, DB·키 손실과 anchor 누락을 fail-closed한다. `pending + source DB`는 COMMIT 전 종료와 COMMIT 뒤 DB rollback을 구분할 수 없어 자동 취소하지 않으며, 정확히 같은 canonical batch가 없으면 운영자 복구가 필요하다. 기존 DB·키에 anchor가 없는 pre-A2 저장소는 자동 migration/adoption하지 않는다.
- 현재 unsigned CLI는 Data Protection Keychain에서 `errSecMissingEntitlement`가 발생해 legacy login Keychain을 사용한다. 같은 UID 공격자가 Keychain item까지 삭제·교체하거나 DB·키·anchor를 동시에 제거해 최초 설치처럼 만드는 경우는 A2 밖이며, signed wrapper와 code-signing ACL/access group은 T-012에서 닫는다.
- 과거 전체 실행에서 관찰한 legacy login Keychain 조회 timeout은 최신 실제 Keychain 전체 회귀에서 재현되지 않았고 `npm test` 284/284가 통과했다. 공개 배포의 signed Data Protection Keychain 전환 필요성과는 별개다.
- 외부 키 파일은 `0600`, 상위 디렉터리는 `0700`, symlink 경로는 `openat` 기반 검사로 거부한다. 이는 다른 UID에 대한 파일 권한 경계이며 같은 UID의 다른 프로세스가 키를 읽는 것은 막지 않는다.
- T-007b-A의 runtime-known secret corpus 검사는 현재 프로세스가 관찰·등록한 값의 저장·로그 유출만 막는다. 재시작 뒤 다시 등록하며, 런타임이 본 적 없는 임의 secret 전체를 탐지한다고 주장하지 않는다.
- T-007b-B1 제품 경로는 `execute_command`만 허용하고 raw `append`는 compile-time test harness에서만 노출한다. `pending + source DB`는 안전하게 차단되지만 B1이 exact batch를 복원할 수 없으므로 현재는 운영자 복구가 필요하다.
- Swift replay와 JS replay의 단일 결함 오류 코드는 맞췄다. 한 이벤트에 여러 결함이 동시에 있는 경우에는 raw-token/DTO 파싱 순서 때문에 첫 오류 코드가 다를 수 있으며, 이는 수용성 우회가 아닌 진단 우선순위의 낮은 잔여 parity 위험이다.
- T-007b-B2는 dispatch 후 300초 연속 단조 deadline에서 `unknown`을 정확히 한 번 기록하고 자동 재시도하지 않는다. 프로세스 재시작으로 anchor가 사라진 pending/unterminated 상태도 각각 expiry/`unknown`으로 fail-closed한다. T-011 storage authority가 정규화한 절대 DB 경로별 단일 제품 owner를 storage 초기화 전에 강제한다. symlink/hard-link/특수 mount의 서로 다른 path alias는 같은 inode로 합치지 못하는 잔여 위험이다.
- M0 하네스는 프로젝트 신뢰를 정확한 whole-table CLI override로 설정하고 Hook 해시 검토를 테스트 전용 `--dangerously-bypass-hook-trust`로 우회했다. 제품 설치에서는 이 우회를 사용할 수 없다.
- 프로젝트 로컬 MCP 검색 중복 우려는 해소됐고 T-011에서 격리 lifecycle과 실제 사용자 local marketplace/Plugin 설치·개별 Hook 신뢰가 Codex `0.149.0`으로 통과했다. 번들 코디네이터 자동 시작·Developer ID 서명·공증·실제 앱 DMG는 아직 검증하지 않았다.
- T-012b-3a writer의 `flock`은 advisory lock이므로 같은 UID의 비협조 프로세스를 강제로 차단하지 않는다. 실제 crash가 unique temporary file을 남길 수 있으나 다음 write와 충돌하지 않으며, 정리 정책은 설치 수명주기 단계에 남아 있다. 기존 개발용 `daemon`의 임의 storage path 계약도 유지되며 새 제품 설정 명령의 identity gate가 범용 파일 sandbox를 뜻하지 않는다.
- T-012b-3b는 `.enabled`를 등록·실행 자격 상태로만 표시하고 daemon health로 해석하지 않는다. 앱 시작·poll·snapshot·설정 화면 열기는 `SMAppService.register()`를 호출하지 않으며, 실제 등록·해제·System Settings 상태 전이는 아직 signed 앱에서 검증하지 않았다. 설정 변경은 service를 자동 재시작하지 않아 configured와 active가 다음 재시작까지 다를 수 있다.
- B2의 60초 알림과 120초 만료는 주입 clock으로 독립 세션·sleep advance·wall jump·late input·재시작 모호성을 결정론적으로 검증했고 제품 event loop가 deadline에 깨어난다. T-011 UDS owner와 DB authority는 구현했지만 실제 장시간 macOS sleep/복귀와 launchd daemon lifecycle은 공개 dispatch 전 패키징 단계에서 다시 검증해야 한다.
- 롤백 스파이크는 합성 임시 Git 픽스처에만 적용된다. `assume-unchanged`/`skip-worktree`/sparse는 `unsupported_index_state`, `core.filemode = false`는 `unsupported_git_configuration`, 비추적 POSIX 모드는 `unsupported_file_metadata`, 다섯 hazard attestation의 누락·unknown은 `hazard_attestation_missing`으로 모두 fail-closed한다. 실제 Blabee 작업공간이나 사용자 프로젝트에서 롤백은 활성화되어 있지 않다.
- Swift 선택은 공통 NDJSON·복구·부하·패키징 자격 결과에 근거하지만, T-005 spike 자체를 제품 코드로 승격하지 않는다. Node는 참조 하네스, C는 정식 JSON 파서가 없는 성능 기준선이며 T-007b-A는 별도 Swift Package로 제품 영속 어댑터를 구현했다.
- 기본 Hook 모드에서 범용 `requestUserInput`이나 네이티브 승인 중계를 약속하지 않는다.

공식 참고: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex 플러그인 만들기](https://developers.openai.com/plugins/build/plugins).
