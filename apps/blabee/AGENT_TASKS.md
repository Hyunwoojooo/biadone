# Blabee 에이전트 작업 목록

상태 값: `pending`, `in_progress`, `blocked`, `done`.

| ID | 작업 | 선행 작업 | 위험도 | 완료 기준 | 상태 |
|---|---|---|---|---|---|
| T-001 | 기본 Codex에서 SessionStart 조건부 컨텍스트 검증 | 없음 | 중간 | 활성화한 프로젝트에는 컨텍스트가 전달되고, 비활성 프로젝트는 변경되지 않음 | done |
| T-002 | 센티널 smoke test 후 로컬 MCP 결정 제안과 턴 연결 검증 | T-001 | 높음 | 센티널로 최소 왕복을 확인하고, 공개 경로에서는 텍스트 파싱 없이 프로젝트 로컬 MCP 제안이 정확한 세션/턴에 연결됨 | done |
| T-003 | Stop 대기, 반고정 슬롯, 같은 턴 후속 진행 한 사이클 검증 | T-002 | 높음 | 결정 한 번의 1·2가 봉인된 전체 작업을 대기 중인 Stop을 통해 같은 세션·턴·에피소드로 전달하고, 후속 `stop_hook_active` Stop에서 전송 수명 주기 종료를 한 번 관찰하며, 교차 바인딩·중복 종료·형식 보정 제출 토큰의 재사용/만료·2초 fail-open·선택 전 60초 알림/120초 만료를 검증함. 작업 성공과 dispatch 후 in-flight deadline은 별도임 | done |
| T-004 | PermissionRequest 알림과 원래 Codex UI 위임 검증 | T-001 | 높음 | Pet은 요청을 알리고 원래 화면으로 이동할 수 있지만 허용·거부 결정을 대신 전송하지 않음 | in_progress |
| T-005 | 운영 코디네이터 런타임 측정과 선택 | T-002, T-003 | 높음 | TS/Node, 분리 Swift 헬퍼, 소형 독립형 시스템 바이너리의 시작 시간, 메모리, 장애 복구, 서명, DMG 크기를 비교해 선택 기록을 남김 | done |
| T-006 | v1 결정 패킷과 프롬프트 경계 스키마 확정 | T-002, T-003 | 중간 | 반고정 슬롯, 선택 요청, `pet_action = same_turn_stop`, `internal_format_repair = submitted_envelope`, 형식 보정 예약·claim durable 이벤트, 프롬프트/에피소드/기준선 필드, dispatch 후 in-flight deadline/outcome의 골든 픽스처와 모드별 재사용·만료·바인딩·재시작 replay 테스트가 통과함 | done |
| T-007 | 이벤트 저널, 리듀서, 세션 대기열, 원자적 선택 선점 구현 | T-005, T-006 | 높음 | 재시작, 오래된 이벤트, 이중 선택, 형식 보정 예약의 원자적 경계당 1회 소비, CSPRNG 토큰·fingerprint constant-time 검증, 같은 턴의 연속 결정 사이클, 전면 카드, 교차 세션 입력 테스트가 통과함 | done |
| T-008 | 사람이 입력한 직전 프롬프트 단위 clean-worktree 체크포인트와 롤백 검증 | 없음 | 치명적 | 합성 임시 Git 픽스처에서 Pet 연속 진행까지 바이트·Git 실행 비트·인덱스 단위 복원하고, unsupported index/config/metadata와 hazard attestation 누락을 포함한 dirty/ignored/submodule/LFS/루트 밖/크기 초과/동시 편집/브랜치·HEAD 변경/외부 효과에서는 fail-closed하며, 복구 스냅샷 생성과 1 GiB 정리 정책을 검증함. 스냅샷 재적용·실패 주입과 실제 작업공간 연결은 별도 제품 작업임 | done |
| T-009 | 진행 중인 기존 프로젝트의 단계적 도입 구현 | T-006, T-008 | 높음 | 도입 중 저장소를 변경하지 않고, 안전한 기준선이 없을 때는 1·2·3만 제공하며 롤백은 비활성화됨 | pending |
| T-010 | 반고정 결정 카드를 갖춘 네이티브 macOS Pet 구현 | T-006, T-007 | 중간 | 동적 1·2, 고정 3·4, 다중 세션 전면 카드, 비활성 슬롯, 만료 상태를 정확히 표시하고 입력 초점·다중 디스플레이·오래된 단축키 테스트가 통과함 | in_progress |
| T-011 | 검증된 Skill, Hook, MCP 운영 어댑터 구현과 플러그인 패키징 | T-001~T-007 | 높음 | Hook·MCP·Pet을 Swift 제품 코디네이터에 연결하는 고수준 adapter와 단일 UDS owner를 구현하고, 센티널 없이 운영 왕복·설치·업데이트·제거·신뢰 검토 흐름을 재현할 수 있음 | in_progress |
| T-012 | 서명 및 공증된 DMG, `blabee doctor`, 터미널 매트릭스 구현 | T-010, T-011 | 높음 | Codex 0.148.0/지원 allowlist, 앱·데몬·Plugin/MCP·Hook 신뢰·프로젝트 활성화 진단이 작동하고 Terminal, iTerm, VS Code 터미널, Orca에서 통과함 | pending |
| T-013 | 3회 연속 내부 실사용과 안전성 통과 기준 실행 | T-007~T-012 | 치명적 | 3회 순환 완료, 검증된 롤백 실패 0건, 높음·치명적 작업의 전역 단축키 시작 및 네이티브 원클릭 승인 0건 | pending |
| T-014 | 공개 v0.1 이후 requestUserInput/app-server 제어 범위 확정 | T-013 | 중간 | Hook-first 공개 범위와 후속 관리형 기능 매트릭스가 근거와 함께 분리됨 | pending |

## M0 상태 해석

- T-001~T-003은 실제 Codex CLI `0.148.0` 임시 프로젝트 계약 픽스처와 자동 테스트를 기준으로 완료했다.
- T-004는 PermissionRequest 알림 전용·응답 비중계 계약과 Pet의 best-effort 앱 복귀 코드를 확인했다. 요청에 원래 PID/창 identity가 없어 알림 증가를 polling한 시점의 frontmost 외부 앱만 기억하므로 정확한 원래 Codex 창과 실환경 Pet UX 검증이 남아 `in_progress`다.
- T-005는 Node·Swift의 공통 NDJSON 계약, `fsync`·강제 종료 replay·partial-tail 복구·지속 부하·단조 대기 probe·구조화 진단·ad-hoc 서명·측정용 DMG를 비교해 Swift 네이티브 헬퍼를 제품 런타임으로 선택했다. Node는 계약 참조, C는 health 전용 성능 기준선이다. 유효한 Developer ID identity는 0개였고 공증은 측정하지 않았으므로 공개 서명·공증 DMG는 T-012에 남는다.
- T-006은 `Contracts/v1`, `Fixtures/v1`, `Tests/Contracts`의 런타임 독립 계약 범위에서 완료했다. 형식 보정의 durable 예약·claim 이벤트와 replay 규칙은 고정했지만 실제 이벤트 저널·원자적 선택·반복 Pet 루프를 구현했다는 뜻은 아니며 그 책임은 T-007에 남는다.
- T-007a는 JavaScript ESM의 런타임 중립 참조 코어로 순수 `decide`/`reduce`/`replay`, CAS 선택 선점, 같은 턴 경계 1→2, 정확한 패킷·리비전·옵션 해석, CSPRNG 토큰과 constant-time fingerprint 검증을 구현했다.
- T-007b-A는 Swift 제품 영속 커널과 SQLite WAL/`synchronous=FULL`/외래 키/`BEGIN IMMEDIATE` 트랜잭션, 프로세스 간 CAS, crash replay, 런타임 이벤트 MAC chain·인증된 head anchor, packet/verification row-bound HMAC, 외부 32-byte 키와 strict v1 ingress를 구현해 조건부 완료했다. exact packet/seal/selection/action/verification binding, exact Int64, DB·키 손실, `sqlite_schema`·trigger 변조, 필수 contract pin, test-only crash gate, `openat` 기반 키 경로와 commit 뒤 replay도 fail-closed로 검증했다.
- T-007b-A2는 OS Keychain의 strict `initializing`/`committed`/`pending` freshness record, 불변 DB identity와 generation/sequence/head, `kSecAttrGeneric` digest CAS, process mutex와 `0600` `flock`을 구현해 조건부 완료했다. 과거 authentic DB snapshot, DB·키 손실, anchor 누락은 event 반환 전에 fail-closed하며 `pending + target DB`는 전체 인증 replay 뒤에만 committed로 승격한다. `pending + source DB`는 자동 취소하지 않고 정확히 같은 canonical batch 재시도만 허용한다.
- T-007b-B1은 T-007a의 12개 이벤트 replay/projection과 11개 command 의미를 Swift로 포팅하고 `load → replay → decide → candidate replay → atomic append` application 경계를 구현해 조건부 완료했다. 제품 NDJSON은 `execute_command`만 노출하고 raw `append`는 test-harness compile flag에서만 빌드된다. latest revision·stale·expiry·rollback-disabled·reseal, 토큰 1회 발급·비영속, CAS 2회 한정 재시도와 응답 유실 뒤 재발급 금지를 검증했다.
- T-007b-B2는 세션별 대기 상호작용 하나를 semantic seal/replay 양쪽에서 원자적으로 강제하고, 여러 세션 queue와 명시적 전면 카드 하나, exact foreground selection, `mach_continuous_time` 기반 60초 reminder·120초 만료·300초 in-flight timeout scheduler를 구현해 조건부 완료했다. Pet/형식 보정 token consume·claim과 transport completion도 연속 단조 logical time으로 제한한다. 새 카드는 전면을 선점하지 않으며 재시작 뒤 증명할 수 없는 pending/unterminated/token claim 상태는 fail-closed하고 foreground는 복원하지 않는다.
- T-007b-A/A2는 공개 운영 승인이 아니다. 기존 DB·키에 anchor가 없으면 과거 상태의 자동 신뢰를 막기 위해 migration/adoption하지 않고 차단한다. 현재 unsigned CLI는 entitlement 부재로 legacy login Keychain을 사용하며, 서명된 wrapper와 Data Protection Keychain/access group·`LAContext` 전환은 T-012에 남는다. 같은 UID 공격자가 Keychain까지 삭제·교체하거나 DB·키·anchor를 동시에 제거하는 경우는 A2만으로 구분하지 못한다.
- T-007b-C는 조건부 완료다. 실제 Codex CLI `0.149.0`과 M0 fake coordinator의 격리 픽스처에서 같은 session·turn·episode lineage의 결정 두 번이 `boundary_sequence` 1→2로 진행됐고, 별도 Swift 제품 게이트는 같은 lineage의 경계 두 개를 16개 이벤트로 영속·재생했다. 두 시험을 합쳐 T-007의 반복 상태 계약은 완료로 판정한다. Hook·MCP·Pet을 Swift 제품 코디네이터에 직접 연결하는 고수준 adapter·UDS·플러그인 패키징은 T-011에 남는다.
- T-011은 Codex Plugin의 Skill·4개 Hook·MCP, Swift 고수준 운영 application, Pet `get_state`/full-selection API와 단일 UDS owner를 구현했다. 실제 Codex CLI `0.149.0`의 격리된 플러그인 설치·업데이트·제거와, Keychain 없는 실제 SQLite/Swift 제품 구성요소를 통한 Hook→MCP→Stop→Pet 두 경계 1→2 결합 왕복이 통과했다. open/seal·selection·completion·scheduler의 pre/post-commit 부분 실패는 journal authority 재조정, retained monotonic anchor, token 비재발급과 exactly-once terminal 회귀로 고정했다. 로그인 Keychain을 사용하는 제품 daemon과 수동 Hook 신뢰 검토가 남아 있어 `in_progress`로 유지한다.
- T-010은 SwiftUI 기반 비활성 floating `NSPanel`, 다중 세션 카드와 명시적 foreground, 반고정 1·2·3·4 표시, 만료·위험 확인, 안전 범위의 단축키 설정 UI·동적 label과 PermissionRequest 알림을 구현했다. 활성 단축키 변경의 일부 등록 실패도 전체 후보를 폐기하고 이전 설정/binding으로 복원한다. 실제 WindowServer 1차 qualification에서 호스트 active/key/focus 유지, 비활성 Picker, 취소·격리 저장/재시작, 실제 Carbon 충돌, frame exact 왕복, 14-field focus와 16-field select를 통과했다. 발견한 접기/펼치기 위치 점프는 lower-trailing anchor 보존으로 수정했다. Pet 35/35, Operational 14/14, Routing 필터 18/18(Routing 16 + Pet 2), Swift package XCTest 5/5 + Swift Testing 106/106가 통과했다. 다중 디스플레이 이동·분리, Spaces/전체 화면, 물리 전역 키·키보드 레이아웃, 실제 호스트 앱 복귀와 실시간 60/120초 검증이 남아 있어 `in_progress`로 유지한다. 권한 요청의 원래 PID/창 identity가 없어 polling 시점 frontmost 앱으로만 best-effort 복귀하는 한계와 앱 번들/서명/DMG는 후속 범위다. 현재 operational 제안은 risk `info`, 빈 evidence, unavailable checkpoint, rollback disabled만 생성하므로 고위험 확인·채워진 상세·활성 롤백은 fixture 안전 경로만 검증됐다.
- T-008의 `done`은 운영체제 임시 디렉터리 아래 합성 Git 픽스처 범위다. 실제 사용자 프로젝트에서 롤백을 활성화했다는 뜻이 아니다.
- Blabee는 Pet 선택을 사람이 제출한 `UserPromptSubmit`으로 보내지 않는다. 공식 Stop Hook의 `reason`은 모델에는 새 사용자 프롬프트처럼 작동하는 continuation prompt이며, `0.149.0` 격리 픽스처에서는 별도의 사람이 제출한 `UserPromptSubmit` 없이 같은 session·turn lineage가 유지됐다. 이 동작은 exact-version 계약 테스트 대상이다.
- T-003은 `0.148.0`의 한 결정 사이클 증거이고 T-007b-C는 `0.149.0`의 두 결정 사이클 증거다. `0.148.0` 반복 두 사이클과 `0.149.0` 제품 지원 승인은 아직 없으며, 제품 Hook→Swift 연결은 T-011에서 검증한다.
- 설명 전용 실제 계약은 결정 제안·대기 없이 `M0_EXPLAINED`로 종료되고 파일을 만들지 않았다. M0 조건부 승인은 이 음성 계약을 포함하지만 실제 사용자 작업공간이나 공개 MVP 승인은 아니다.

## 권장 담당

- 연구 및 디버깅 담당자: T-001~T-005, T-014
- 기획자/API 플랫폼 엔지니어: T-006
- 백엔드/시스템 구현 담당자: T-007~T-009
- macOS 프런트엔드 구현 담당자: T-010
- DevOps/출시 엔지니어: T-011, T-012
- QA 검토 담당자: T-013과 출시 통과 기준
