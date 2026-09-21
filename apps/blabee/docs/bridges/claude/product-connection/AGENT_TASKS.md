# 구현 작업과 소유권

CP-07의 runtime·업데이트 보호 구현·관련 격리 검증을 마쳤다. CP-08은 [통합 Blabee 앱/DMG](UNIFIED_DISTRIBUTION.md)의 구현·서명·설치 전 검증을 완료했다. 별도 Preview 검증은 역사적 기록으로만 보존한다. 실제 설치·동시 사용·모델·사용자 클릭·장시간 수용은 남아 있다. 일반 plugin 패키징·launcher source 전환과 일반 Channels 승인은 별도 후속 조건이다. 아래 구현 담당은 **책임 역할**이며 다른 후속 단계가 이미 실행 중이라는 뜻은 아니다. 세부 범위/의존성은 [구현 계획](IMPLEMENTATION_PLAN.md)을 따른다.

| ID | 담당 역할 | 소유 파일/책임 | 상태 |
| --- | --- | --- | --- |
| CP-00 | lead_orchestrator + researcher/planner/code_mapper/qa_reviewer | 이 문서 묶음, source/official research, 설계 검토 | 완료 |
| CP-01A | Swift implementer | `ClaudeSessionAuthority.swift`, `SessionAuthorityTests.swift` 신규 두 파일. root가 문서/전체 회귀, 별도 reviewer가 API·경합 검토 | 구현·검증 완료 |
| CP-01B | 계약 implementer + root + reviewer | implementer: `Contracts/bridge/`·`ClaudeProductWireCodec.swift`·Swift 테스트·공유 fixture. root: Node schema 검증·runner·문서·전체 회귀. reviewer: 읽기 검토. 기존 `Contracts/v1` 유지 | 구현·검증 완료 |
| CP-02 | native service implementer + root + reviewer | Enrollment/Registry/MetadataStore/ProductServiceCoordinator 신규 파일과 관련 테스트, `main.swift` 공통 서비스 조립. 아래 파일 소유권을 따름 | 구현·격리 검증 완료 |
| CP-03 | 세션 수명 implementer + root + reviewer | authority 주입, renewal/revoke/control, NativeSession/BridgeIngress 및 owner fixture. 아래 소유권을 따름 | 구현·관련 격리 검증 완료 |
| CP-04 | lifecycle/metadata/bridge implementer + root + reviewer | native compact/StopFailure·cache/timer, metadata v2 tombstone, v2 Channel cursor·Pet 중복 제한 | 구현·관련 격리 검증 완료 |
| CP-05 | launcher/bridge implementer + root + reviewer | native launcher·실제 자식/TTY·session v2 client·Hook/MCP·정확한 Channel source | 구현·관련 격리 검증 완료 |
| CP-06 | Pet/registry/bootstrap implementer + root + reviewer | ProviderTransport·공통 Pet 모델/뷰/시작/확인/해제·selector routing | 구현·관련 격리 검증 완료 |
| CP-07 | 제품/배포 implementer + root + reviewer | RuntimePayload·앱 build manifest·Node·update/lease guard; 일반 Channels 배포 승인 분리 | runtime/update·preview 검증 완료 / 일반 plugin 후속 |
| CP-08 | native/packaging implementer + root + reviewer + 사용자 실제 클릭 | 하나의 앱/DMG·AC-01~16·G1~G5별 증거·현재/미확인 구분 | 통합 후보 구현·서명·설치 전 검증 완료 / 실제 수용 대기 |
| CP-08 자동 연결 | launcher/registry/Node/shell implementer + root + reviewer | 일반 claude/resume·관측 후 등록·관리 zsh 설정·관련 회귀·r63 후보 | 구현·격리 회귀 완료 / 새 후보 실제 수용 대기 |

공유 파일은 각 단계에서 한 담당자만 쓴다. 다음 담당자는 앞 단계 diff와 테스트 결과를 인계받는다. `main.swift`, UDS, NativeSession, Pet 공용 모델, build/업데이트 파일은 특히 병렬 편집하지 않는다. 다른 작업자의 기존 변경을 되돌리거나 broad-stage/checkout/stash하지 않는다.

CP-02의 현재 소유권:

- enrollment 담당: 신규 `ClaudeSessionEnrollment.swift`와 `ClaudeSessionEnrollmentTests.swift`. 서명된 private peer, 연결 challenge, 일회용 grant FD 전달과 정리.
- metadata 담당: 신규 `ClaudeSessionMetadataStore.swift`와 `ClaudeSessionMetadataStoreTests.swift`. 별도 인증 저장소, prepare/finalize, crash/rollback/이력 검증.
- root: 신규 `ClaudeSessionRegistry.swift`, `ClaudeProductServiceCoordinator.swift`와 registry/service 테스트, `main.swift` 조립, `StorageKey.swift`·`StorageProcessLock.swift`의 필요한 `package` 접근 선언, 테스트 runner와 문서. 공용 파일 편집은 root만 한다.
- reviewer: 읽기 검토. 기존 Codex/v1 계약·설치 앱·실제 세션과 CP-03 자동 갱신/CP-05 launcher는 이번 적용 대상이 아니다.

각 작업 인계에는 적용 전 기준점, 변경 파일, 실패/통과한 관련 검증, 남은 위험을 적는다. 이미 dirty인 파일의 전체 diff를 자기 작업으로 보고하지 않는다. 독립 commit이 필요하면 사용자와 합의한 별도 worktree 또는 명시적 변경 전달 방식을 사용한다.

CP-03의 소유권과 기준점:

- native 담당: `ClaudeNativeSession.swift`, `ClaudeBridgeIngress.swift`, 제품 권한 journal wrapper와 `ProductAuthorityIntegrationTests.swift`. 같은 authority/clock 주입, native/core ID 분리, append 직전 fence와 v2 DTO 변환.
- owner 담당: `ClaudeSessionEnrollment.swift`와 관련 테스트, 신규 `ClaudeOwnerRenewalController.swift`와 테스트. 기존 private 연결의 renew/end, owner의 5분 갱신 controller. 설치 launcher는 CP-05다.
- root: `ClaudeSessionRegistry.swift`, `ClaudeProductServiceCoordinator.swift`, UDS의 새 type 허용·입력 비밀값 검사, `SQLiteJournal`의 opt-in COMMIT gate, registry/통합 fixture·runner·문서. 공용 파일은 root만 편집한다.
- reviewer: 잠금/fence·회수·격리 읽기 검토. core/v1 계약·기존 Codex·설치 앱·실제 세션은 유지한다.
- 변경 전 기록: `claude/build/cp03-baseline-zqmvm74i/`의 925개 파일 hash와 Git 상태. 기존 변경을 되돌리거나 staging하지 않는다.

CP-01 완료 후의 기본 순서는 CP-02→03→04→05→06→07→08이다. 외부 채널 승인 준비는 소스 편집과 독립적으로 조사할 수 있으나 제3자 연락·게시·설정 적용은 이번 설계 범위에 포함하지 않는다.

CP-04의 소유권과 기준점:

- native 담당: `ClaudeNativeSession.swift`, `ClaudeBridgeIngress.swift`, `ClaudeCoreAdapter.swift`, `ClaudeNativeReplayPort.swift`, 공통 native/lifecycle 테스트. 수명 관측·durable replay 포트·rate window·읽기 cache와 due API.
- metadata 담당: `ClaudeSessionMetadataStore.swift`와 관련 테스트. v2 audit/파생 lookup, streaming 검증, v1 history-only 호환, 삭제·rollback·재생 차단.
- bridge 담당: 명시적 v2 lifecycle/channel helper와 Node 테스트, `ClaudePetTransport.swift`와 테스트. 현재 카드/전달 cursor만 보관하고 기존 v1 launcher를 암묵적으로 바꾸지 않는다.
- root: 제품 bridge schema/codec/공유 fixture, registry/service의 replay·timer 조립과 통합 테스트, runner·문서·전체 검증. reviewer는 읽기 검토만 한다.
- 변경 전 기준점: `claude/build/cp04-baseline-ygujs80_/`의 930개 파일 hash와 Git 상태. core `Contracts/v1`, 설치 앱, 실제 세션은 보존한다.

CP-05의 소유권과 기준점:

- native 담당: `ClaudeInstalledLauncher.swift`, `ClaudeInstalledLaunchConfiguration.swift`, launcher 테스트. private owner client·grant·갱신·자식/TTY·환경·설정·충돌 진단. 기존 enrollment의 서명 확인 helper만 재사용하도록 접근 범위를 조정했다.
- Node 담당: 신규 `session-v2-context/client/hook/tools/mcp.mjs`와 두 테스트. 기존 v1 파일을 유지하면서 CP-04 정규화기·poller를 실제 UDS와 stdio MCP에 연결했다.
- root: native CLI·entrypoint·manifest, 제품 Channel wrapper 바인딩, 생성 설정 기반 실제 Hook/MCP 및 PTY 통합 fixture, runner·문서·직렬 검증. reviewer는 공식 CLI 동작과 파일 간 연결을 읽기 검토했다.
- 기준점: `build/claude-tests/cp05/baseline.json`의 537개 파일 hash와 `status-before.txt`. 생성물·로그는 같은 CP-05 build 폴더에 격리했다. 실제 모델·설치 앱·사용자 설정을 변경하지 않았다.
- 시작 시 최초 probe의 자동 요청은 Hook/MCP 준비 관측과 함께 CP-06 조립에서 연결한다. CP-05는 명시적인 연결 확인 도구를 제공한다.

CP-06의 소유권과 기준점:

- bootstrap/launcher 담당: 기존 앱 수명 pipe의 selector bootstrap과 프로젝트 chooser·bundle 후보 경로·Terminal 진입 조립, 관련 테스트.
- registry/native 담당: 인증된 Pet selector 포트, 읽기 전용 목록·projection, 최초 readiness 1회, 서비스 UDS 통합 테스트.
- UI 담당: 공통 모델·provider 선택/확인/해제·상태·단축키/비동기 context 검사와 transport/UI fixture.
- root: 앱 전용 인증·directory 계약·provider transport·서비스/화면 조립·manifest·격리 runner·문서와 직렬 검증. reviewer는 읽기 검토를 맡았다.
- 기준점: `build/claude-tests/cp06/baseline.json`의 555개 파일과 `status-before.txt`. 운영 앱·세션·DB·사용자 설정과 기존 Codex source/core 계약을 보호한다. 설치 패키징·실제 모델 수용은 CP-07/08에 남긴다.


CP-07의 소유권과 기준점:

- payload 담당: 신규 `ClaudeRuntimePayload.swift`, `ClaudeRuntimePayloadUse.swift`와 격리 fixture. descriptor 검증·원자적 불변 사본·durable 사용 기록·설치 admission.
- packaging 담당: 준비/Node 서명 helper와 app assembler, 관련 Node 테스트. 기존 assembly v2 형식을 유지하고 preview 일반 배포를 거절한다.
- update 담당: 설치/업데이트 guard와 관련 Swift 테스트. legacy/v1·신규 설치·publish/rollback에 같은 Claude guard를 적용한다.
- root: signed descriptor pin·native/Pet launcher 조립·실제 Hook/MCP/PTY fixture·runner·dogfood 인자·manifest·문서·직렬 검증. 별도 reviewer는 읽기 검토만 한다.
- 기준점: `build/claude-tests/cp07/baseline.json`의 581개 파일과 `status-before.txt`. 기존 미커밋 정리 변경과 합산하지 않는다. 운영 앱·세션·사용자 설정·자격·DB를 보존한다.

CP-08의 소유권과 기준점:

- packaging 담당: app assembler·Node/앱 signing helper·내부 preview CLI와 관련 Node 테스트. 일반 release 경로와 제품 peer 인증은 유지한다.
- root: 실제 후보 서명·저장소 밖 산출물 검사·수용 문서·결과 기록. reviewer는 CLI/설치 조건과 서명 경계의 읽기 검토를 맡는다.
- 기준점: `build/claude-tests/cp08/baseline.json`의 439개 대상 파일과 `status-before.txt`. 실제 설치·기존 세션 종료는 후보 검증과 구분한다.

CP-08 자동 연결의 소유권과 기준점:

- launcher 담당: observe mode·private bootstrap·TTY/자식 수명·생성 Hook/MCP 인자, 이후 별도 r63 패키징/서명 검사.
- registry 담당: private `enroll_observed` 계약·codec·등록/수명·동일 대화의 독립 scope 회귀.
- Node 담당: bootstrap client·auto Hook/MCP·취소 경계·기존 session-v2 연결 재사용.
- shell 담당: 관리 PATH shim·zsh 설정의 원자적 추가/제거·충돌 검사와 테스트.
- root: CLI 분류·공통 UI·Package.swift·runtime allowlist/준비 스크립트·PTY 통합·문서·직렬 검증. reviewer는 읽기 검토만 수행.
- 기준점: `build/claude-tests/auto-connect/baseline.json`의 406개 파일과 `source-before/`. 운영 앱·셸·인증 파일·세션·DB는 변경하지 않는다.
