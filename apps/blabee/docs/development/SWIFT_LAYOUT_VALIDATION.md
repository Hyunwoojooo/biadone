# Swift 디렉터리 이동 검증 — 2026-09-20

## 범위와 결론

검증 대상은 격리 worktree `/private/tmp/blabee-layout-20260920/apps/blabee`다.
제품 Swift 소스의 내용·모듈·실행 파일·의존성을 유지한 경로 정리를 확인했다.
설치 앱 교체, 사용자 서비스 실행·종료, 사용자 세션·DB·계정 Keychain 변경은 수행하지 않았다.

**제품 빌드는 성공했다. 전체 Swift 테스트는 기존 컴파일 오류 때문에 통과하지 못했다.**
그 오류 파일 하나를 별도 검증 복사본에서만 제외해 나머지를 실행했다.
최초 실행에서 드러난 76개 issue는 기존 HEAD를 같은 `/private/tmp` 환경으로 옮긴
복사본에서도 모두 재현됐다. 테스트명·매개변수·파일명·오류 내용이 일치했다.
이는 원래 `/Users/joo/...` 환경에서의 전체 실행 결과가 아니다.
후속 조사에서 Claude metadata 66개 issue는 임시 경로 정규화의 fixture 이식성 문제로 확인했다.
fixture를 생성 후 정규화하도록 수정한 뒤 Metadata 그룹 24개 테스트는 모두 통과했다.
아래 최초 비교와 후속 좁은 재검증을 구분해야 하며 전체 테스트 통과로 해석하면 안 된다.

## 파일과 모듈 보존

[이동표](swift-file-moves.json)의 245개 항목을 manifest 결과와 대조했다.
모든 파일이 원래 target에 정확히 한 번 포함됐고 중복·누락이 없었다.

| Target | 파일 수 | 유지한 역할 |
| --- | ---: | --- |
| CoordinatorSwift | 26 | 공통 엔진과 기존 모듈에 속한 조정·Codex 정책 |
| ClaudeCoreAdapter | 7 | Claude 어댑터 |
| BlabeeProductSupport | 3 | 제품 설정·실행 지원 |
| BlabeeCoordinator | 99 | 기존 제품 실행 파일; fixture 지원 3개 포함 |
| CoordinatorSwiftTests | 9 | 엔진 테스트 |
| BlabeePetTests | 100 | 제품 테스트 |
| BlabeeSettingsTestHelper | 1 | 기존 테스트 실행 파일 |

- 제품 소스 135개 모두 기존 HEAD와 바이트가 동일했다.
- 전체 이동 파일 중 237개가 바이트 동일했다.
- 나머지 8개 테스트 파일은 `#filePath`의 루트 계산, 실제 Plugin fixture 위치,
  Claude metadata 테스트 생성물 위치와 생성 후 canonicalCWD 정규화만 조정했다.
- `internal`, `@testable`, 공개 API, Contracts/v1, 저장 schema를 변경하지 않았다.
- 제품에 포함되던 fixture 지원 3개도 기존 `BlabeeCoordinator` target에 남겼다.

루트 `Package.swift`의 Swift 입력은 명시된 파일 목록이다.
`path: "."`인 target이 문서, Node 의존성, 웹·개발 앱, 생성물까지 탐색하며
발생시킨 unhandled-file 경고를 선언적인 제외 목록으로 제거했다.
배포 소스 복사본에는 일부 지원 경로가 없으므로, **제외 경로만** 존재 여부를 확인한다.
Swift 소스 목록을 디렉터리 탐색으로 추가하거나 제외하지 않는다.
최종 제품 빌드 로그에는 unhandled-file/invalid-exclude 경고가 없었다.

## 실행 결과

모든 실제 빌드·테스트는 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`와
공용 `/tmp/blabee-coordinator-swift-tests.lock` 잠금을 사용했다.
테스트는 `--no-parallel --experimental-maximum-parallelization-width 1`로 실행했다.

| 검사 | 결과 | 로그 |
| --- | --- | --- |
| 이동 전 baseline 전체 테스트 | exit 1, 기존 컴파일 오류 | `/private/tmp/blabee-layout-baseline-swift.log` |
| 재구성 worktree 전체 테스트 | exit 1, 같은 파일·행·오류 | `/private/tmp/blabee-layout-worktree-swift-full.log` |
| 최종 제품 `swift build --product blabee-coordinator` | exit 0, 경로 경고 없음 | `/private/tmp/blabee-layout-worktree-swift-product-final.log` |
| 한 파일 제외 복사본의 나머지 전체 테스트 | exit 1, 아래 76 issues | `/private/tmp/blabee-layout-swift-validation-with-registry-test-excluded.log` |
| baseline 복사본의 실패 그룹 비교 | exit 1, 동일 76 issues | `/private/tmp/blabee-layout-baseline-comparison-swift-filtered.log` |
| metadata fixture 정규화 후 해당 그룹만 재검증 | exit 0, 24 tests / 1 suite 통과 | `/private/tmp/blabee-layout-metadata-path-normalization-retest.log` |
| manifest의 target별 파일 수·소속 | 245개 일치, 중복·누락 없음 | `/private/tmp/blabee-layout-manifest-description-final.json` |

전체 테스트의 공통 컴파일 오류:

```text
ClaudeSessionRegistryTests.swift:100:20:
value of type 'ClaudeSessionRegistry' has no member 'hasScheduledTimeWork'
```

## 제외 검증의 정확한 범위

재구성 복사본:

```text
/private/tmp/blabee-layout-swift-validation/blabee
```

이 복사본에만 manifest의 `BlabeePetTests` target에 다음 제외를 추가했다.
원래 worktree의 테스트 파일과 manifest의 테스트 소속은 유지했다.

```swift
exclude: ["ClaudeSessionRegistryTests.swift"]
```

제외 파일에는 `@Test` 선언 23개가 있다. 매개변수별 실행 케이스 수와 구분한다.
245개 Swift 소스·테스트·helper 파일은 worktree와 복사본에서 바이트 동일함을 확인했다.
복사 입력과 manifest 해시는 `/private/tmp/blabee-layout-swift-validation-copy.json`에 기록했다.
최종 worktree manifest에는 이후 브릿지 README 제외 경로만 추가됐으며 Swift 입력은 동일하다.

Swift Testing이 보고한 나머지 실행 결과:

- CoordinatorSwiftTests: 217 tests, 6 issues.
- BlabeePetTests: 1,274 tests, 75 suites, 70 issues.
- 기존 opt-in Keychain 복구, SQLite 성능 측정, 설치 Codex 실사용 검사는 활성화하지 않아 건너뛰었다.
- 기존 Keychain 통합 테스트는 자체 생성한 `test-<UUID>` 계정과 테스트 전용 정리 경로를 사용했다.

## 최초 실행: 같은 임시 경로 환경의 HEAD 복사본 비교

기존 HEAD에서 Swift 패키지·Contracts·Fixtures·Packaging·Plugin만 별도 복사했다.
원래 디렉터리 깊이를 유지하고 같은 컴파일 오류 파일만 manifest에서 제외했다.
제품 소스와 테스트 본문은 수정하지 않았다.

```text
/private/tmp/blabee-layout-swift-baseline-comparison/blabee
```

전체 복사본 실행에서 실패한 그룹만 다음 필터로 재검사했다.

```text
sqliteQueuedActionClaim|sqliteReceiptCompletionBatchPreservesQueuedClaim|sqliteDismissalJournalBudgetWithAuthenticatedHistory|ClaudeSessionMetadataStoreTests|PetAirViewTests|petConnectionReadinessUsesBoundedEvidence
```

| 실패 그룹 | 재구성본 issues | 임시 경로 HEAD 복사본 issues | 관찰된 오류 |
| --- | ---: | ---: | --- |
| SQLiteQueuedActionClaimTests | 6 | 6 | `routing_packet_expiry_interval_invalid` |
| ClaudeSessionMetadataStoreTests | 66 | 66 | `claude_metadata_mapping_invalid` 등 동일 fixture 오류 |
| PetAirViewTests | 2 | 2 | 3·4개 카드의 `hasRecommendation` OCR 기대 실패 |
| PetOnboardingTests | 2 | 2 | `connectionReadiness.status == .receiving` 기대 실패 |
| 합계 | 76 | 76 | issue 집합 일치 |

비교는 이동으로 달라지는 절대 경로·줄번호를 제외하고 테스트명, 매개변수,
파일명, 오류 내용을 비교했다. 재구성본에만 나타난 issue는 없었다.
기계 판독 결과는 `/private/tmp/blabee-layout-swift-issue-comparison.json`에 있다.
이 비교는 새 디렉터리 구조가 해당 실패를 만들었다는 증거가 없음을 보여준다.
이 비교만으로 각 실패의 제품 원인과 테스트 환경 원인을 구분할 수는 없다.
특히 아래 metadata 결과처럼 두 복사본에 공통인 임시 경로 특성이 실패를 만들 수 있다.
이 HEAD 복사본의 manifest는 이후 Node 비교 때 원문으로 복구했으므로,
이 Swift 조건을 재현하려면 위의 한 파일 제외를 검증 복사본에 다시 적용해야 한다.

## 후속 확인: metadata fixture의 경로 이식성

Foundation은 `/private/tmp/...` URL에 대해 디렉터리가 없을 때는 같은 문자열을,
mkdir 이후에는 `/tmp/...`를 `standardizedFileURL.path`로 반환했다.
따라서 mkdir 전에 만든 URL의 `.path`를 canonicalCWD로 저장하면 제품의 exact guard와 달라진다.
이 사실은 `/private/tmp/blabee-layout-metadata-cwd-probe.log`에 기록했다.
앞선 66개 issue를 경로와 무관한 기존 제품 결함이라고 판단하지 않는다.

`Tests/swift/BlabeePetTests/ClaudeSessionMetadataStoreTests.swift`의 fixture에서
mkdir 이후 `directory.standardizedFileURL.path`를 canonicalCWD로 사용하게 했다.
제품 guard·제품 소스·Package.swift는 변경하지 않았다.
수정 시점은 2026-09-20 00:55:53 KST이며 파일 해시·변경 범위는
`/private/tmp/blabee-layout-metadata-fixture-change.json`에 있다.

기존 registry 컴파일 오류 파일을 제외한 동일한 별도 복사본에서
`--filter ClaudeSessionMetadataStoreTests`로 Metadata 그룹만 다시 실행했다.
**exit 0, 24 tests / 1 suite가 402.690초에 모두 통과했다.**
기존 `claude_metadata_mapping_invalid` issue도 이 실행에서 재현되지 않았다.
1,000회 durable replay 소비 검증은 401.783초가 걸렸고 정상 통과했다.
느린 구간의 샘플은 해당 검증이 metadata 감사 행을 반복 검증하며 진행 중임을 보여줬다.
명령은 강제 종료 없이 자연 종료했고 공용 테스트 잠금도 해제됐다.
다른 실패 그룹과 전체 테스트를 다시 실행한 결과로 합산하지 않는다.

```text
/private/tmp/blabee-layout-metadata-path-normalization-retest.log
/private/tmp/blabee-layout-metadata-hang-sample.txt
```

## 남은 검증과 별도 작업

- 기존 `hasScheduledTimeWork` 테스트/구현 불일치를 별도 변경으로 해결하고 전체 테스트를 다시 실행해야 한다.
- SQLite 만료 fixture, Air OCR, 연결 상태 기대의 실패는 원본 실행 환경과 테스트 fixture를 구분해 별도로 진단해야 한다.
- 배포용 소스 복사본의 Release 빌드·패키징은 별도 검증 결과로 기록한다.
- 서명·공증·설치 앱 교체·실제 Codex/Claude 왕복은 이번 Swift 검증 범위에 포함되지 않는다.
