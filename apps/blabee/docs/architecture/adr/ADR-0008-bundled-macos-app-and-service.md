# ADR-0008: Coordinator, Plugin, 계약, 서비스 정의를 macOS 앱에 함께 패키징

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · committed HEAD `a352baa773e11a9be96c9d5b5aafca19aa5fb543` · 미커밋 변경 제외
- Original decision date: Unknown
- Scope: `Blabee.app` 조립, Pet/CLI/service 진입, embedded Plugin/Contracts, 정적 LaunchAgent 계약
- Evidence maturity: app/ad-hoc 내부 DMG 자동 자격과 2026-09-05 한 개발 Mac의 r8 설치·서비스 복구 기록 존재; clean Mac·Hook/Pet 왕복·Developer ID·공증은 미완료. 이번 문서 작업에서 재실행하지 않음

## Context

Blabee의 Pet, Coordinator daemon, Plugin, frozen contract가 서로 다른 임의 경로와 버전에서 실행되면 runtime identity와 호환성 검증이 약해진다. 제품 service는 개발용 `daemon`의 임의 경로 인자를 노출해서도 안 되고, 설치 전 조립 도구가 `/Applications`나 기존 사용자 파일을 덮어써서도 안 된다.

## Decision drivers

- 실행 파일, Contracts, Plugin과 조립 manifest를 하나의 서명 가능한 bundle에 묶는다.
- Finder의 앱 실행, 개발용 CLI, 제품 service mode의 의미를 명확히 나눈다.
- 제품 service가 고정 Application Support 경로와 embedded Contracts만 사용하게 한다.
- service 자동 시작 계약을 bundle resource로 봉인하되 사용자 동의 전 등록하지 않는다.
- 조립 단계가 기존 경로를 덮어쓰거나 `/Applications`에 직접 설치하지 않게 한다.

## Considered options

원래 결정 회의의 대안 표는 확인되지 않았다. 아래는 builder와 보고서에서 재구성했다.

1. 하나의 `Blabee.app`에 Coordinator, Contracts, Plugin, manifest, LaunchAgent plist를 포함한다.
2. Coordinator/Pet/Plugin을 서로 독립된 loose file과 PATH 설치로 배포한다.
3. Pet과 service에 별도 제품 binary를 둔다.
4. build 도구가 `/Applications`에 직접 쓰고 service를 자동 등록한다.

## Decision

- `Blabee.app/Contents/MacOS/blabee-coordinator` 단일 실행 파일을 중심으로 조립한다.
- `Contents/Resources`에 `Contracts/v1`, `Plugin/blabee`, assembly manifest와 제품 리소스를 포함한다.
- 정확한 앱 bundle identity의 인자 없는 실행은 Pet, 명시적 `service` 인자는 제품 daemon bootstrap으로 해석한다. 기존 개발용 CLI mode는 보존한다.
- 제품 service는 embedded Contracts와 `~/Library/Application Support/Blabee/`의 고정 DB/key/socket/config 경계를 사용하고 임의 경로 인자를 거부한다.
- `Contents/Library/LaunchAgents/com.biadone.blabee.coordinator.plist`에는 bundle-relative program, `service`, `RunAtLoad=true`를 둔다. crash-loop 정책이 정해지기 전 `KeepAlive`는 넣지 않는다.
- 조립기는 저장소/시스템 임시 영역에만 새 bundle을 만들고 기존 출력과 `/Applications` 직접 쓰기를 거부한다.
- LaunchAgent 등록·해제는 사용자의 명시적 UI 동작과 별도 live qualification을 요구한다.

## 2026-09-07 구현 재검증

번들로 제품 구성 요소를 함께 배포한다는 결정은 유지한다. `a352baa`의 내부 배포 경계는 다음처럼 구체화됐다.

- 지원되는 사용자 진입은 `npm run build:internal-dmg`의 `build-fresh-internal-dmg.mjs`다. Swift·Contracts·Plugin·Packaging을 private source snapshot으로 복사하고 새 scratch에서 빌드하며, snapshot과 원본의 fingerprint를 빌드·게시 경계에서 다시 확인한다.
- 명시적 내부 build 번호 `1…9999`를 staging 앱의 `CFBundleVersion`과 출력 파일명 `-rN.dmg`에 결합한다. 저장소의 Info.plist 템플릿은 변경하지 않는다.
- fresh build와 조립·mount·결과 검증은 exact `arm64`를 요구한다. DMG publish transaction v2는 build 번호·아키텍처·파일 identity·checksum·detach 검증을 묶으며, checksum을 먼저 게시한 뒤 DMG를 배타적으로 게시한다. 중단 복구에서 일치하지 않는 증거나 구형 v1은 실패 폐쇄한다.
- r8은 한 개발 Mac에서 설치와 명시적 서비스 재시작 뒤 실제 응답을 확인한 기록이 있다. 이는 2026-09-05의 제한된 `LIVE`이며, 깨끗한 Mac의 최초 설치·로그인 수명주기·Hook/Pet 왕복이나 공개 배포의 자격은 아니다.

## Consequences

긍정적 결과:

- Coordinator, Plugin, Contracts와 runtime identity manifest의 버전 결합을 검사할 수 있다.
- Pet·service·CLI가 같은 제품 executable과 core를 재사용한다.
- installer 없이도 안전한 로컬 조립과 내부 dogfood artifact를 만들 수 있다.

비용과 제약:

- bundle resource layout, mode, hash, code signature와 호환 identity를 함께 검증해야 한다.
- 정적 LaunchAgent plist가 bundle에 있다는 사실만으로 자동 시작이 되지 않는다.
- `RunAtLoad` 계약은 구현됐지만 `KeepAlive`/on-demand 정책과 실제 로그인 수명 주기는 열려 있다.
- ad-hoc 서명·내부 DMG 자격은 Developer ID, 공증, Gatekeeper, 공개 installer/updater 승인이 아니다.
- r8의 제한된 service 복구 기록 외에 clean Mac 등록·승인 상태 전이·로그인 수명주기와 primary Keychain 자격을 일반화할 수 없다.

## Evidence

아래 링크는 모두 재검증한 커밋에 고정한다. 2026-08-22의 service bootstrap 보고서는 당시 설치 전 계약 기록이며, 설치 여부의 후속 판정에는 2026-09-05 r8 기록을 우선한다.

- 번들 구현: [bundle·marketplace·LaunchAgent identity](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-macos-app.mjs#L35-L85), [출력 범위와 기존 경로 보존](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-macos-app.mjs#L1312-L1338), [build 번호 주입과 LaunchAgent 포함·검증](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-macos-app.mjs#L1391-L1426), [정적 service/RunAtLoad plist](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/Packaging/macos/LaunchAgents/com.biadone.blabee.coordinator.plist#L1-L17).
- 내부 배포 구현: [하나의 source snapshot과 빌드·게시 전 대조](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-fresh-internal-dmg.mjs#L932-L1031), [build 번호·파일명 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/internal-build-number.mjs#L3-L27), [v2 복구 증거 검증](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-internal-dmg.mjs#L1090-L1145), [arm64·checksum/DMG 게시·공개 배포 미승인](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-internal-dmg.mjs#L1537-L1584).
- 기록된 자격과 한계: [r8 build·설치·service 복구와 실제 미실행 항목](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_APP_BUNDLE_REPORT.md#L120-L175), [공개 배포·깨끗한 Mac의 남은 범위](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_APP_BUNDLE_REPORT.md#L194-L217), [제품 service 고정 경로의 원 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_SERVICE_BOOTSTRAP_REPORT.md#L1-L26).

## Supersedes / Superseded by

- Supersedes: loose runtime files와 셸 설정에 의존하는 제품 배포 구상.
- Superseded by: None known.

## Related views

- [C4 컨테이너](../c4/container.html)
- [Coordinator 컴포넌트](../c4/coordinator-components.html)
- [arc42-lite 배포 관점](../README.md#7-배포-뷰)
