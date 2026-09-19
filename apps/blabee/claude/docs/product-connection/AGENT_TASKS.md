# 구현 작업과 소유권

CP-04까지 소스 구현과 관련 격리 검증을 마쳤다. 다음 단계는 CP-05다. 아래 구현 담당은 **책임 역할**이며 다른 후속 단계가 이미 실행 중이라는 뜻은 아니다. 세부 범위/의존성은 [구현 계획](IMPLEMENTATION_PLAN.md)을 따른다.

| ID | 담당 역할 | 소유 파일/책임 | 상태 |
| --- | --- | --- | --- |
| CP-00 | lead_orchestrator + researcher/planner/code_mapper/qa_reviewer | 이 문서 묶음, source/official research, 설계 검토 | 완료 |
| CP-01A | Swift implementer | `ClaudeSessionAuthority.swift`, `SessionAuthorityTests.swift` 신규 두 파일. root가 문서/전체 회귀, 별도 reviewer가 API·경합 검토 | 구현·검증 완료 |
| CP-01B | 계약 implementer + root + reviewer | implementer: `Contracts/bridge/`·`ClaudeProductWireCodec.swift`·Swift 테스트·공유 fixture. root: Node schema 검증·runner·문서·전체 회귀. reviewer: 읽기 검토. 기존 `Contracts/v1` 유지 | 구현·검증 완료 |
| CP-02 | native service implementer + root + reviewer | Enrollment/Registry/MetadataStore/ProductServiceCoordinator 신규 파일과 관련 테스트, `main.swift` 공통 서비스 조립. 아래 파일 소유권을 따름 | 구현·격리 검증 완료 |
| CP-03 | 세션 수명 implementer + root + reviewer | authority 주입, renewal/revoke/control, NativeSession/BridgeIngress 및 owner fixture. 아래 소유권을 따름 | 구현·관련 격리 검증 완료 |
| CP-04 | lifecycle/metadata/bridge implementer + root + reviewer | native compact/StopFailure·cache/timer, metadata v2 tombstone, v2 Channel cursor·Pet 중복 제한 | 구현·관련 격리 검증 완료 |
| CP-05 | launcher/bridge implementer | `ClaudeInstalledLauncher.swift`, session v2 client·Hook/MCP, Terminal·예상 channel source | 미착수 |
| CP-06 | Pet implementer | ProviderTransport·공통 Pet 모델/뷰/시작/확인/해제·selector routing | 미착수 |
| CP-07 | 제품/배포 implementer | RuntimePayload·앱 build manifest·Claude plugin·update/lease guard | 미착수 |
| CP-08 | qa_reviewer + 사용자 실제 클릭 | AC-01~16, G1~G5별 증거·현재/미확인 구분 | 미착수 |

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
