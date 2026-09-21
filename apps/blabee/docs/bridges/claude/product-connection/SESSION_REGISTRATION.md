# 공통 서비스의 Claude 세션 등록 — CP-02

2026-09-19. [제품 설계](TECH_SPEC.md)의 private enrollment·scope 등록·별도 metadata 저장소를 구현·격리 검증했다. 설치된 앱이나 실행 중인 Claude에 적용하는 단계는 아니다. 이후 [CP-03](SESSION_LIFETIME.md)에서 서비스의 v2 인증·owner 갱신을 연결했다. 설치 launcher와 실제 Hook/MCP v2 client는 CP-05다.

## 등록과 자격 전달

앱 소유 공통 서비스가 기존 Codex application 바깥에 `ClaudeProductServiceCoordinator`를 조립한다. Claude 초기화 실패 시 고정 진단을 남기고 Codex 경로를 계속 실행한다. 일반 daemon과 현재 개발용 native host에 새 등록 권한을 추가하지 않는다.

private owner endpoint는 일반 JSON UDS와 별도다. 실행 중인 launcher의 코드 서명·허용된 식별자/빌드와 peer process 수명을 검사하고, 연결마다 service incarnation·owner connection·challenge·grant pipe ID를 발급한다. 공개 runtime identity나 같은 사용자라는 사실만으로 등록을 허용하지 않는다. unsigned peer 주입은 `BLABEE_JOURNAL_TEST_HARNESS` 빌드에만 존재한다.

owner는 그 연결에서 받은 challenge와 등록 요청, 쓰기 가능한 일회용 anonymous pipe FD 하나를 보낸다. service가 scope·native session·session incarnation·core IDs·authority epoch를 생성하고, 저장소 준비가 확정된 뒤 Hook·bridge·owner 자격을 그 pipe에 한 번 전달한다. 일반 응답에는 자격을 싣지 않는다. selector 자격은 이 grant에 포함하지 않으며 앱/UI 전용 bootstrap은 CP-06에서 연결한다.

여기서 1회 소비는 연결의 challenge·논리 `grant_pipe_id`·grant writer 호출과 수신 FD 정리를 뜻한다. 재활용될 수 있는 kernel pipe handle을 영구 식별자로 저장하지 않는다. 새로운 인증된 연결의 새 등록까지 물리 pipe의 과거 사용 이력으로 거부하지 않는다. CP-05 launcher는 등록마다 새 pipe를 만들고 read-end를 Claude 자식에게 상속하지 않아 우발적인 다른 세션 전달을 방지해야 한다.

전달 실패나 응답 유실 뒤에는 자동 등록 재시도/자격 재전달을 하지 않는다. owner 연결의 종료는 해당 scope만 회수하며 다른 Claude나 Codex 프로세스를 종료하지 않는다. 등록 직후 상태는 `awaitingNativeStart`다. 등록 성공만으로 모델 관측·채널 ACK·선택 실행 권한이 성립하지 않는다.

현재 제품 endpoint가 허용하는 Channel source는 검증 대상 standalone `blabee-claude`다. 승인된 plugin source는 실제 패키지/시작 조합을 검증한 뒤 명시적으로 추가해야 한다. 생성할 launcher는 동일한 서명된 실행 파일의 native 진입점을 사용해야 현재 peer 정책과 일치한다.

2026-09-21 추가된 [터미널 자동 연결](AUTO_CONNECT.md)은 첫 실제 `SessionStart` 이후
`enroll_observed`로 등록한다. Claude가 고른 native ID와 시작 source를 보존하고,
서버는 새 scope·incarnation·epoch·core IDs·역할 자격을 발급한다. typed 초기 관측을
한 번 소비해 native 시작만 확인하며 prompt boundary나 readiness ACK를 만들지 않는다.
대화 선택 화면에서 대기·취소한 경우에는 등록 자체가 없다. 같은 native 대화를 새
프로세스에서 재개해도 이전 Blabee 권한이나 선택을 복구하지 않는다. 위 기존 `enroll`의
`awaitingNativeStart` 경로는 앱 버튼의 fixed-ID 시작에 계속 사용한다.

## 저장과 복구

서비스가 선택한 `claude-product/scopes/<발급 scope UUID>/` 아래에 scope별로 다음을 둔다. 요청에는 DB 경로·키 경로·freshness account를 받는 필드가 없다.

```text
scope/
  core/coordinator.sqlite3
  core/coordinator.key
  metadata/metadata.sqlite3
  metadata/metadata.key
```

core와 metadata는 키 부모·파일 잠금·freshness account를 분리한다. registry root와 DB별 writer authority도 소유한다. scope 디렉터리는 0700, 새 core DB와 metadata/키 파일은 0600으로 유지한다. 기존 Codex `primary` account와 `Contracts/v1`·strict core SQLite schema는 유지한다. HMAC과 잠금 구현은 기존 `SidecarAuthenticator`/`StorageProcessLock`를 같은 Swift package 내부에서 재사용하며 원시 키 바이트를 공개하지 않는다.

metadata는 별도 versioned SQLite다. 발급 identity와 canonical cwd/Channel source/core IDs/runtime identity, operation UUID, 원래 binding과 core checkpoint를 인증한다. native prompt 원문·Channel 본문·role token·nonce는 저장하지 않는다.

[CP-04](SESSION_LIFECYCLE.md)는 새 저장소를 metadata v2로 생성하고 prompt/proposal/selection/Hook 재생 방지 기록과 파생 lookup을 추가한다. lookup은 HMAC 이력의 sequence·행 수와 대조한다. 일반 mutation/summary는 이력을 순차 검증하고 전체 배열을 만들지 않는다. v1은 migration 없는 history-only 읽기로 유지한다.

쓰기 순서는 **metadata prepared와 freshness 확정 → core 호출 한 번 → metadata finalized와 freshness 확정 → grant/성공 응답**이다. 두 DB를 하나의 원자적 트랜잭션으로 취급하지 않는다. 중간 실패나 pending·변조·과거 파일 rollback은 해당 scope를 격리하며, core 호출을 다시 실행해 복구하지 않는다. registration은 core DB 최초 생성도 이 순서 안에서 수행한다.

재시작한 registry에는 살아 있는 등록이 없다. metadata는 history-only로 열고 인증된 core checkpoint와 매핑을 대조한다. 이력 조회는 `journal.load()`와 순수 replay만 사용하며 routing application·snapshot/timer를 실행하지 않는다. 정상 매핑이 있어도 옛 grant·authority·claimed 결과 보고 권한을 복원하지 않는다.

이력 조회는 별도 잠금으로 직렬화하며 다른 scope의 종료·권한 회수를 막는 registry 잠금을 저장소 I/O 동안 잡지 않는다. 활성 scope의 폴더 이동/누락과 남아 있는 scope의 metadata 누락은 격리한다. 서비스가 재시작하기 전에 scope 폴더 전체가 삭제됐다면 현재의 디렉터리 열거만으로 사라진 이력의 존재까지 알아내지는 못한다. 이 경우에도 권한은 복원되지 않는다.

## 코드와 검증

- [private endpoint](../../../../bridges/claude/swift/session/ClaudeSessionEnrollment.swift)
- [registry와 scope factory](../../../../bridges/claude/swift/session/ClaudeSessionRegistry.swift)
- [metadata store](../../../../bridges/claude/swift/session/ClaudeSessionMetadataStore.swift)
- [공통 서비스 dispatcher](../../../../bridges/claude/swift/service/ClaudeProductServiceCoordinator.swift)
- [등록 테스트](../../../../Tests/swift/BlabeePetTests/ClaudeSessionEnrollmentTests.swift), [registry 테스트](../../../../Tests/swift/BlabeePetTests/ClaudeSessionRegistryTests.swift), [metadata 테스트](../../../../Tests/swift/BlabeePetTests/ClaudeSessionMetadataStoreTests.swift)

`claude/`에서 다음 명령은 격리 Swift 테스트와 기존 제품 ingress/native-session 회귀를 실행한다. fixture만 in-memory freshness와 테스트 peer 검증기를 사용하며 제품 Keychain을 변경하지 않는다.

```sh
npm run test:product-registration
```

검증 결과는 [작업 상태](TASK_STATUS.md)에 기록한다. 실제 서명된 owner와 설치 서비스의 연결, 장시간 모델 사용·앱 UI·일반 배포는 후속 검증이다. 공통 일반 UDS의 session v2는 CP-03에서 scope와 Hook/bridge capability를 검증해 전용 handler로 전달한다. 일반 UDS에는 owner 등록·갱신 권한을 주지 않으며 기존 v1 native/저수준 경로로 대체하지 않는다.
