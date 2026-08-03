# Blabase macOS Launcher packaging

이 디렉터리는 Phase 4C의 첫 설치형 macOS 개발 beta를 만든다. Swift/AppKit
launcher와 JSON Lines Local Agent만 `.app`에 포함하며, Next.js Work Cockpit이나
source checkout 전체를 desktop bundle에 넣지 않는다.

현재 산출물은 **repo source에서 직접 빌드하고 ad-hoc 서명하는 개발 beta**다.
Developer ID와 Apple notarization을 통과하기 전에는 외부 사용자에게 배포할
release가 아니다.

## Runtime layout

```text
Blabase.app/Contents/
├── Info.plist
├── MacOS/BlabaseLauncher
└── Resources/runtime/
    ├── manifest.json
    ├── LICENSE.node
    ├── THIRD_PARTY_NOTICES.txt
    ├── bin/node
    └── launcher-agent.mjs
```

`launcher-agent.mjs`는 `tools/launcher-agent.ts`를 esbuild로 단일 Node ESM
파일로 bundle한 결과다. Next.js server와 browser route는 포함하지 않는다.
`runtime/bin/node`는 build 시 다음 순서로 결정한 실제 executable을 복사한다.

1. 절대 경로 `BLABASE_NODE_BINARY`
2. build shell의 `PATH`에 있는 `node`

Node 20 이상, build host와 같은 architecture, 실행 가능 여부와 system-only
dynamic library dependency를 검사한다. Homebrew library 등 외부 절대 경로에
동적으로 의존하는 Node binary는 설치 앱에서 고정 runtime이 될 수 없으므로
거부한다. 공식 standalone Node 배포 binary를 사용하는 것을 권장한다.

Node 배포본의 `LICENSE`도 `LICENSE.node`로 함께 복사한다. script가 binary
주변에서 license를 찾지 못하면 packaging을 중단한다. 별도 배치에서는
`BLABASE_NODE_LICENSE=/absolute/path/to/LICENSE`를 명시해야 한다. Node.js는
MIT License로 제공되지만 배포본의 `LICENSE`에는 함께 배포되는 third-party
notice도 포함되므로 binary와 분리해서는 안 된다.

`esbuild`는 launcher agent만 재현 가능하게 bundle하기 위한 명시적인
devDependency다. 앱 runtime dependency가 아니다. bundling은 dependency의
legal comment를 agent 파일 끝에 보존한다. esbuild metafile에서 실제 bundle된
package를 다시 찾아 각 license를 `THIRD_PARTY_NOTICES.txt`에도 포함하며 license를
찾지 못하면 packaging을 중단한다. 정식 외부 배포 전에는 이 자동 inventory를
법무·release checklist에서도 다시 검토해야 한다.

## Agent 시작 계약

Swift supervisor는 bundle resource URL로 runtime code root를 결정한다.

```text
code root = Blabase.app/Contents/Resources/runtime
node      = <code-root>/bin/node
agent     = <code-root>/launcher-agent.mjs
manifest  = <code-root>/manifest.json
```

기본 실행은 shell을 거치지 않고 고정 argv로 시작한다.

```text
<code-root>/bin/node
<code-root>/launcher-agent.mjs
--data-root
<absolute-data-root>
```

manifest contract는 `blabase-launcher-runtime-manifest-v1`이다. code root는
manifest의 부모 디렉터리이고, `nodeRelativePath`, `agentRelativePath`와 필수
`--data-root <absolute-data-root>` argument를 기록한다. manifest에는 build
machine의 source 경로나 사용자 data 경로를 기록하지 않는다. 대신 build 시점의
commit 또는 dirty-worktree fingerprint와 bundle된 Agent의 SHA-256을 기록한다.
provenance를 결정하지 못하면 packaging을 중단하고, 검증 단계에서 실제 Agent
bytes의 hash와 manifest가 다르면 `.app`을 거부한다. release host는 ambient
`BLABASE_CODE_*`를 제거한 뒤 이 manifest의 검증된 provenance만 Agent에 전달한다.

기본 data root는 다음 디렉터리다.

```text
~/Library/Application Support/Blabase
```

이 기본 root에서는 bundle된 Agent가 `managed` source mode의 유일한 source sync
writer와 scheduler다.

기존 store 함수는 전달된 root 아래 `.local/`을 사용한다. 개발자가 기존 source
checkout의 local store를 확인하려는 경우에만 앱 시작 환경에 절대 경로를
지정한다. 값은 `.local` 자체가 아니라 `suggestion/` root다.

```bash
launchctl setenv BLABASE_LAUNCHER_DATA_ROOT /absolute/path/to/suggestion
```

override root는 자동으로 `read_only` source mode가 된다. 이때 새로고침은 이미
저장된 snapshot을 다시 평가할 뿐 source sync, scheduler 또는 monitor run write를
수행하지 않는다. fresh snapshot이 필요하면 그 root를 소유한 Next.js
`SourceSyncCoordinator`에서 먼저 동기화한다. 한 data root에 두 source sync writer를
동시에 실행하지 않는다.

확인이 끝나면 override를 제거한다.

```bash
launchctl unsetenv BLABASE_LAUNCHER_DATA_ROOT
```

`BLABASE_LAUNCHER_DATA_ROOT` 값, `.local`, `.env*`, token, OAuth credential과
production record는 `.app`이나 DMG에 복사하지 않는다.

## Development beta build

필요 조건:

- macOS와 Swift toolchain
- `codesign`, `hdiutil`, `plutil`, `otool`, `ditto`
- 설치된 `suggestion/node_modules`
- Node 20 이상 standalone executable

`suggestion/`에서 실행한다.

```bash
BLABASE_NODE_BINARY=/absolute/path/to/node npm run launcher:package
```

Node/npm이 shell `PATH`에 없는 환경에서는 script를 직접 실행할 수 있다.

```bash
BLABASE_NODE_BINARY=/absolute/path/to/node \
BLABASE_NODE_LICENSE=/absolute/path/to/LICENSE \
  ./desktop/macos/scripts/build-beta.sh
```

기본 `xcrun` SDK 대신 특정 SDK를 검증해야 하는 로컬 toolchain에서는 절대
경로 `BLABASE_SWIFT_SDKROOT`를 사용할 수 있다. SwiftPM에 추가 인자가 필요하면
shell string 대신 한 줄에 argument 하나를 기록한 절대 경로 파일을 사용한다.
빈 줄과 `#`로 시작하는 줄은 무시한다. package path, release configuration,
scratch path, product와 output 조회 인자는 packaging script가 소유하므로
override할 수 없다.

```bash
printf '%s\n' '--disable-sandbox' > /absolute/path/to/swift-build.args

BLABASE_SWIFT_SDKROOT=/absolute/path/to/MacOSX.sdk \
BLABASE_SWIFT_BUILD_ARGUMENTS_FILE=/absolute/path/to/swift-build.args \
BLABASE_NODE_BINARY=/absolute/path/to/node \
  ./desktop/macos/scripts/build-beta.sh
```

Swift/Clang module cache는 기본적으로 전용 Blabase build root 아래에 둔다. 이
override들은 개발 환경과 CI의 toolchain 차이를 진단하기 위한 것이며 SDK와
compiler가 일치하지 않는 상태를 정식 release 설정으로 간주해서는 안 된다.

기본 output은 Git에서 제외된 다음 위치다.

```text
suggestion/.local/build/macos/Blabase.app
suggestion/.local/build/macos/Blabase-dev-beta.dmg
suggestion/.local/build/macos/Blabase-dev-beta.dmg.sha256
```

개별 단계:

```bash
npm run launcher:swift:smoke
npm run launcher:agent:bundle
npm run launcher:app:build
npm run launcher:dmg:build
npm run launcher:package:verify
```

`launcher:swift:smoke`는 XCTest가 없는 최소 Command Line Tools 환경에서도 request
ID, URL allowlist, child environment와 restart policy를 실제 Swift executable로
검증한다. `swift test`의 전체 model test suite는 XCTest를 제공하는 full Xcode
toolchain에서 별도로 실행한다.

검증은 다음을 포함한다.

- SwiftPM release executable과 Info.plist 일치
- bundled Node와 agent syntax
- runtime source provenance와 bundled Agent SHA-256 일치
- `.local`, env, credential, key material 부재
- app nested signature와 outer ad-hoc signature
- SHA-256 sidecar, `hdiutil verify`, read-only mount, mounted app 재검증
- `/Applications` shortcut 확인

scripts가 제거하는 대상은 marker가 있는 전용 build root의 명시적인 하위
artifact뿐이다. build root 자체, source tree와 사용자 data root는 제거하지
않는다.

## Developer ID and notarization

정식 서명과 notarization은 기본 build에 암묵적으로 포함하지 않는다. 먼저
`notarytool` credential을 Keychain profile로 저장한 뒤 다음 환경을 모두
명시해야 한다.

```bash
BLABASE_ENABLE_NOTARIZATION=1 \
BLABASE_NODE_BINARY=/absolute/path/to/node \
BLABASE_DEVELOPER_ID_APPLICATION='Developer ID Application: Example (TEAMID)' \
BLABASE_NOTARY_PROFILE='blabase-notary' \
BLABASE_NODE_CODESIGN_ENTITLEMENTS=/absolute/path/to/node.entitlements \
BLABASE_CODESIGN_ENTITLEMENTS=/absolute/path/to/host.entitlements \
npm run launcher:release:notarized
```

bundled Node.js는 V8 JIT를 사용하므로 hardened runtime 서명에는 별도의 Node
entitlements가 필요하다. 또한 Local Agent가 macOS Terminal에 Apple Events를 보내
기존 작업을 focus/resume하므로 Node와 host executable 모두 Apple Events entitlement가
필요하다. opt-in script는 두 entitlements 파일과 아래 값을 fail closed로 확인한
뒤에만 진행한다. Info.plist에는 `NSAppleEventsUsageDescription`도 포함한다. 근거는
Apple의 [Apple Events entitlement 문서](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.automation.apple-events)와
[usage description 문서](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription)를 따른다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.automation.apple-events</key>
  <true/>
</dict>
</plist>
```

host entitlements는 JIT 예외 없이 Apple Events만 허용한다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.automation.apple-events</key>
  <true/>
</dict>
</plist>
```

초기 launcher는 Codex/Git process 및 사용자의 project files에 접근하므로 App
Sandbox는 켜지 않는다. 이는 권한을 넓히기 위한 기본값이 아니라 현재 기능과
sandbox 간 호환성 결정을 명시한 것이며, 외부 beta 전에 접근 범위와 사용자
고지를 다시 검토해야 한다.

opt-in script는 Node, launcher, app을 hardened runtime으로 안쪽부터 서명하고,
app과 DMG를 각각 제출·staple·검증한다. 전체 Xcode, Developer ID certificate와
Apple notarization credential이 없으면 이 단계는 실행하지 않는다. 개발 beta의
ad-hoc 서명은 이 release 절차나 Gatekeeper 배포 신뢰를 대신하지 않는다.
