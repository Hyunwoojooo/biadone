---
name: codex-version-support
description: 새 Codex CLI 안정 버전(예 0.167.0)을 Blabee 지원 목록에 등록하는 체크리스트. "Codex 0.x 지원 추가", Pet의 "검토 전" 안내나 codex:check-latest 알림, codex_native_version_unqualified 오류, 새 버전 qualification 요청에 쓴다.
---

# 새 Codex 버전 지원 등록

Codex Bridge 영역 작업이다. 버전은 **정확한 문자열**로만 등록한다. 인접 버전·prerelease·범위 비교로 일반화하지 않는다.
2026-11-20부터 등록 전 새 버전도 제안 카드와 선택 전달은 동작한다(`CodexCompatibility.pluginAdmission`, 설계 `docs/features/CODEX_UNREVIEWED_VERSION_DESIGN.md`).
등록은 그 버전의 승인 카드(CDHash)와 관리형 경로를 켜는 일이고, 이 규칙은 등록 자체의 정확 일치 원칙을 바꾸지 않는다.
소스 비교에서 Hook·queue가 깨지는 버전을 찾으면 등록하지 말고 `bridges/codex/blocked-versions.json`에 넣는다(`npm run codex:qualification -- generate`).
증거 없이 값을 추측하지 않는다. 공식 release asset을 내려받아 직접 계산한 해시·CDHash만 쓴다.
직전 사례: `docs/features/CODEX_0166_QUALIFICATION.md`.

## 2026-11-13부터: 등록 스크립트

버전 데이터는 `bridges/codex/qualification/<ver>.json` 하나에 있다(기능, `bin/codex` CDHash, 파일별 해시 catalog, fingerprint, 출처 메모).
Swift는 생성된 `core/HookPermissionProfiles.generated.swift`와 `setup/CodexQualificationData.generated.swift`만 읽는다(앱 서명에 포함, 실행 중 JSON 로드 없음).

0. 새 버전은 `npm run codex:check-latest`로 찾는다. 관리자 Mac에서는 LaunchAgent가 매일 09:00 `scripts/codex/check-latest-notify.sh`를 돌려 macOS 알림을 띄운다.
1. `npm run codex:register -- --version <ver> --download --check-notarization`
   (네트워크로 공식 GitHub asset을 받으므로 사용자 승인 후 실행. 로컬 archive는 `--archive <path>`.)
   archive SHA-256·크기를 GitHub 메타데이터와 대조 → 새 빈 폴더에 전개 → opt-in Swift probe(`codexQualificationRegistrationProbe`, production 검사)로
   파일 해시·Team ID·fingerprint 측정 → codesign으로 CDHash → JSON·증거(`docs/features/codex-evidence/<ver>.json`)·fixture 작성 → Swift 재생성.
   기능 기본값은 catalog가 있는 가장 최근 기록(다시 등록하는 버전 자신 제외)과 같다. 다르면 `--capabilities`.
   공증은 모든 Mach-O 파일을 1초 간격으로 조회하고 실패하면 5초 뒤 두 번 더 확인한다. Apple 조회는 몰아서 보내면
   "공증 없음"과 같은 exit 3으로 실패한다(2026-11-13 0.167.x 첫 측정에서 오판).
   실제 패키지 Swift 검증의 `BLABEE_CODEX_RUNTIME_ARTIFACT`에는 archive가 아니라 전개한 `bin/codex` 경로를 준다.
   native lifecycle의 `--catalog`는 공식 `codex-rs/models-manager/models.json`(해당 태그)을 쓴다.
2. 아래 0절의 "이전 버전과 공식 소스 비교"는 여전히 사람이 한다(queue 인자, Hook 형식, App Server 승인 schema, 패키지 레이아웃).
3. `Tests/swift/BlabeePetTests/CodexCompatibilityTests.swift`의 정확한 버전 목록 세 곳에 새 버전을 직접 추가한다(의도된 검토 지점, 자동 생성 안 함).
4. 3절 검증과 4절 문서. 생성 파일을 손으로 고치지 않는다(`npm run codex:qualification -- check`가 t005에서 확인).

아래 0~1절은 스크립트가 하는 일의 근거와, 스크립트가 다루지 않는 변경(레이아웃·Plugin)이 있을 때의 수동 절차다.

## 0. 공식 근거 수집

- GitHub release `rust-v<ver>`의 `codex-package-aarch64-apple-darwin.tar.gz`: 공개 시각, 크기, archive SHA-256. GitHub asset metadata와 로컬 archive를 대조한다.
- 패키지 전개 후: 파일 수·디렉터리 수, 파일별 SHA-256, native 실행 파일 목록과 arch, `bin/codex`의 SHA-256·CDHash(`codesign -dvvv`), signing Team ID, 공증 상태.
  보조 실행 파일(예: `bin/codex-exec-server`)의 CDHash는 기록하되 Hook 호출자로 등록하지 않는다.
- 이전 버전과 공식 소스 비교: `codex queue` 인자(`--thread`, `--message`), Hook 실행 경로와 `Allow`→일회성 `Approved` 변환,
  App Server thread lifecycle·명령 승인 schema, 패키지 레이아웃(공식 openai/codex 저장소 `rust-v<ver>` 태그의 `scripts/codex_package/layout.py`, 이 저장소에는 없음). 바뀐 점을 적는다.
- 증거는 `/private/tmp/blabee-codex<ver>-<date>-*/` 같은 임시 디렉터리에 모으고 문서에 경로를 남긴다.

## 1. 소스 변경 (`bridges/codex/swift`)

1. `setup/CodexCompatibility.swift`: `"<ver>": [.managedAppServer, .pluginCLI]`.
2. `core/HookPermissionPolicy.swift`: primary `bin/codex` CDHash로 `RuntimeProfile` 추가, 검토 주석. 기존 항목·레거시 `qualifiedVersion`/`qualifiedCDHash`·`qualificationKey`는 유지.
3. `runtime/ManagedCodexLauncher.swift`: 서버 소유 workspace 라우팅의 `qualifiedVersion ==` 목록.
4. `update/UpdateManagedCodexObserver.swift`: `UpdateManagedCodexProfile.supportedVersions`.
5. `runtime/CodexRuntimeBundle.swift`의 `QualificationCatalog`: `Key(version, target)`의 `Record`(Team ID, 파일 전체 digest, fingerprint).
   레이아웃이 바뀌면 manifest 디코더·bin 검사·custody·fingerprint 도메인도 고친다. 기존 record와 v1 도메인은 보존한다.
6. `Fixtures/codex/<ver>/voice-runtime.json`: catalog의 `runtime.json` digest와 같아야 한다(`CodexRuntimeTrustTests`가 읽는다).
7. `scripts/qualify-codex-compatibility.mjs`: `includesVoice`, 셸 제거 버전, 레이아웃 목록.
8. 필요하면 `bridges/codex/plugin/`의 Plugin 버전·Hook matcher와 `app/service/DoctorApplication.swift`의 고정 진단 계약.

### 1-1. 버전 목록 단일화 (2026-11-13 완료)

2026-11-13에 정리했다. 아래는 당시 배경이다. 지금은 `CodexCompatibility.capabilityMatrix` 한 곳에 버전과 기능
(`.managedAppServer`, `.pluginCLI`, `.serverOwnedWorkspaceRoots`, `.updateLifecycle`)을 적으면 3·4번이 따라온다.
exec-server 레이아웃은 catalog record의 파일 목록이 정한다(`recordedExecServerLayout`). 테스트는 정확한 목록을 `CodexCompatibilityTests`에서만 확인한다.


지원 버전 문자열이 위 2~5번에 따로 적혀 있어 하나를 빠뜨리면 테스트가 깨진다(0.166.0 때 `DoctorApplicationTests`). 다음 버전을 등록할 때 함께 정리한다.

- `ManagedCodexLauncher.swift`의 `serverOwnsWorkspaceRoots`(`qualifiedVersion ==` 비교 17개, 0.156.0부터)는 지원 목록 전체와 같지 않다.
  `CodexCompatibility`의 `capabilityMatrix`에 새 capability(예: `.serverOwnedWorkspaceRoots`)를 추가하고 그 조회로 바꾼다.
- `UpdateManagedCodexProfile.supportedVersions`는 `CodexCompatibility.supportedVersions`와 같은 집합인지 확인한 뒤 그것을 참조하게 한다.
- `CodexRuntimeBundle.swift`의 `version == "0.166.0"` 레이아웃 분기는 catalog `Record`의 레이아웃 정보로 옮길 수 있는지 검토한다. 신뢰 경로이므로 기존 record·fingerprint 도메인은 바꾸지 않는다.
- 동작이 바뀌지 않았다는 근거로 3절 Swift 필터 전체와 `test:codex-compatibility`를 리팩터 전후로 돌려 비교한다. 리팩터와 새 버전 등록은 커밋을 나눈다.

## 2. 테스트 갱신

- Swift(`Tests/swift/BlabeePetTests/`): `CodexCompatibilityTests`(허용·unsupported 목록), `ManagedCodexBrokerTests`(arguments), `CodexPluginSetupTests`,
  `UpdateManagedCodexObserverTests`, `CodexHookApprovalQualificationTests`, `CodexRuntimeTrustTests`,
  `DoctorApplicationTests`(`doctorCodexVersionPolicy`가 지원 버전 전부를 `DoctorFixture.writeCodexPackage`로 검사한다.
  패키지 레이아웃이 바뀐 버전(예 0.166.0의 `bin/codex-exec-server`)은 이 픽스처의 manifest·bin도 같이 고쳐야 한다. 레이아웃 오류 문구를 바꾸면 `doctorCodexRuntimeBundleFailsClosed`의 detail 기대값도 갱신).
- Node: `Tests/RuntimeQualification/*.test.mjs`(`update-managed-codex-native.test.mjs`의 버전 목록 포함).

## 3. 검증 실행

```sh
npm run test:codex-compatibility
npm run test:t005
npm run qualify:codex-compatibility -- --expected-version <ver> --runtime-dir <절대경로> --evidence <절대경로.json> --hook-tests --plugin-lifecycle
python3 scripts/verify-update-managed-codex-native.py --execute --expected-version <ver> --codex <bin/codex> --catalog <catalog> --expected-sha256 <archive sha>
BLABEE_CODEX_RUNTIME_ARTIFACT=<패키지> BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT=1 npm run test:swift -- --filter 'Codex|ManagedCodex|UpdateManagedCodex|Hook|DoctorApplication'
```

네트워크·사용자 홈 접근을 막은 임시 디렉터리에서 돌린다. 사용자 로그인·세션·운영 DB를 쓰지 않는다. 통과 개수를 suite별로 적는다.
`test:swift`는 루트 `CLAUDE.md`의 잠금 규칙을 따른다.

## 4. 문서

- `docs/features/CODEX_<ver>_QUALIFICATION.md` 신규: 변경, 공식 근거 표(archive 크기·SHA-256, `bin/codex` SHA-256·CDHash, Team ID, fingerprint), 검증 수치, 증거 경로, 남은 경계.
- `docs/features/CODEX_LATEST_SUPPORT.md` 맨 위에 항목 추가. `docs/features/CODEX_COMPATIBILITY_QUALIFICATION.md`의 레이아웃 절.
- `docs/github/public/CHANGELOG.md`·`CHANGELOG.ko.md`(0.164.0 항목 형식 참고).

## 5. 보고

소스 변경, 빌드 없는 회귀, 공식 패키지 smoke, Swift 회귀, 설치 앱 반영 여부를 구분한다.
설치된 앱에는 자동 반영되지 않으며 새 빌드·공증·설치와 실제 Hook→Pet→queue 왕복은 별도 단계라고 명시한다.
