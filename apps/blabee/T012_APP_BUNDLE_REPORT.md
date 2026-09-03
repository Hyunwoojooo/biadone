# T-012b-1 로컬 Blabee.app 조립 보고서

업데이트: 2026-09-03
상태: 로컬 조립·ad-hoc 앱을 담은 내부 DMG 자동 자격 완료, 깨끗한 Mac·공개 배포 미승인

## 결과

설치하지 않고 저장소 또는 시스템 임시 영역에 `Blabee.app`을 만드는 기반을
구현했다. Finder/LaunchServices가 정확한 앱을 인자 없이 실행하면 Pet 모드로
진입하며, shell에서 실행하는 기존 daemon·doctor·hook·mcp·legacy CLI 동작은
그대로 유지한다.

```text
Blabee.app/
└── Contents/
    ├── Info.plist
    ├── MacOS/
    │   └── blabee-coordinator
    └── Resources/
        ├── assembly-manifest.json
        ├── Contracts/v1/
        └── Plugin/blabee/
```

## 조립 안전 경계

- `--binary`와 `--output`은 명시적 절대 경로여야 한다.
- 출력은 Blabee 저장소 또는 canonical system temporary root 안에서만 허용한다.
- `/Applications`를 포함한 그 밖의 위치에는 쓰지 않는다.
- 기존 출력, symlink, 특수 파일, 실행 비트가 없는 바이너리를 거부한다.
- `Info.plist`는 `plutil`로 읽고 bundle ID, 실행 파일, 버전, 최소 macOS,
  `LSUIElement`, `NSHighResolutionCapable`, `NSPrincipalClass` 값과 타입을 검사한다.
- Contracts와 Plugin은 regular file만 복사하고 launcher만 `0755`, 나머지 파일은
  `0644`, 디렉터리는 `0755`로 고정한다.
- sibling staging을 완성한 뒤 최종 `Blabee.app`을 `mkdir`로 원자 선점하고
  `Contents`를 게시한다. 두 builder가 동시에 실행돼도 하나만 성공한다.
- assembly manifest는 서명 전 각 파일의 상대 경로, 크기, 모드와 SHA-256을
  기록한다. v2는 추가로 검증된 이전 앱 최대 두 개의 runtime identity와 허용할
  `session_start`·`user_prompt_submit`·`emit_decision`·`stop`을 봉인한다. ad-hoc
  서명 뒤 바뀌는 Mach-O 서명 영역의 사후 hash는 아니다.

## 2026-09-01 runtime 회전 후속

- `--compatible-previous-app`은 raw hash를 받지 않는다. source coordinator의
  `runtime-identity --app <absolute Blabee.app>`가 이전 앱의 strict code signature,
  resource envelope, bundle identifier, executable 위치와 v1/v2 manifest를 검증한
  뒤 CDHash+manifest wire identity를 계산한다. inspector v2는 같은 검증 snapshot에서
  계산한 `assembly_manifest_sha256`도 함께 반환한다.
- assembler는 source coordinator를 private staging에 먼저 복사한 뒤 그 exact
  snapshot으로 검사하고 같은 바이트를 앱에 넣는다. 이전 앱 입력 배열도 첫 비동기
  작업 전에 복사해 최대 두 개 제한이 실행 중 바뀌지 않게 한다.
- 새 manifest는 `blabee.macos-app-assembly.v2`이며 호환 정책은 정렬·중복 없음,
  최대 두 개, exact key와 고정 operation subset을 적용한다. 이전 앱에 들어 있던 더
  오래된 호환 목록은 새 앱으로 전이하지 않는다.
- 새 server는 현재 identity에만 전체 operation을 허용한다. 승인된 이전 identity는
  네 Hook/MCP operation만 dispatch하며 그 요청의 성공과 application error에 이전
  identity를 echo한다. Pet·Doctor·설정·권한 승인 operation은 계속 현재 identity
  전용이다.
- dogfood summary는 `blabee.local-dogfood-preparation.v2`이고 manifest digest인
  `assembly_manifest_sha256`과 실제 `wire_runtime_identity`를 별도 필드로 기록한다.
- 비활성 산출물 `build/local-dogfood-runtime-compat-v2-20260901`은 현재 v1 앱을
  이전 artifact로 넣어 조립했고 `codesign --verify --deep --strict`와 packaged
  inspector v2 재계산을 통과했다. 전체 Swift Testing 441/441+XCTest 5/5와 Node
  276/276도 통과했다. 이 검증은 실행 중 앱·service·Plugin을 교체하지 않았다.

## 로컬 서명 정책

기본 출력은 unsigned다. `--adhoc-sign`을 명시한 개발 자격에서만 다음 조건을
사용한다.

- identity `-`의 ad-hoc 서명
- secure timestamp 없음
- Hardened Runtime 옵션 사용
- entitlement 파일 없음
- `codesign --verify --deep --strict` 검증

실제 release 앱은 `flags=adhoc,runtime`, identifier `com.biadone.blabee`로 검증을
통과했다. 복제한 앱의 `Info.plist`를 바꾼 뒤 같은 검증은 실패했다.

이 결과는 Developer ID, 공증, Gatekeeper 허용, provisioning profile,
Data Protection Keychain access group 또는 공개 DMG를 승인하지 않는다.

## 2026-09-03 내부 테스트용 DMG 후속

기존 `Blabee.app` 조립기를 사용해 ad-hoc 서명 앱을 만들고, 내부 팀원에게 전달할
DMG와 SHA-256 sidecar를 생성하는 범위를 추가한다. DMG에는 `Blabee.app`,
`Applications -> /Applications`, `INTERNAL_TESTING.txt`만 포함한다.

입력 coordinator는 private pinned snapshot으로 고정하고 hash를 기록한다. 같은
출력에는 cross-process lock을 두며, checksum 게시 중 중단되면 transaction marker와
inode/hash를 확인해 다음 실행에서 복구한다. 부분 attach의 disk device도 추적해
정상 detach를 증명하지 못하면 게시하지 않고 조사 경로를 보존한다. 정리 오류는 최초
패키징 오류를 덮지 않고 함께 보고한다.

빌드는 먼저 Swift release coordinator를 만든 뒤 명시적 절대 경로를 사용한다.

```sh
swift build -c release \
  --package-path /Users/joo/BiaDone/apps/blabee/src/coordinator-swift

npm run build:internal-dmg -- \
  --binary /Users/joo/BiaDone/apps/blabee/src/coordinator-swift/.build/release/blabee-coordinator \
  --output /Users/joo/BiaDone/apps/blabee/build/internal-dmg/Blabee-0.1.0-internal.dmg
```

이 단계는 ad-hoc 서명·미공증 내부 산출물만 다룬다. Developer ID identity 조회,
notary credential, 공개 DMG 서명, 자동 설치와 업데이트는 다루지 않는다. 팀원 전달,
checksum 확인, 안전한 Gatekeeper 처리와 깨끗한 Mac 스모크 기준은
`INTERNAL_DMG_PACKAGING.md`를 따른다.

실제 arm64 release coordinator로 다음 산출물을 만들고 다시 검증했다.

- DMG: `build/internal-dmg-20260903/Blabee-0.1.0-internal-arm64.dmg`
- 크기: 2,141,249 bytes
- SHA-256: `0d2cdb0367641365eb88b4695a247a5da91c9b49f377b071ac38aac583d1a945`
- 입력 coordinator SHA-256: `aabc3b8c867b6194dc03eeed4616627eceba1636e50c43404876e54834dc8812`
- 결과: `hdiutil verify`, sidecar `shasum -c`, read-only mount, exact 3개 root,
  plist·arm64·ad-hoc deep/strict 서명, 정상 detach 통과

## 실행 증거

- 내부 DMG 집중 테스트: 12/12
- `npm run test:t012`: 26/26
- 최종 전체 `npm test`: 289/289 통과
- 정식 Xcode toolchain Swift release `blabee-coordinator` 빌드: 통과
- 실제 arm64 DMG 생성·독립 `hdiutil verify`·SHA-256 확인: 통과
- `swift test --filter BlabeePetTests`: 55/55
- `npm run test:t011`: 23/23
- `npm run test:contracts`: 114/114
- 실제 app ad-hoc Hardened Runtime 서명과 deep/strict 검증: 통과
- 서명 후 Info.plist 변조 탐지: 통과
- 번들 내부 Doctor의 coordinator runtime, app bundle, embedded coordinator,
  Plugin layout 검사: 통과

Doctor 전체 결과는 의도대로 실패다. 현재 Codex 버전 allowlist, Plugin 설치,
PATH MCP, daemon, 프로젝트 활성화가 아직 제품 설치 상태가 아니기 때문이다.

## 하지 않은 작업

- `/Applications` 설치
- PATH 또는 shell startup 파일 수정
- launchd/Login Item 등록
- Keychain 읽기·쓰기·삭제 또는 비밀번호 prompt
- Developer ID identity 조회·사용
- 공개 배포용 DMG 서명, 공증, stapling, Gatekeeper 공개 배포 평가
- 자동 업데이트, 공개 다운로드와 불특정 사용자 재배포

## 후속 구현 상태

T-012b-2에서 번들 Contracts와 Application Support 설정을 사용하는 제품
`service` 모드와 실제 등록 전 정적 LaunchAgent 계약을 구현했다. 상세한 경로,
설정 보안 경계와 검증 결과는 `T012_SERVICE_BOOTSTRAP_REPORT.md`에 기록했다.

다음은 안전한 project 설정 writer/onboarding과 명시적 `SMAppService` 등록·해제·상태
UI 계약이다. 실제 로그인 항목 등록, 제품 Keychain 최초 실행, Developer ID
credential 사용은 시스템 상태나 암호 요청에 영향을 줄 수 있으므로 별도의 사용자
동의를 받은 뒤 수행한다.

내부 DMG 생성 성공은 위 제품 수명주기 또는 Pet/Hook 왕복의 실사용 증거가 아니다.
소스와 기존 Blabee 상태가 없는 깨끗한 Mac에서 설치·첫 실행·등록·선택 왕복을 별도
수동 검증해야 한다.

## Apple 기준

- [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle)
- [LSUIElement](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement)
- [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/)
- [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)
- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
