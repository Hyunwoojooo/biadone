# 디렉터리 정리 후 Swift 검증 오류 수정 — 2026-09-20

## 범위

작업 위치는 `/private/tmp/blabee-layout-20260920/apps/blabee`다.
설치 앱·사용자 세션·운영 DB·사용자 Keychain은 변경하지 않았다.
실제 저장소가 필요한 검증은 기존 테스트의 임시 디렉터리와 테스트 namespace만 사용한다.
모듈명, target, product, 공개 API, 저장 schema는 유지한다.

이 기록은 [최초 이동 검증](SWIFT_LAYOUT_VALIDATION.md)의 남은 실패를 후속 수정한 결과다.
처음 비교에서 같은 실패가 관찰됐다는 사실과 이번에 원인을 확인해 수정한 결과를 구분한다.

**기본 명령의 전체 Swift 검증은 테스트 파일 제외 없이 exit 0으로 통과했다.**
XCTest 5개, 공통 엔진 Swift Testing 217개, Pet·Claude Swift Testing 1,295개가 통과했다.
기존 opt-in 검사 3개는 기존 실행 조건대로 건너뛰었으며 새로 생략한 검사는 없다.

## 확인한 원인과 수정

### 기본 Swift 테스트의 registry 관찰 속성 참조

`ClaudeSessionRegistryTests.registryDrainTime()`은 항상
`registry.hasScheduledTimeWork`를 참조하지만, 해당 내부 읽기 전용 속성은
`#if BLABEE_JOURNAL_TEST_HARNESS` 안에 있었다. 기본 `test:swift` 명령은 이 define을
설정하지 않는다. 원래 HEAD와 최초 baseline 복사본의 해당 제품 파일은 바이트 동일했다.
따라서 오래된 복사본에 속성이 빠진 문제가 아니라 조건부 컴파일의 불일치였다.

기존 속성의 조건부 guard 두 줄만 제거했다. 속성을 중복 추가하거나 테스트를 제외하지 않았다.
스케줄러·큐·잠금 동작은 유지하며, 제품 경로에서 이 관찰 속성을 새로 호출하지 않는다.
해시와 원래 조건부 구간은 다음 파일에 기록했다.

```text
/private/tmp/blabee-layout-followup-registry-compile-evidence.json
```

### SQLite claim·receipt·dismissal fixture의 만료 시간

공통 routing 정책은 600초를 요구하지만 `sqliteClaimPacket()`은 120초짜리 packet을
직접 만들고 있었다. 이 때문에 실제 claim·receipt·dismissal 검증 전에
`routing_packet_expiry_interval_invalid`로 중단됐다.

같은 파일의 fixture가 `RFC3339Instant`와
`CoordinatorRoutingApplication.expiryAfterNanoseconds`로 만료값을 생성하도록 바꿨다.
중복 claim 거부, 동시 경쟁의 단일 승자, 원자적 receipt, I/O 수 검증은 유지한다.

### 연결 상태의 카드 수신과 Hook 신뢰

연결 요약은 카드 수신과 Hook 신뢰를 별도 근거로 다룬다. 기존 테스트는 Hook을
검사하지 않고 카드 수신만으로 `.receiving`을 기대했다.

테스트에 프로젝트 Hook 검사를 위한 가짜 관리자를 주입했다. 카드가 수신돼도
Hook이 `.unchecked`이면 요약은 `.awaitingVerification`이고 카드 항목만 `.confirmed`임을
먼저 검증한 뒤, 명시적인 Hook 검사 완료 후 `.receiving`으로 바뀌는 것을 검증한다.
서비스·Plugin 설치·프로젝트·카드 이력 검증은 유지하며 실제 Hook 설정을 변경하지 않는다.

### 작은 한국어 badge OCR의 확대 왜곡

기존 렌더 PNG로 재현한 결과, 원본 해상도의 Vision은 `권장`을 읽었지만 3배 확대 후에는
같은 영역을 `권창` 등으로 읽었다. UI 문구가 사라진 사례가 아니었다.
기존 전체 OCR이 실패할 때 원본 픽셀에서도 정확한 `권장` 문자열을 확인하게 했다.
제목 좌표·그리드·스크롤·건너뛰기 버튼 검증과 exact-text 조건은 유지한다.

```text
/private/tmp/blabee-layout-ocr-probe.swift
/private/tmp/blabee-layout-ocr-probe.log
```

### Claude canonical 경로 fixture

별도 Claude 구현 변경은 launcher와 Swift의 canonical 경로를 POSIX `realpath`로
일치시킨다. 이에 맞춰 Registry와 Pet transport fixture도 생성된 프로젝트의 `realpath`
원문 문자열을 사용한다. 특히 POSIX `mkdir`로 NFC 한글 이름을 만들고 이를
`URL.path`로 되읽으면 NFD 자모로 바뀌어 물리 경로와 바이트가 달라지는 것을 재현했다.
Registry fixture는 URL로 다시 감싸지 않고 원문 문자열을 owner·Hook·session 요청에 넣는다.
한글 폴더 검증 자체는 유지했다.

Pet transport의 제품 초기화에도 Foundation 표준화 비교가 남아 있음을 발견해
Claude 담당자에게 전달했다. 해당 변경은 표시용 경로 문법 검사만 공통 helper로
일치시키며, 활성 디렉터리의 `realpath` 검증은 native grant·registry에서 유지한다.
별도 Claude 제품·bridge 검증 기록과 함께 확인한다.

```text
/private/tmp/blabee-layout-canonical-probe.log
```

## 검증 명령과 결과

검증은 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`,
공용 `/tmp/blabee-coordinator-swift-tests.lock`,
`--experimental-maximum-parallelization-width 1 --no-parallel`을 사용한다.
기존 컴파일 오류 파일을 제외하지 않고 실제 root manifest를 사용한다.

먼저 새 scratch `/private/tmp/blabee-layout-followup-swift-build`에서 다음 필터를 실행했다.

```text
sqliteQueuedActionClaim|sqliteReceiptCompletionBatchPreservesQueuedClaim|sqliteDismissalJournalBudgetWithAuthenticatedHistory|PetAirViewTests|petConnectionReadiness|ClaudeSessionRegistryTests|ClaudePetTransportTests
```

로그: `/private/tmp/blabee-layout-followup-swift-targeted.log`

이 실행은 기본 컴파일에 성공했고 SQLite 5 tests(매개변수로 6개 케이스),
Air 3 tests, 연결 상태 관련 4 tests가 통과했다. Claude 경로 소비 지점과 fixture가
불일치해 실패한 그룹은 위 후속 경로 수정 후 따로 재검증했다.
최초 실행의 실패 기록을 지우거나 전체 통과로 바꾸지 않는다.

`ClaudeSessionRegistryTests|ClaudePetTransportTests` 재실행은
**35 tests / 2 suites, exit 0**, 5.651초에 통과했다.
로그: `/private/tmp/blabee-layout-followup-claude-fixtures.log`

코드와 fixture 수정이 끝난 2026-09-20 17:35:09 KST에 전체 Swift 입력 245개와
manifest 해시를 `/private/tmp/blabee-layout-followup-swift-final-inputs.json`에 기록했다.
최종 전체 실행에는 테스트 파일 제외나 새로운 테스트 생략 조건이 없다.

```sh
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  BLABEE_AIR_RENDER_DIRECTORY=/private/tmp/blabee-layout-followup-air-renders \
  /usr/bin/lockf -t 0 -k -w /tmp/blabee-coordinator-swift-tests.lock \
  /usr/bin/xcrun swift test --package-path . \
  --scratch-path /private/tmp/blabee-layout-followup-swift-build \
  --experimental-maximum-parallelization-width 1 --no-parallel
```

전체 실행 로그: `/private/tmp/blabee-layout-followup-swift-full.log`

최종 전체 실행은 **exit 0, recorded issue 0**으로 종료했다.

| 검증 | 결과 |
| --- | --- |
| SemanticReplayTests (XCTest) | 5 tests / 0 failures |
| CoordinatorSwiftTests (Swift Testing) | 217 tests / 0 issues, 77.538초 |
| BlabeePetTests (Swift Testing) | 1,295 tests / 76 suites / 0 issues, 397.328초 |
| Metadata 1,000 durable replay 소비 | 통과, 342.202초 |
| 실행 전후 Swift·manifest 입력 | 246개 해시 동일, 실행 중 코드 변경 없음 |

기존 조건부 opt-in 검사 중 다음 3개는 활성화하지 않았다.

- 실제 Keychain 복구: 별도 opt-in용 고유 테스트 항목의 복구 검사.
- SQLite receipt 1,200개 history 성능 측정.
- 현재 설치된 Codex와 실제 동작을 확인하는 runtime 검사.

이는 기본 suite 결과이며 별도 harness define으로만 생성되는 통합 검사나
사용자 앱을 사용하는 실사용 검증까지 수행했다는 의미는 아니다.
전체 실행은 한 번 수행했고 정상 종료 후 공용 테스트 잠금이 해제됐다.

## 변경 파일

- `Tests/swift/CoordinatorSwiftTests/SQLiteQueuedActionClaimTests.swift`: 현재 만료 정책의 fixture.
- `Tests/swift/BlabeePetTests/PetOnboardingTests.swift`: 카드·Hook 신뢰 근거 검증.
- `Tests/swift/BlabeePetTests/PetAirViewTests.swift`: 원본 픽셀 exact-text OCR 보완.
- `Tests/swift/BlabeePetTests/ClaudePetTransportTests.swift`: 실제 canonical cwd fixture.
- `Tests/swift/BlabeePetTests/ClaudeSessionRegistryTests.swift`: 한글 경로 바이트 보존 fixture.
- `bridges/claude/swift/session/ClaudeSessionRegistry.swift`: 내부 관찰 속성의 조건부 guard 제거.
  이 파일의 canonical 경로 구현 변경은 Claude 담당자와 소유 구간을 나눴다.

공통 target/product는 변경하지 않았다. 서명·패키징·원래 작업 경로 반영은 상위 작업에서
별도로 검증하며, 테스트 통과가 설치 앱·실제 Codex/Claude 왕복 검증을 대신하지 않는다.
