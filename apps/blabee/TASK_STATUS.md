# Blabee 작업 현황

업데이트: 2026-09-02

## 현재 단계

M0 연동 계약과 T-006 런타임 독립 v1 계약을 확정한 뒤 T-005 런타임 선택, T-007a 참조 코어, T-007b-A/A2 Swift 영속·freshness 커널, T-007b-B1 의미 application, T-007b-B2 routing/time 계층과 T-007b-C의 역사적 같은 턴 반복 게이트까지 구현했다. T-015에서는 운영 전달 방식을 바꿨다. 이제 Stop Hook은 제안 유무만 기록하고 즉시 종료하며, Pet의 1·2 선택은 봉인된 action을 같은 Codex 세션의 **새 사용자 턴**으로 큐잉한다. 큐 접수는 전송 증거일 뿐 작업 시작·성공 증거가 아니고, 새 `UserPromptSubmit`은 새 turn·prompt·episode·baseline을 만든다. 과거 `same_turn_stop` 이벤트는 기존 저널 replay에만 남긴다. T-010은 메뉴바 `NSStatusItem`과 결정·권한 이벤트에서만 표시되는 비활성 유리 `NSPanel`, 결정 카드와 별도의 Hook PermissionRequest 2선택 카드를 제공한다. 여러 결정·권한 요청은 각 FIFO 선두만 표시·선택한다. 실제 사용자 저장소 롤백은 아직 구현하지 않았다.

활성 프로젝트의 `UserPromptSubmit`이 `SessionStart`보다 먼저 도착해도 세션을 지연 등록한다. 새 세션은 시작 시, 기존·유휴 세션은 다음 사람 프롬프트에서 자동 연결된다. 단 Plugin 교체 전부터 실행 중이던 Codex 프로세스는 새 Hook/MCP 구성을 읽도록 세션을 한 번 재개해야 한다.

## M0 및 M1 검증 결과

| 범위 | 결과 | 증거 |
|---|---|---|
| 전체 자동 테스트 | 조건부 통과 | T-015 최종 소스에서 Swift Testing 189/189+XCTest 5/5 통과. 전체 `npm test`는 286개 중 T-015·UDS·계약·패키징 285개가 통과했고, 무관한 기존 Keychain 비유출 검사 1개가 `/usr/bin/security` 30초 조회 timeout으로 실패했다. 같은 검사의 격리 재실행은 1/1 통과했으며, race 수정 직전 동일 전체 suite도 286/286 통과했다 |
| v1 계약 패키지 | 완료 | 스키마 10개, Fixture JSON 33개, 계약 테스트 114/114 통과 |
| Hook/코디네이터 | 조건부 완료 | Hook 집중 17/17과 M0 전체 55/55 통과. 실패 진단의 원문 correlation/continuation token도 가린다. 실제 Codex CLI `0.149.0`에서 결정 두 사이클과 `M0_CONTINUED_TWICE`를 확인했지만 지원 버전 승인은 아님 |
| 체크포인트/복원 | 임시 픽스처 검증 완료 | 운영체제 임시 디렉터리 아래 합성 Git 저장소에서 36개 테스트 통과 |
| 런타임 비교 | 완료, Swift 선택 | Node·Swift 공통 NDJSON 계약과 복구·부하·진단·ad-hoc 서명·측정용 DMG를 비교해 Swift를 제품 런타임으로 선택. Node는 참조, C는 정식 JSON 파서가 없는 health 기준선 |
| T-007a 참조 코어 | 완료 | 순수 reducer/replay, CAS 선택 선점, sealed packet document·verification sidecar, prototype-key 안전 projection, command/replay 동등성, 같은 턴 lineage·패킷 의미 검증과 NFC 식별자 규칙 포함 33/33 통과. `InMemoryJournal`은 참조 전용 |
| T-007b-A/A2 제품 영속 커널 | 조건부 완료 | A/A2 기준 Swift unit 27/27, Node persistence 통합 40/40 통과. SQLite/CAS/MAC/HMAC과 Keychain freshness를 제공하며 제품 호출은 B1 의미와 B2 routing/time 경계를 거쳐야 한다. 공개 dispatch는 T-011 운영 adapter 전까지 차단 |
| T-007b-B1 Swift 의미 application | 조건부 완료 | 12개 이벤트와 11개 command, exact RFC3339 ns, exact/범위 제한 정수 transport, NFC 저장 ID와 byte-exact 참조, CAS/token/effect 경계, 제품 `execute_command`, raw append compile-time 차단을 구현. Swift 전체 45/45와 제품 gate 1/1 통과 |
| T-007b-B2 Swift routing/time | 조건부 완료 | 세션별 pending 하나, 다중 세션 queue, 명시적 foreground/no-steal, exact binding selection, continuous clock reminder/expiry/timeout을 구현. Pet·형식 보정 토큰의 고정 120초 소비 권위와 transport 완료 시각도 외부 wall 입력 대신 연속 단조 시각으로 강제하며 restart ambiguity를 fail-closed한다. T-007b-B2 완료 당시 Swift package 전체 62/62와 제품 gate 통과 |
| T-007b-C 같은 턴 반복 | 조건부 완료 | `0.149.0` 실제 Hook+M0에서 경계 1→2와 결정 두 사이클, Swift 제품 게이트에서 같은 lineage의 16개 이벤트 persist/replay를 각각 통과. 실제 Hook→Swift 운영 연결은 T-011 |
| T-011 운영 어댑터와 Plugin | 구현·자동/지연 세션 연결·제품 결합·신규 세션 및 cache 회전 실환경 완료 | `npm run test:t011` 28/28과 Swift Operational/UDS 회귀가 통과했다. `UserPromptSubmit` 지연 등록, 비활성 프로젝트 비등록, 교차 프로젝트 세션 충돌 거부, 뒤늦은 `SessionStart` identity 유지, 실제 Hook/UDS 지연 연결 두 경계를 검증했다. Hook/MCP는 Plugin-local launcher와 fail-closed locator를 사용한다. `build/local-dogfood-hook-guard-v1`의 source·app·marketplace·설치 cache Hook SHA-256 `76ad962b…c66e`가 일치하며, 새 Codex 세션 `01a03216-…`에서 UserPromptSubmit과 답변 종료가 code 127 없이 통과했다. 그 세션이 guarded command를 보유한 채 cache root를 제거하자 같은 세션이 `CACHE_ROTATION_SESSION_OK`로 끝났고, 네 Hook 직접 실행도 모두 exit 0·빈 stdout/stderr·입력 비노출이었다. 재설치 후 새 세션 `01a03218-…`이 Blabee 경계를 다시 받아 최신 Plugin 자동 연결도 별도로 확인했다. 설치 전부터 열린 세션의 최신 Plugin 재연결, sleep, SMAppService·공개 배포는 추가 실환경 검증 범위다. |
| T-015 비차단 Stop·queue 새 턴 | 소스·계약·실제 두 세션 dogfood 완료 | Stop은 빈 stdout으로 즉시 끝나고 1·2는 exact session에 한 번 큐잉한다. 큐 메시지 digest가 정확히 일치하는 reentrant `UserPromptSubmit` 또는 queue receipt만 transport 완료 근거로 인정하며, 같은 세션의 무관한 프롬프트는 이전 dispatch를 완료하지 않는다. Operational 24/24, queue process 6/6, Pet 108/108, v1 계약 114/114, 제품 UDS 왕복과 Swift 189/189+XCTest 5/5가 통과했다. `build/local-dogfood-async-next-turn-v1`로 app·service·Plugin·Pet을 교체한 실제 Codex `0.149.0` 두 세션에서 원래 답변이 정상 종료됐고, FIFO A→B 선택 뒤 같은 session의 새 turn·episode에서 `A_NEXT_TURN_OK`·`B_NEXT_TURN_OK`가 완료됐다. |
| T-010 네이티브 macOS Pet | 기존 floating UI 실제 macOS 자격 조건부 완료, 메뉴바 FIFO 최신 빌드 교체·실제 선택 완료 | 평상시 전달받은 Blabee SVG 아이콘만 유지하고 attention에는 우상단 red overlay badge를 표시하며, 새 결정·권한 이벤트에서 아이콘 아래 패널을 자동 표시한다. 여러 세션은 `routing.pending` FIFO 선두만 표시·focus·선택하며 선두 선택 후 다음 세션을 자동 focus한다. 선택 불가 선두의 추월과 follower 직접 focus/selection은 fail-closed하고, 기존 authoritative foreground는 자동으로 빼앗지 않는다. 자동 focus 응답이 일시적으로 유실되어도 코디네이터 전면이 없거나 같은 FIFO 선두이면 다음 poll에서 재시도하고, 다른 authoritative foreground가 있으면 빼앗지 않는다. 최신 `BlabeePetTests` 108/108, 전체 Swift Testing 189/189+XCTest 5/5, 앱 패키징 8/8이 통과했다. 현재 service PID 15492와 Pet PID 15853은 `build/local-dogfood-hook-guard-v1`에서 실행 중이며, service는 실사용 교체를 위한 임시 `launchctl submit` job이다. 두 실제 세션 FIFO 선택·다음 세션 승격은 앞선 저널에서 확인했다. 비활성 메뉴바 패널은 Computer Use AX가 붙지 않아 픽셀·자동 열림/닫힘을 직접 캡처하지 못했으며, 다중 디스플레이·Spaces·키보드 레이아웃·sleep·Terminal/VS Code/Orca 복귀도 미검증이다. |
| T-012a 읽기 전용 Doctor 기반 (2026-08-22 최초 기록) | 구현·자동 계약 검증 완료, 공개 배포 미승인 | `doctor_status`는 일반 operational 경로와 journal/time 변경을 우회한다. Doctor 18/18, Operational 15/15, T-011 26/26, v1 계약 114/114가 통과했다. 당시 로컬 Doctor에서 app·embedded coordinator·Plugin 설치/구조·Plugin-local MCP runtime·daemon·project 검사가 통과했다. 당시 Codex `0.149.0` allowlist가 비어 있어 전체는 실패했고, Hook 해시 검토도 사용자 조치 필요로 보고했다. 현재 정책과 검증 결과는 표 아래 2026-09-01 후속 기록이 대체한다. signed Keychain·DMG·공증·터미널 매트릭스와 path/process-group hardening은 미완료이다. |
| T-012b-1 로컬 앱 번들 기반 | 로컬 조립·ad-hoc 자격 완료, 공개 배포 미승인 | `Blabee.app`에 고정 plist, 단일 release 실행 파일, exact Contracts/Plugin과 assembly manifest를 포함한다. 패키징 5/5, Swift Pet/Doctor/진입 55/55, T-011 24/24, 계약 114/114가 통과했다. 실제 번들은 `adhoc,runtime`과 deep/strict 검증을 통과했고 Info.plist 변조 후 서명 검증은 실패했다. 로컬 dogfood는 output root에서만 실행했으며 `/Applications`, launchd, Developer ID, 공증, DMG는 건드리지 않음 |
| T-012b-2 제품 service·정적 LaunchAgent | foreground 제품 자격 완료, 자동 시작 미승인 | `service`는 exact app/Resources/real Contracts와 Application Support 고정 경로만 사용하고 추가 인자·환경 경로 우회를 거부한다. strict `service.json`과 정적 LaunchAgent exact 네 키를 구현했다. Product 10/10, 패키징 7/7, T-011 24/24와 ad-hoc strict 서명 계약이 통과했다. 후속 dogfood에서 primary login Keychain과 임시 `launchctl submit` service는 실행했지만, 번들 정적 LaunchAgent 또는 `SMAppService` 등록과 로그인 자동 시작은 실행하지 않음 |
| T-012b-3a 프로젝트 설정 writer | 안전한 설정 변경 계약 자격 완료, 제품 UI·자동 시작 미승인 | exact 앱 전용 `project-settings`, current-user 0700/0600·single-link 경계, mutex+flock, strict locked RMW, file/directory fsync와 atomic rename을 구현했다. reader도 Application Support ancestor symlink를 거부한다. Writer 12/12, fresh reader+writer 23/23, Swift Pet 78/78, 이 단계 완료 당시 전체 Swift Testing 150/150+XCTest 5/5, release build와 패키징 7/7 통과. 후속 dogfood에서 foreground service와 primary login Keychain을 실행했지만 SMAppService·launchctl·자동 시작은 실행하지 않음 |
| T-012b-3b Pet 온보딩 UI·서비스 상태 계약 | UI·fake adapter 자격 완료, 실제 자동 시작 미승인 | 수동 상태/설정 조회, 명시적 버튼 전용 등록·해제·System Settings·프로젝트 변경, single-flight와 configured/active 분리를 구현했다. Onboarding 10/10, Pet 88/88, 최신 전체 Swift Testing 161/161+XCTest 5/5, T-011 24/24, 패키징 7/7, 계약 114/114가 통과했다. 후속 dogfood에서 Application Support와 primary Keychain을 사용했지만 실제 SMAppService·System Settings 변경은 하지 않음 |
| 프로젝트 로컬 MCP 검색 | 완료 | 직접 MCP `-c` 주입 없이 임시 프로젝트 `.codex/config.toml`만으로 전체 왕복 통과 |
| 설명 전용 음성 계약 | 완료 | 결정 제안·대기 0건, 파일 변경 없음, 마지막 메시지 `M0_EXPLAINED` |
| 플러그인 구조 | 실제 로컬 설치·신뢰·회전 조건부 완료 | 실제 Codex CLI `0.149.0`의 격리 lifecycle과 실제 사용자 marketplace/Plugin 설치를 통과했다. 현재 활성 selector는 `blabee@blabee-local-dogfood-dbc4be6d1786` 하나이며 네 guarded Hook은 `/hooks`에서 각각 검토·신뢰했다. 설치 cache 제거 뒤 fail-open과 재설치 후 새 세션 연결도 통과했다. 제공 Python validator는 PyYAML 부재로 실행하지 않았고 공개 배포 신뢰 UX는 별도 |
| PermissionRequest 제품 동작 | Hook·관리형 소스 자동 계약 검증 완료, 설치본 App Server 실사용 왕복 미검증 | Hook Pet은 FIFO 선두의 지원 가능한 command형 요청에 `거절`, `Codex에서 직접 결정`만 제공하고 Hook allow를 출력하지 않는다. 관리형 Pet FIFO는 `이번만 허용`, `거절`, `Codex에서 직접 결정`을 별도 카드로 제공하고 원본 `environmentId`를 표시한다. 120 Unicode scalar 이하의 안전한 단일 행 명령만 생략 없이 표시하며 그 밖에는 원래 Codex TUI로 반환한다. 두 경로 모두 대기 상한 8개, exact binding·response ID 멱등성, journal 비영속과 native fallback을 구현했고 `acceptForSession`은 지원하지 않는다. 실제 설치본 App Server 왕복은 아직 미검증이다. |
| App Server 일회 승인 관리형 실행 | 소스·자동 계약 검증 완료, 설치본 live dogfood 미검증 | 지원 Codex `0.149.1`·`0.150.1`·`0.151.0`의 `item/commandExecution/requestApproval` 계약을 엄격히 파싱하고 문자열·정수 request ID와 원본 바이트를 보존한다. `blabee-codex`는 인증된 localhost WebSocket TUI와 stdio App Server를 중계하며, 관리형 FIFO 선택을 `accept`·`decline` 또는 원본 TUI 전달로 변환한다. 사용자 결정 120초·브로커 130초·socket 135초의 순서화된 상한을 적용하며, 무응답·오류·8개 상한 초과는 원래 Codex로 반환한다. request ID 기억이 256개에 도달하면 그 연결은 이후 승인을 전부 네이티브 TUI에 맡긴다. `acceptForSession`, 추가 권한, 네트워크·실행 정책 변경, 표시할 수 없는 명령은 합성하지 않는다. 초기 관리형 자격은 집중 30/30·제품 310/310, 최신 runtime identity 회귀는 집중 12/12·전체 Swift Testing 445/445+XCTest 5/5를 통과했다. Pet 선택 receipt는 App Server 전달이나 명령 실행 성공의 증거가 아니다. |
| 관리형 Codex runtime bundle 신뢰 경계 | 소스·자동 검증 완료, 설치본 live·clean Mac 미검증 | 과거 단일 executable pin을 bounded official package manifest 기반 private runtime bundle로 교체했다. 공유 inspector가 manifest, `bin/codex`, sibling `codex-code-mode-host`, `codex-path/rg`, resources의 owner·mode·ACL·link·target·서명·bounds·identity를 검사한다. descriptor staging copy, source/destination 재검증, 원자 recovery plan, seal·fsync·원자 게시와 exact cleanup/lease를 적용하며, 반복 spawn 경계는 exact metadata tree와 작은 seal hash로 확인해 전체 payload 재해시를 피한다. 같은 Team ID·version만으로 승인하지 않고 full-bundle canonical fingerprint를 닫힌 catalog와 비교하며 현재 등록 대상은 official `0.151.0` Apple Silicon뿐이다. version probe·App Server·TUI·보조 세션·pre-child fallback은 같은 bundle의 본체와 host를 사용한다. 기본 Doctor는 Codex child를 실행하지 않고 layout·identity·manifest allowlist·catalog 자격·code-mode live 자격·실제 Plugin locator가 확인된 Blabee build identity를 분리 보고한다. runtime trust 60/60, Doctor 30/30, managed broker 56/56, 전체 Swift Testing 472/472+XCTest 5/5, 전체 Node 277/277, release build와 실제 official `0.151.0` artifact 강제 catalog 시험 1/1이 통과했다. 일반 `codex`, 공식 설치 파일, PATH·셸 설정은 변경하지 않는다. semantic allowlist의 `0.149.1`·`0.150.1` production bundle, Codex 0.152.0·0.152.1, Intel, 실제 code-mode/Plugin/Hook, 다른 Mac 설치·업데이트·제거는 여전히 활성화 차단 gate다. |

위 T-012a 표 행과 2026-09-01 `hooks/list` 자동 조회 기록은 과거 검증
기록이다. 2026-09-02 후속으로 기본 Doctor의 경계를 완전한 정적·읽기
전용으로 줄였다. 기본 Doctor는 `codex --version`, `codex plugin list`,
App Server `hooks/list`를 실행하지 않는다. manifest allowlist가 통과해도
실제 binary 버전, Plugin 설치·활성, Hook 신뢰와 code-mode는 별도
live qualification 전까지 `action_required`다. 과거 29/29·434/434+XCTest 5/5와
`hook_trust_ok`는 새 정책의 기본 Doctor 통과 근거로 사용하지 않는다.

같은 날 runtime 회전 후속으로 signed assembly manifest v2와 이전 runtime의 제한적
UDS 호환을 구현했다. raw identity 대신 검증된 이전 `Blabee.app`을 입력받고, 이전
identity에는 `session_start`·`user_prompt_submit`·`emit_decision`·`stop`만 허용한다.
검사기와 번들은 같은 private coordinator snapshot을 사용하고 inspector v2가 같은
검증 manifest에서 wire identity와 manifest digest를 함께 반환한다. 전체 Swift
Testing 441/441+XCTest 5/5와 Node 276/276가 통과했다. 현재 v1 앱을 명시적으로
허용하는 `build/local-dogfood-runtime-compat-v2-20260901`을 별도로
서명·검증했지만, 열린 세션 보존을 위해 실행 중 앱·service·Plugin은 교체하지 않았다.
실제 구 Hook/MCP→새 service 왕복과 session drain 뒤 이전 cache 정리는 활성화
게이트로 남아 있다.

같은 날 관리형 App Server 승인 전용 UDS client의 runtime identity 누락 회귀도
수정했다. 선택 요청과 delivery ack가 모두 v1 namespaced type과 process-cached
current identity를 보내고, 응답의 request ID와 exact identity를 확인한 뒤에만
결정·token·application error를 해석한다. 실제 strict server 성공·ack, application
error의 byte-exact Codex 복귀, 다른 server identity의 dispatch 전 거부와 forged
positive response 거부를 검증했다. 집중 12/12, 전체 Swift Testing 445/445+XCTest
5/5와 release build가 통과했다. 설치본 live Pet→App Server 왕복은 계속 별도
실사용 게이트이며 실행 중 앱·service·Plugin은 교체하지 않았다.

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

위 순서는 과거 `same_turn_stop` 호환 시험의 기록이다. 현재 운영 경로에서는 최초 Stop이 `decision_available`을 저장하고 빈 stdout으로 끝난다. Pet의 1·2 선택은 exact session에 `codex queue --thread ... --message ...`를 한 번 호출하고 `next_turn` receipt를 받는다. Codex가 큐 메시지를 `UserPromptSubmit`으로 처리하면 같은 project·session 안에서 새 turn·prompt·episode·baseline이 시작된다. Blabee는 큐 접수를 작업 성공으로 간주하지 않는다.

실제 반복 계약 출력은 `mcp_config_source = project_config_only`, `decision_cycle_count = 2`, `final_assistant_message = M0_CONTINUED_TWICE`, `terminal_input_injection = false`, `separate_llm_api_key = false`였다.

`--explanation-only` 음성 계약에서는 `project_enabled`, `session_started`, `human_episode_started`만 관찰했고 `decision_proposal_received = 0`, `decision_wait_started = 0`, `result.txt` 없음, `final_assistant_message = M0_EXPLAINED`를 확인했다.

## 확정된 제품 결정

1. 새 결정 카드는 우선순위가 매겨진 실행 가능한 다음 항목 2~4개다. `1`은 가장 권장하는 작업이고 `2`~`4`는 순서대로 차선이다. 보류와 롤백은 새 숫자 슬롯의 고정 의미로 발행하지 않으며, 과거 고정 네 슬롯 패킷은 journal replay 호환 목적으로만 읽는다.
2. 1·2 선택은 숫자만 전달하지 않는다. 코디네이터가 봉인된 패킷에서 작업의 제목·목표·제약·완료 기준 전체를 다시 읽고, 같은 Codex 세션의 새 사용자 턴으로 큐잉한다. Stop Hook은 Codex의 현재 답변 완료를 막지 않는다.
3. 사람이 직접 입력한 프롬프트와 Pet이 큐잉한 새 프롬프트는 모두 새 에피소드와 롤백 기준선을 만든다. Pet action의 binding은 선택이 만들어진 원본 에피소드를 보존해 출처를 추적한다.
4. 공개 v0.1 자동 롤백 후보는 깨끗한 작업 트리에서 시작하고 범위가 완전한 프롬프트 에피소드 하나다. ignored 파일, 하위 모듈, LFS, 저장소 밖 파일, 크기 초과, 동시 편집, 브랜치·HEAD 변경, 외부 부수 효과가 있으면 비활성화한다.
5. M0 센티널과 실행 스파이크는 2026-08-31 활성 트리에서 제거했다. 운영 결정 제안 채널은 프로젝트 로컬 MCP `emit_decision`이다.
6. 지원 가능한 command형 Hook 권한 요청은 Pet의 별도 2선택 카드로 중계한다. Hook에서는 `거절`과 `Codex에서 직접 결정`만 제공한다. `이번만 허용`은 관리형 App Server의 단일 요청 `accept`로만 제공하고 세션·전역 허용은 만들지 않는다. 실패·만료·재시작에서는 Codex 네이티브 승인 체계로 반환하며 앱 복귀는 best-effort다.
7. 현재 protocol semantic allowlist는 Codex `0.149.1`, `0.150.1`, `0.151.0`이다. production managed 실행은 여기에 더해 exact full-bundle fingerprint catalog와 live 자격을 통과해야 하며, 2026-09-02 등록 대상은 official `0.151.0` Apple Silicon뿐이다. Hook/MCP, `codex queue`, 관리형 App Server의 exact 출력·세션 라우팅을 각 버전 계약 테스트로 확인한 경우에만 목록과 catalog에 유지하거나 추가한다.
8. 일반 로컬 코디네이터 연결은 2초, Hook 응답은 5초, Pet 선택은 큐 프로세스 10초보다 긴 12초로 제한한다. 실패해도 완료 중인 Codex 답변은 막지 않으며, 60초에 한 번 알리고 120초에 자동 선택 없이 만료해 늦은 입력을 거부한다.
9. 여러 세션의 패킷은 `routing.pending` FIFO 대기열에 둔다. Pet은 선두 카드만 표시·focus·선택하고, 전면 대상 없이 선두가 선택 가능하면 대기열 길이와 관계없이 자동 focus한다. 선두가 제거되면 다음 카드로 자동 진행하며 뒤 카드는 직접 선택할 수 없다.
10. Blabee는 별도 LLM API 키나 추론 서비스를 요구하지 않는다.

## 작업 상태

- 완료: T-001, T-002, T-003, T-005, T-006, T-007, T-015
- M0 합성 픽스처 검증 완료: T-008. 실제 사용자 작업공간 연결은 아직 하지 않았다.
- 진행 중: T-004, T-010, T-011, T-012. T-015의 실제 `답변 완료 → FIFO Pet 선택 → 같은 세션 새 턴` 왕복은 완료했다. T-010은 확장 카드 시각 캡처·디스플레이·Space·키보드 레이아웃·sleep·호스트 앱 매트릭스, T-011은 실제 sleep/복귀, T-012는 LaunchAgent 등록/승인·signed Keychain·DMG·공증·버전 allowlist·터미널 매트릭스가 남았다.
- 대기: T-009, T-013, T-014.

## 다음 작업

1. 사용자가 실행 시점을 정하면 T-011/T-010 공통 실제 sleep/복귀 게이트를 수행한다. 대기 카드가 있는 상태와 없는 상태를 나눠 continuous deadline, foreground service 생존·재연결, 늦은 선택 거부와 새 경계 왕복을 확인한다.
2. T-015에서 통과한 열린 유휴 세션 즉시 실행과 별도로, 실제 닫힌 Codex thread에 큐잉한 메시지가 resume까지 보존되는 제품 설치본 경로를 한 번 확인한다. 격리 CLI에서는 이미 통과했으므로 공개 지원 allowlist 결정과 함께 수행한다.
3. T-010의 확장 카드 시각 캡처와 다중 디스플레이·Spaces·키보드 레이아웃·시각 만료·호스트 복귀 매트릭스를 순서대로 검증한다. 물리 `Option+3` pause 경로는 통과했으므로 반복하지 않는다.
4. 사용자 배포 작업은 뒤로 미루고 T-009의 읽기 전용 도입과 실제 evidence/risk 수집부터 구현한다. 실제 저장소 rollback mutation은 별도 사용자 승인 전까지 계속 비활성화한다.
5. T-004에서 일반 Hook PermissionRequest의 `거절`·`Codex에서 직접 결정` 왕복과 두 세션 FIFO, timeout·서비스 재시작 fallback을 검증하고, 별도 관리형 App Server 세션에서 `이번만 허용 = accept`와 원래 TUI 전달을 검증한다. polling 시점 frontmost 앱으로의 복귀는 best-effort다.
6. 내부 실사용 뒤 T-012b-3c의 실제 `SMAppService`, signed Data Protection Keychain, Developer ID·공증·DMG·updater, exact Codex allowlist와 Terminal/iTerm/VS Code/Orca 매트릭스를 순서대로 검증한다.

## 알려진 위험과 경계

- `0.148.0` 한 사이클과 `0.149.0` 두 사이클은 과거 같은 턴 방식의 역사적 검증이다. 현재 `queued_next_turn`은 로컬 `0.149.0` 격리 시험에서 열린 유휴 TUI에는 즉시 새 턴으로 실행되고 닫힌 thread에는 resume까지 보존됐으며, 제품 설치본의 열린 두 TUI에서도 FIFO 새 턴 실행을 통과했다. 이는 Codex `0.149.0` 지원 allowlist나 공개 배포 승인은 아니다.
- T-011의 과거 실제 사용자 왕복은 `same_turn_stop` 방식으로 통과한 역사적 증거이며 현재 T-015 운영 전달을 승인하지 않는다. T-015는 큐 접수와 작업 결과를 분리하므로 프로세스 종료·세션 미재개·CLI 출력 변경 때 작업이 아직 실행되지 않았을 수 있고, 중복 실행 위험 때문에 자동 재시도하지 않는다. 후속 T-010 통제 시험의 물리 `Option+3`은 단일 pause claim과 `episode_paused`로 닫혔고 continuation을 만들지 않았다. 확장 카드 시각 캡처와 실제 장시간 sleep은 아직 통과하지 않았다.
- 도그푸딩 준비 실패는 TOCTOU가 있는 path 기반 recursive delete를 피하기 위해 partial output/staging을 자동 삭제하지 않는다. 사람이 exact root를 검사하고 수동 정리해야 한다. cleanup runbook도 Codex/Pet/service 종료, 프로젝트 비활성화, Plugin/marketplace 제거까지만 되돌리며 service 실행 뒤 Application Support·DB·key file·Keychain item은 남을 수 있어 완전 롤백이 아니다.
- Stop 입력에는 경계 ID가 없으므로 동일 Stop 관찰의 HMAC ledger는 중복 기록만 거부한다. Stop waiter와 finalization fallback은 제거됐고, proposal이 없으면 `no_proposal`, 있으면 `decision_available`을 저장한 뒤 모두 빈 stdout으로 즉시 종료한다. 선택과 새 턴 큐잉은 이후 Pet 요청에서 독립적으로 일어난다.
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
- 설정에서는 수정 전 Blabee selector를 제거해 새 세션이 최신 selector 하나만 읽는다. 다만 수정 전 Hook command를 메모리에 보유한 다른 열린 Codex 세션의 마지막 Hook을 깨뜨리지 않기 위해 이전 cache root는 실행 가능한 상태로 보존했다. 이는 최신 Plugin 자동 재연결 증거가 아니며, 해당 세션들이 종료·재개된 뒤 별도 정리해야 한다.
- T-012b-3a writer의 `flock`은 advisory lock이므로 같은 UID의 비협조 프로세스를 강제로 차단하지 않는다. 실제 crash가 unique temporary file을 남길 수 있으나 다음 write와 충돌하지 않으며, 정리 정책은 설치 수명주기 단계에 남아 있다. 기존 개발용 `daemon`의 임의 storage path 계약도 유지되며 새 제품 설정 명령의 identity gate가 범용 파일 sandbox를 뜻하지 않는다.
- T-012b-3b는 `.enabled`를 등록·실행 자격 상태로만 표시하고 daemon health로 해석하지 않는다. 앱 시작·poll·snapshot·설정 화면 열기는 `SMAppService.register()`를 호출하지 않으며, 실제 등록·해제·System Settings 상태 전이는 아직 signed 앱에서 검증하지 않았다. 설정 변경은 service를 자동 재시작하지 않아 configured와 active가 다음 재시작까지 다를 수 있다.
- B2의 60초 알림과 120초 만료는 주입 clock으로 독립 세션·sleep advance·wall jump·late input·재시작 모호성을 결정론적으로 검증했고 제품 event loop가 deadline에 깨어난다. T-011 UDS owner와 DB authority는 구현했지만 실제 장시간 macOS sleep/복귀와 launchd daemon lifecycle은 공개 dispatch 전 패키징 단계에서 다시 검증해야 한다.
- 롤백 스파이크는 합성 임시 Git 픽스처에만 적용된다. `assume-unchanged`/`skip-worktree`/sparse는 `unsupported_index_state`, `core.filemode = false`는 `unsupported_git_configuration`, 비추적 POSIX 모드는 `unsupported_file_metadata`, 다섯 hazard attestation의 누락·unknown은 `hazard_attestation_missing`으로 모두 fail-closed한다. 실제 Blabee 작업공간이나 사용자 프로젝트에서 롤백은 활성화되어 있지 않다.
- Swift 선택은 공통 NDJSON·복구·부하·패키징 자격 결과에 근거하지만, T-005 spike 자체를 제품 코드로 승격하지 않는다. Node는 참조 하네스, C는 정식 JSON 파서가 없는 성능 기준선이며 T-007b-A는 별도 Swift Package로 제품 영속 어댑터를 구현했다.
- 기본 Hook 모드에서 범용 `requestUserInput`이나 네이티브 승인 중계를 약속하지 않는다.

공식 참고: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex 플러그인 만들기](https://developers.openai.com/plugins/build/plugins).
