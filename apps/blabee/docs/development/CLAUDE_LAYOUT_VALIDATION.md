# Claude 디렉터리 이동 검증 — 2026-09-20

## 검증 범위

검증 대상은 `/private/tmp/blabee-layout-20260920/apps/blabee` 격리 worktree다.
제품 bridge·개발 launcher는 `bridges/claude/`, 독립 검증 앱은
`dev/claude-standalone/`, 테스트·Swift fixture는 `Tests/bridges/claude/`로 구분했다.
SDK 1.30.0과 lockfile의 의존성 그래프, 기존 제품 식별자와 wire 계약은 유지했다.

설치 앱을 교체하거나 실제 Codex/Claude 세션, 사용자 DB, 계정 설정을 변경하지 않았다.
테스트가 띄우는 서버·MCP·Pet probe는 전용 fixture 경로만 사용한다.

## 먼저 완료한 정적·Node 검증

| 검사 | 결과 |
| --- | --- |
| 제품·독립 앱 JavaScript syntax | 49파일 통과 |
| 제품 Hook·MCP·session-v2 검사 | 25개 통과 |
| 독립 Hook·MCP·Coordinator·roundtrip | 105개 통과 |
| 공통 client·JSON Schema 검사 | 160개 통과 |
| launcher 순수 경로·보안 검사 | 4개 통과 |
| 이동표 | 66개 이동 및 2개 pinned-package 복사, 모든 대상 존재 |
| SDK 의존성 | 두 lockfile의 이름 메타데이터 외 동일한 의존성 그래프 |

Node 검증은 기존 SDK 1.30.0 node_modules를 worktree에 복사해 수행했다.
새 의존성을 추가하지 않았고 clean `npm ci` 검증을 뜻하지 않는다.
최초 Unix 소켓 검사는 sandbox EPERM으로 막혀 허용된 환경에서 재실행했다.
깊어진 디렉터리의 104바이트 소켓 경로 문제는 테스트 생성물을
`build/claude-tests/`로 모아 수정했으며 제품의 103바이트 검사는 유지했다.

## 추가 Swift·실행 파일 검증

| 검사 | 결과 |
| --- | --- |
| `test:shared-engine` | Swift 76개·5 suite, Node 164개 통과 |
| `test:native-session` | 실제 test-harness Coordinator 빌드 통과; Node 17개 통과·11개 host 초기화 실패 |
| product ingress | 같은 test-harness 바이너리를 재사용; client 4개 통과·실제 fixture 6개 readiness 전 종료 |
| 독립 Swift Pet 앱 빌드 | Swift 6 최적화 빌드·ad-hoc 서명 통과 |
| 독립 Pet 진단·잠금·통신 | 14개 통과, skip 없음 |
| 독립 앱 `codesign --verify --deep --strict` | 통과 |
| 독립 앱 기본 경로·launcher 회귀 | launcher 6개 통과; doctor 정상 종료; 번들 runtime 경로 일치 |

`test:native-session`과 product ingress는 **이동 후 통합 실행 실패/미검증 항목**이다.
기존 원본 checkout이나 설치 제품도 실패한다고 단정하지 않으며 전체 통합 통과로 계산하지 않는다.

첫 `test:shared-engine`은 fixture를 빌드했으나 76 tests 중
ProductAuthorityIntegration 그룹의 26 issues로 중단됐다.
이 결과를 기존 `/Users/joo/...` 작업 폴더나 설치 제품의 실패로 일반화하지 않는다.

확인한 원인은 길이 제한이 아니라 **임시 디렉터리 생성 전후의 정규화 차이**다.
fixture가 생성 전 `/private/tmp/...`를 저장한 뒤 디렉터리를 만들면,
이 Mac의 Foundation은 생성 후 같은 경로를 `/tmp/...`로 정규화했다.
`canonicalCWD` 정확 일치 조건이 실패했으며 108바이트·28바이트 합성 경로에서
같이 재현됐다. 길이(4096바이트), 실제 디렉터리 존재, capability 형식,
channel source 검사 등 나머지 조건은 모두 참이었다.

`ProductAuthorityIntegrationTests.swift`의 fixture만 **mkdir 후 정규화**하도록
순서를 조정했다. 제품 `ClaudeProductNativeConfiguration`의 검증은 유지했다.
진단 입력·출력은 `configuration-guard-probe.swift`와
`configuration-guard-probe.jsonl` 로그에 있다.

수정 후 `test:shared-engine` 전체 명령을 다시 실행해 Swift 76개와 실제
Node→Swift→SQLite 왕복을 포함한 Node 164개가 모두 통과했다.

### native host·ingress에서 남은 제한

native-session은 `shared_host_unavailable` 또는 그 후속 readiness 대기로
실제 host 사용 검사 11개가 실패했다. 이동된 launcher의 import와 실행 파일 경로는
확인됐지만 이 실행에서 host 세션 연결은 확인하지 못했다.
제품 `ClaudeNativeHost.readGrant`의 cwd 정확 일치 조건과 이 Mac의
`/private/tmp`·`/tmp` 정규화 차이는 추가 조사 지점이다.
제품 guard를 완화하거나 이번 디렉터리 이동에 별도 동작 수정을 섞지 않았다.

product ingress는 실제 fixture 6개가 readiness 이전 exit 1로 종료됐고,
독립 client 검사 4개는 통과했다. 동일한 합성 입력 형태로 한 번 더 실행한
startup probe에서 `invalid_arguments`, exit 1, ready=false를 확인했다.
이 probe의 socket은 92바이트로 103바이트 한도 이내다.
`ClaudeBridgeRoundTripFixture`는 root의 Foundation 정규화 결과가 입력 root와
정확히 같은지 검사한다. 위 임시 경로 정규화 차이와 일치하는 제한이지만,
여섯 경우 모두의 후속 실행을 검증한 결과나 원본 checkout 비교 결과는 아니다.
오류 코드만 남긴 `product-ingress-startup-probe.json`에는 자격정보가 없다.

### 독립 개발 앱 기본 소켓 경로 회귀 수정

기존 package 상대 기본값을 그대로 옮기면 이 worktree에서 기본 socket이
116바이트가 되어 103바이트 제한을 넘었다. 앱·개발 runtime·생성 세션 설정을
루트 `build/claude-standalone/`에 모아 기본 socket을 98바이트로 줄였다.
소켓 길이 제한과 Codex runtime 거부 조건은 유지했다.
기존 `claude/build/` 사용자 runtime을 이전하거나 자동 재사용하지 않으며,
명시적인 `--runtime` 동작은 유지한다.

`doctor`는 경로 예외 없이 정상 종료했다. coordinator를 새로 띄우지 않았으므로
`reachable: false, reason: ENOENT`는 예상 결과다.
별도 Swift Pet 앱을 빌드하고 번들의 runtime-config가 새 기본 경로를 가리키는지
확인했다. 이 바이너리의 14개 진단·잠금·fixture 통신 검사가 모두 통과했다.
앱 창 표시나 실제 Claude 연결은 이번 검사 범위가 아니다.

로그는 worktree의 `build/claude-tests/validation-logs/`에 둔다.
Swift runner는 Xcode의 Developer 디렉터리와 각각 독립 scratch/cache를 사용한다.

| 로그 | 내용 |
| --- | --- |
| `shared-engine.log` | fixture 경로 초기화 수정 전 실패 |
| `shared-engine-after-path-fix.log` | Swift 76개·Node 164개 통과 |
| `native-session.log` | Coordinator 빌드 및 17 pass / 11 fail |
| `product-ingress.log` | 4 pass / 6 fail |
| `product-ingress-startup-probe.json` | 고정 오류 코드·종료 상태·경로 길이 |
| `standalone-build.log` | 새 기본 생성물 경로의 독립 앱 빌드 |
| `standalone-pet.log` | 14 pass / 0 fail / 0 skip |

## 전체 Swift 테스트의 기존 한계

[전체 Swift 이동 검증](SWIFT_LAYOUT_VALIDATION.md)에 기록된 기존
`ClaudeSessionRegistryTests.swift:100`의 `hasScheduledTimeWork` 컴파일 오류가 있다.
이 오류를 숨기기 위해 실제 worktree 소스나 테스트 소속을 수정하지 않는다.
따라서 `test:common-pet` 전체 실행은 별도 통과로 기록하지 않았다.
이미 준비된 `/private/tmp/blabee-layout-swift-validation/blabee`의 한 파일 제외
복사본에 대한 다른 Swift 검증 범위·실패는 위 링크에서 확인한다.
이 사본의 결과를 전체 원본 테스트 통과로 계산하지 않는다.
