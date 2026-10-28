# Claude 경로 검증 후속 수정 — 2026-09-20

## 범위와 원인

작업 위치는 `/private/tmp/blabee-layout-20260920/apps/blabee` 격리 worktree다.
원본 checkout·설치 앱·실제 Codex/Claude 세션·사용자 DB는 이 작업에서 변경하지 않는다.

이동 후 native-session 11개와 product-ingress 6개가 host readiness 이전에 실패했다.
Node launcher의 `realpath()`는 실제 경로 `/private/tmp/...`를 grant에 넣었지만,
Swift Foundation의 `standardizedFileURL`/`resolvingSymlinksInPath()`는 이 Mac에서
같은 디렉터리를 `/tmp/...`로 표시했다. 정확 일치 검사끼리 기준이 달라 정상적인
합성 프로젝트를 거부했다. product ingress의 대표 startup probe 오류는
`invalid_arguments`였고 socket 길이는 92바이트로 103바이트 한도 이내였다.

이는 원본 설치 제품 전체가 실패한다는 증거는 아니지만, 동일 경로를 사용하는
실제 launcher와 native grant 경계에서도 발생할 수 있는 불일치다.

## 수정

- Claude adapter에 package 범위 `ClaudeCanonicalDirectory` 검증을 추가했다.
  활성 프로젝트는 POSIX `realpath` 결과와 입력의 UTF-8 바이트가 같고 실제 디렉터리여야 한다.
  Node launcher와 같은 기준이며 상대 경로·dot segment·중복/끝 슬래시·제어 문자·
  심볼릭 링크 표기·없는 경로·일반 파일을 거부한다.
- native grant, product configuration, host grant reader, product session registry가
  같은 활성 프로젝트 검증을 사용한다. 자격정보·세션 identity·역할·기존 소켓 보안은 유지했다.
- metadata는 프로젝트가 이동/삭제된 뒤에도 이력을 읽어야 하므로 문법 검사만 수행한다.
  파일시스템에 의존하는 Foundation 표기 변환을 제거했으며 기존 `/tmp` 이력도 읽을 수 있다.
  metadata를 읽는 행위가 세션 실행 권한을 다시 만들지는 않는다.
- Pet transport의 표시용 cwd도 같은 문법 검사를 사용한다. 활성 세션의 물리 경로는
  native grant 경계가 검증하며, UI에서 Foundation 표기 변환으로 정상 cwd를 다시 거부하지 않는다.
- 테스트 전용 ingress fixture도 동일한 실제 root 경로 검증을 사용한다.
  Swift native/product authority fixture는 생성 후 POSIX canonical path를 사용한다.
- physical path 허용과 symlink·alias·비정규 경로 거부 회귀 검사를 추가했다.
  한글·공백·결합 문자 디렉터리도 POSIX 원문 String으로 grant에 전달해 UTF-8 바이트가
  보존되는지 확인한다. URL 표시용 값과 protocol에 넣는 canonical 문자열을 구분한다.
  넓은 Registry fixture에서는 NFC 한글 POSIX 경로를 URL로 감싼 뒤 `.path`로 꺼낼 때
  NFD 문자열이 되어 byte 일치 조건을 위반했다. 해당 fixture는 Swift 담당자가
  `canonicalProjectPath` 원문을 owner/Hook/세션 요청에 그대로 넣도록 수정했다.

`Tests/swift/BlabeeCoordinatorSupport/ClaudeBridgeRoundTripFixture.swift`는 Swift 담당자와
소유를 조율했다. Registry의 컴파일 조건 수정과 다른 Swift fixture 수정은 해당 담당자 범위다.

## 검증

| 검증 | 결과 | 로그 |
| --- | --- | --- |
| `test:native-session` | 실제 test-harness 빌드 + 28/28 통과, 이전 host 초기화 실패 11개 해소 | `followup-native-session.log` |
| product ingress | 같은 바이너리 재사용, 10/10 통과, 이전 readiness 실패 6개 해소 | `followup-product-ingress.log` |
| `test:shared-engine` | Swift 77개·5 suite + Node 164개 통과 | `followup-shared-engine.log` |
| 최종 canonical 경로 회귀 | 1/1 통과; 한글·공백·결합 문자 허용, symlink/alias·없는 경로·일반 파일·비정규 경로 거부 | `followup-canonical-directory.log` |

로그는 `build/claude-tests/validation-logs/`에 저장한다.
검증은 합성 Hook/MCP·소유한 테스트 runtime과 test-harness Coordinator만 사용한다.
실제 provider/LLM 세션이나 설치 서비스는 시작하지 않는다.
위 실행 셀은 모두 exit 0으로 종료됐으며 추가적인 사용자 프로세스 조회·종료는 하지 않았다.

넓은 공통 Swift 검증에서 발견된 Registry·ClaudePet fixture의 Foundation 기반 cwd 입력은
Swift 담당자가 POSIX 원문 String으로 조정한다. 해당 부분과 전체 Swift/패키징 검증 결과는
상위 작업에서 합치며, 위 표를 전체 앱·실제 provider 실사용 통과로 해석하지 않는다.

## 변경 파일

- `bridges/claude/swift/adapter/ClaudeNativeSession.swift`
- `bridges/claude/swift/service/ClaudeNativeHost.swift`
- `bridges/claude/swift/session/ClaudeSessionRegistry.swift`의 `requireCanonicalProject`
- `bridges/claude/swift/session/ClaudeSessionMetadataStore.swift`의 mapping 경로 문법 검사
- `bridges/claude/swift/presentation/ClaudePetTransport.swift`의 표시용 경로 문법 검사
- `Tests/swift/BlabeeCoordinatorSupport/ClaudeBridgeRoundTripFixture.swift`
- `Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/NativeSessionTests.swift`
- `Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductAuthorityIntegrationTests.swift`

SDK/의존성, wire schema, 저장 schema, 제품 식별자, launcher의 realpath 출력은 바꾸지 않았다.
기존 runtime·metadata를 이동하거나 덮어쓰는 migration은 추가하지 않았다.
