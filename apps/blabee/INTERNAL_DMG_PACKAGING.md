# Blabee 내부 테스트용 DMG 패키징

- 작성일: 2026-09-05
- 갱신일: 2026-09-09 (내부 build 19)
- 대상: 개발팀과 지정된 내부 테스터
- 상태: 내부 테스트 패키징 구현 범위
- 공개 배포: 미승인

## 목적과 경계

이 절차는 현재 소스에서 `Blabee.app`을 조립하고, 팀원이 다른 Mac에서 소스
체크아웃 없이 설치해 볼 수 있는 DMG와 SHA-256 확인 파일을 만드는 데 사용한다.
앱에는 Codex marketplace manifest와 Blabee Plugin이 함께 들어가며, 설치 후 설정의
**Codex 연결하기**로 공식 Codex CLI에 명시적으로 등록할 수 있다.

이 산출물은 다음 이유로 **내부 테스트 전용**이다.

- 앱은 Developer ID가 아닌 ad-hoc identity로 서명한다.
- Apple 공증과 stapling을 수행하지 않는다.
- Gatekeeper 공개 배포 자격을 주장하지 않는다.
- 자동 업데이트, 사용자 동작 없는 Plugin 설치, 로그인 항목 자동 등록을 포함하지
  않는다.
- 공개 웹사이트, 릴리스 페이지 또는 불특정 사용자에게 재배포하지 않는다.

Blabee는 사용자의 공식 Codex 설치를 교체하거나 패치하지 않는다. DMG 생성 성공은
Blabee 앱 패키지의 무결성 근거일 뿐 Codex 호환성 또는 실제 제품 왕복의 근거가
아니다. 앱을 처음 실행하거나 설정 화면을 연 것만으로 Codex 프로세스를 실행하거나
Plugin을 설치하거나 Hook을 신뢰하지도 않는다.

## 지원 환경

- 패키징 호스트와 테스트 기기: macOS 13 이상
- 패키징 도구: Xcode/Swift toolchain, Node.js, macOS 기본 `codesign`과 `hdiutil`
- 아키텍처: 현재 내부 후보는 정확히 `arm64`만 허용한다. `x86_64` 또는 Universal
  Binary가 섞이면 조립·mount·최종 결과 검증에서 실패한다.

패키징 전 `uname -m`과 다음 명령의 출력을 비교한다.

```sh
file /absolute/path/to/blabee-coordinator
```

현재 단계는 Universal Binary 지원을 보장하지 않는다. Intel과 Apple Silicon을 모두
지원하려면 별도의 빌드·서명·실기기 검증이 필요하다.

## 빌드 절차

Blabee 앱 루트(`apps/blabee`)에서 다음 명령 하나만 실행한다. 빌더는 사용 가능한 전체 Xcode
toolchain을 선택하고, 저장소 밖의 새 private scratch에서 현재 Swift 소스를 release로
빌드한 뒤 그 실행 파일을 즉시 DMG로 패키징한다. 활성 toolchain이 Command Line
Tools이거나 깨져 있으면 `/Applications/Xcode.app`을 자동으로 확인하며, 사용할 수
있는 전체 Xcode가 없으면 이유를 포함해 실패한다.

```sh
npm run build:internal-dmg -- \
  --build-number N \
  --output "$PWD/Blabee-0.1.0-internal-arm64-YYYYMMDD-rN.dmg"
```

`N`은 `1`부터 `9999` 사이의 앞자리 0이 없는 정수다. 날짜가 바뀌어도 다시 `1`로
초기화하지 않고, 이전에 팀에 전달한 모든 내부 빌드보다 큰 번호를 명시한다. 빌더는
`--build-number`가 없거나 출력 파일명의 마지막 `-rN.dmg`와 다르면 Xcode를 실행하기
전에 실패한다. 시각이나 로컬 숨은 카운터로 번호를 자동 생성하지 않으므로, 빌드
담당자가 전달 이력에서 다음 번호를 선택해야 한다.

이 번호는 staging 앱의 `CFBundleVersion`에만 주입된다. 저장소의
`Packaging/macos/Info.plist` 템플릿과 private source snapshot은 수정하지 않는다.
조립된 앱, 읽기 전용으로 mount한 DMG 내부 앱, 결과 JSON이 모두 같은 번호인지
확인한 뒤에만 산출물을 게시한다.

`scripts/build-internal-dmg.mjs`는 fresh wrapper가 내부에서 호출하는 저수준 라이브러리다.
이 파일을 `node ... --binary` 형태로 직접 실행하는 CLI 경로는 비활성화되어 있으며,
사용자는 위 `npm run build:internal-dmg` 명령만 사용한다.

`build:internal-dmg`는 의도적으로 `--binary`를 받지 않는다. 매 실행마다 비어 있는
임시 scratch를 만들기 때문에 기존 `.build/release`나 예전 dogfood 바이너리를
재사용하지 않는다. Swift package뿐 아니라 DMG에 함께 들어가는 `Contracts/v1`,
`Plugin/blabee`, `Packaging/macos`까지 크기와 개수를 제한해 private scratch에
안정적으로 복사한다. Swift 빌드와 앱 조립은 모두 이 한 시점의 source snapshot만
사용한다. live source는 snapshot 생성 직후, 빌드 직후, 게시 직전에 최초 SHA-256과
파일 수를 다시 확인한다. 따라서 작업 중 잠깐 바뀌었다가 원상복구된 파일도 빌드와
리소스 복사에 섞이지 않으며, 영속 변경은 DMG 게시 전에 실패한다.
실패한 뒤에는 소스 변경을 마친 다음 같은 명령을 새 출력 이름으로 다시 실행한다.

`-debug-info-format none`은 테스터에게 전달할 앱에서 dSYM과 debug map을 만들지
않는다. 따라서 충돌 로그의 파일·행 symbolication 품질은 낮아진다. 별도의 dSYM이
필요한 릴리스에서는 이를 DMG에 넣지 말고 개발팀 전용 저장소에 보관한 뒤, 패키징할
실행 파일만 코드 서명 전에 별도로 strip하는 절차를 사용해야 한다.

경로 검사는 빌더 안에서 자동으로 수행한다. macOS의 `/Users/<계정명>/...` 형태가
바이너리에 남으면 패키징 전에 실패하므로, 해당 실행에서는 DMG가 생성되지 않는다.

빌더는 기존 출력 파일을 덮어쓰지 않는다. 같은 이름의 산출물이 이미 있으면 보존한
채 실패하므로, 새 버전이나 새 검증 시도에는 새 출력 이름을 사용한다.

출력 폴더는 개발자 본인만 쓰는 저장소 또는 시스템 임시 폴더를 사용한다. 빌더는
폴더의 real path와 inode를 주요 단계마다 다시 확인하지만, Node.js에는 macOS의
`openat`/`linkat` 계열 디렉터리 FD API가 없으므로 다른 프로세스가 출력 폴더 자체를
악의적으로 교체하는 상황까지 완전히 원자적으로 막는 도구는 아니다.
입력 파일 자체는 non-blocking·no-follow descriptor로 복사하지만, 같은 이유로 신뢰할
수 없는 동일 사용자 프로세스가 source 상위 디렉터리를 동시에 교체하는 상황까지
완전히 봉쇄하지는 않는다. 내부 DMG는 신뢰하는 로컬 checkout에서 다른 자동 수정
작업이 끝난 뒤 생성한다.

## 산출물 계약

성공 시 다음 두 파일이 함께 생성된다.

```text
Blabee-0.1.0-internal-arm64-YYYYMMDD-rN.dmg
Blabee-0.1.0-internal-arm64-YYYYMMDD-rN.dmg.sha256
```

DMG의 루트 구조는 다음과 같다.

```text
Blabee.app
Applications -> /Applications
INTERNAL_TESTING.txt
```

- `Blabee.app`: release coordinator와 제품 리소스를 포함한 ad-hoc 서명 앱
- `Applications`: 사용자가 앱을 복사할 수 있도록 제공하는 Finder 링크
- `INTERNAL_TESTING.txt`: 내부 전용, 미공증, 지원 환경과 안전한 첫 실행 안내

`Blabee.app` 안의 Codex 연결 리소스는 다음 위치에 포함된다.

```text
Blabee.app/Contents/Resources/.agents/plugins/marketplace.json
Blabee.app/Contents/Resources/Plugin/blabee/
```

- `marketplace.json`: 앱에 포함된 `blabee-app` marketplace의 고정 manifest
- `Plugin/blabee`: 같은 빌드에 포함된 Blabee Plugin payload

두 리소스는 한 설치 단위다. 다른 앱 버전이나 dogfood 산출물의 manifest와 Plugin을
서로 섞지 않는다.

## 앱의 Codex 연결 계약

사용자가 설정에서 **Codex 연결하기**를 누르면 앱은 셸 없이 공식 Codex 실행 파일에
다음 동작을 요청한다.

```text
codex plugin marketplace add <Blabee.app의 Contents/Resources 절대 경로> --json
codex plugin add blabee@blabee-app --json
```

명령의 exit code만으로 성공을 판단하지 않는다. 앱은 marketplace 목록과 Plugin
목록을 다시 조회해 이름, source, selector, 활성 상태가 방금 설치한 앱 리소스와
정확히 맞는지 확인한 뒤에만 설치됨으로 표시한다.

현재 내부 빌드는 Codex `0.151.0`, `0.152.0`, `0.152.1`, `0.153.2`, `0.153.4`를 Plugin 연결
대상으로 허용한다. `0.153.2` Apple Silicon 공식 배포본은 고정된 전체 파일 hash까지
일치해야 한다. PATH의 이름만 같은 파일은 실행하지 않는다. 후보의 소유권·쓰기 권한·
상위 경로·서명·버전을 확인하고, 모든 조회·설치·제거 프로세스 직전에 같은
identity인지 다시 검사한다. 지원하지 않는 첫 후보가 있어도 뒤의 안전한 지원 후보를
확인한다.

다른 Blabee marketplace 또는 dogfood Plugin이 이미 있으면 기본 연결은 충돌 상태로
중단한다. 다만 exact 이름·selector·local source·활성 상태가 모두 알려진 단일 구형
Blabee dogfood 계약과 일치하면, 앱은 사용자에게 별도의 두 단계 마이그레이션 동작을
제공할 수 있다. 사용자가 확인한 경우에만 그 exact Plugin과 marketplace를 제거하고 현재
`blabee@blabee-app`을 설치한다. 알 수 없는 충돌, 둘 이상의 구형 연결 또는 다른 Plugin은
변경하지 않는다. Hook 신뢰도 이 설치 동작에 포함하지 않는다. 사용자가 새 Codex 세션의
`/hooks`에서 네 Hook을 따로 검토해야 한다.

Marketplace만 등록되고 Plugin 설치가 끝나지 않은 부분 상태는 완료로 표시하지 않는다.
사용자는 앱에서 설치를 다시 시도하거나 Blabee가 소유한 exact Marketplace만 정리할 수
있다. exit code가 0이어도 사후 조회 결과가 바뀌지 않으면 성공으로 처리하지 않는다.

## 빌더의 자동 검증 범위

DMG 빌더는 성공을 보고하기 전에 다음을 검사한다.

- 입력 바이너리와 출력 경로가 명시적 절대 경로인지 확인한다.
- 입력 바이너리를 private 작업 폴더에 한 번 고정하고 SHA-256을 계산한 뒤 그
  snapshot만 앱 조립에 사용한다.
- 입력 파일은 최초 크기까지만 non-blocking·no-follow descriptor로 읽고, 읽는 동안
  잘리거나 늘어나거나 FIFO·symlink로 교체되면 실패한다. coordinator는 512 MiB,
  생성·복구 DMG는 1 GiB를 넘으면 처리하지 않는다.
- 기존 파일, symlink, 특수 파일 또는 안전 범위 밖의 출력을 거부한다.
- 같은 출력에 대한 프로세스별 잠금을 복구 시작부터 정리 완료까지 유지한다.
- 기존 macOS 앱 조립기를 사용해 `Blabee.app`을 만들고 ad-hoc 서명한다.
- 명시한 내부 build number가 조립된 앱과 mount한 DMG의 `CFBundleVersion`에 동일하게
  들어갔는지 확인한다.
- marketplace manifest가 정확히 `blabee-app`과 `./Plugin/blabee`를 가리키는지
  확인하고, manifest와 Plugin payload를 앱 리소스에 함께 넣는다.
- 조립된 앱을 `codesign --verify --deep --strict`로 확인한다.
- DMG 안에 위 세 항목만 있고 `Applications`가 정확히 `/Applications`를
  가리키는지 확인한다.
- 생성된 이미지를 `hdiutil verify`로 확인한다.
- attach가 mount 전에 일부만 진행된 경우에도 새 disk device를 찾아 강제 옵션 없이
  정상 detach하고, 해제를 증명하지 못하면 게시하지 않은 채 조사 파일을 보존한다.
- 완성된 DMG의 SHA-256을 계산하고 `.sha256` 파일에 기록한다.
- 게시 transaction schema v2는 산출물 identity와 함께 `build_number` 및
  `expected_architecture = arm64`를 봉인한다. 다음 실행은 두 값까지 정확히 일치하는
  checksum-only transaction만 소유권과 hash를 재검증해 복구한다. 과거 schema v1,
  살아 있는 빌더, 초기화 중인 잠금 또는 검증할 수 없는 잠금은 자동 복구·삭제하지
  않고 실패 폐쇄한다.
- 실패 중 만든 private staging과 같은 inode의 부분 산출물만 정리하며 기존 사용자
  파일은 덮어쓰거나 삭제하지 않는다. 정리 자체도 실패하면 최초 오류를 유지한 채
  정리 오류를 함께 보고한다.

2026-09-05 최종 소스는 전체 Node 346/346과 Swift Testing 568/568+XCTest 5/5를
통과했다. 패키징 회귀는 transaction v2의 build·architecture binding, legacy v1
fail-closed, x86/Universal 거부를 포함한다. 샌드박스에서 `hdiutil`이 차단된 실패와
코드 실패는 구분한다.
실행 환경과 실제 산출물 hash는 `T012_APP_BUNDLE_REPORT.md`와 `TASK_STATUS.md`에
기록한다.

### 2026-09-09 현재 후보 — r19

현재 DMG는 `build/internal-dmg-20260909-r19/Blabee-0.1.0-internal-arm64-20260909-r19.dmg`다.
build 19, arm64, SHA-256 `320b3fb7f53b33489b2d8ddd71b179865cde7bfaaff4d1b3be40e59bdaead396`.
전달 ZIP은 `build/tester-distribution/Blabee-0.1.0-internal-arm64-20260909-r19-testers.zip`을 사용한다.
DMG·sidecar, r19 안내 4개와 CONTENTS.sha256의 7개 파일만 묶는다. 구 PDF·사용자 설정·로그·
Codex 실행 파일은 넣지 않으며 r18 산출물은 보존한다. ZIP을 새 폴더에 풀어 내부 checksum과
문서 일치·상대 링크를 확인하고 외부 `.zip.sha256`도 별도로 검증한다.
설치 안내·백업 확인·실행 중 보호는 실환경에서 확인했지만 교체는 사용 중으로 차단됐다.
설치 완료·서비스·선택 반환·다른 Mac 검증은 아직 남아 있다.
테스터 안내: [r19 릴리스 기록](INTERNAL_DMG_R19_RELEASE_KO.md).
제작·실사용 관찰: [r19 설치 검증 기록](R19_INSTALLATION_ACCEPTANCE_KO.md).

### 역사적 검증 — 2026-09-09 r18

당시 전달 후보는 `build/internal-dmg-20260909-r18/Blabee-0.1.0-internal-arm64-20260909-r18.dmg`다.
build 18, arm64, SHA-256 `ae22851504d924b33dbce83acdf1790ae93e996c4c4eefbe8b1e585c85e213e2`.
전달 ZIP은 `build/tester-distribution/Blabee-0.1.0-internal-arm64-20260909-r18-testers.zip`이다.
DMG·sidecar와 최신 안내 4개·CONTENTS.sha256의 7개 파일로 구성한다.
Swift Testing 722개 + XCTest 5개, Node 360개 통과. Codex 본체를 동봉하거나 일반
실행을 감싸지 않는다. 검증된 r16·r17의 제한된 이전 runtime identity만 포함한다.
Hook 요청 단위 허용의 소스/회귀 검증과 실제 Pet 승인 왕복은 구분한다.
제작·검증·테스트 안내는 [r18 릴리스 기록](INTERNAL_DMG_R18_RELEASE_KO.md)을 따른다.

### 역사적 검증 — 2026-09-09 r17

당시 전달 후보는 `build/internal-dmg-20260909-r17/Blabee-0.1.0-internal-arm64-20260909-r17.dmg`다.
앱 `0.1.0`, build `17`, exact `arm64`, DMG SHA-256
`7d131ed04899a7ca78f4c3758a5965a7d90beb79260cd2f1b791336a72867bae`를 확인했다.
Node 360개, Swift Testing 696개 및 XCTest 5개를 이번 제작 전에 다시 통과했다.
검증된 r15 DMG 앱과 설치된 build 16의 제한된 이전 runtime identity 정책을 포함하며
이전 실행 파일이나 공식 Codex를 복사하지 않는다.

전달용 ZIP은 `build/tester-distribution/Blabee-0.1.0-internal-arm64-20260909-r17-testers.zip`이다.
ZIP에는 DMG, `.dmg.sha256`, `TESTER_START_HERE_KO.md`, `INTERNAL_TEST_INSTALL_GUIDE.md`,
`INTERNAL_DMG_R17_RELEASE_KO.md`, `TESTER_RESULT_TEMPLATE_KO.md`, `CONTENTS.sha256`만 넣는다.
압축을 푼 뒤 내부 checksum을 확인하며, 구 PDF·소스·사용자 설정·로그·Codex 바이너리는 넣지 않는다.
기존 ZIP/DMG는 덮어쓰거나 삭제하지 않는다. 다른 Mac 설치 및 실제 왕복은 아직 미검증이다.
제작·소스 식별자·테스트와 알려진 제한은 [r17 릴리스 기록](INTERNAL_DMG_R17_RELEASE_KO.md)을 따른다.

### 역사적 검증 — 2026-09-08 r14

당시 후보는 `build/internal-dmg-20260908-r14/Blabee-0.1.0-internal-arm64-20260908-r14.dmg`다.
당시 소스의 private fresh release 빌드에서 생성했다. 앱 `0.1.0`, build `14`, exact `arm64`,
DMG SHA-256 `1318370593222d207435c55544260d08bf808cfb43d9155b0d772215ab48db51`을 확인했다.
Node 360개, Swift Testing 668개 및 XCTest 5개가 모두 통과했다. 내장 한국어 내부 테스트
안내도 mount 검증 테스트에 포함된다. 자세한 식별자와 결과는
[r14 릴리스 기록](INTERNAL_DMG_R14_RELEASE_KO.md)에 있다.

새 DMG는 앱 실행형 서비스 모드를 포함한다. 기본 꺼짐이며 설정에서 사용자가 직접 켠다.
기존 macOS 자동 시작 등록은 먼저 명시적으로 해제한다. 정상 연결·종료·재실행과 단일
Codex 선택 왕복은 build 13의 개발 Mac 설치본에서 통과했고, r14 DMG 설치 검증을 대신하지 않는다.
첫 Keychain 승인 지연과 서비스 메모리 증가 조사는 계속 열려 있다. DMG 검증만으로
SMAppService 서명 장애 해결·장시간 안정성·다른 Mac 배포 자격을 주장하지 않는다.
앱은 ad-hoc 서명, DMG는 미서명·미공증이며 `public_distribution_ready = false`다.
r8 등 이전 DMG는 superseded local artifact로 보존하며 새 테스터에게 전달하지 않는다.

### 역사적 검증 — 2026-09-05 r8

당시 내부 후보는
`build/internal-dmg-20260905-r8/Blabee-0.1.0-internal-arm64-20260905-r8.dmg`다.
앱 버전 `0.1.0`, build `8`, exact `arm64`, DMG SHA-256
`e0dbe4ff31713a76df9b38dd3e94f799d53f1bbfec86350cc28d35afd2bffa31`을 확인했다.
앱은 ad-hoc 서명됐고 DMG 자체는 미서명·미공증이며
`public_distribution_ready = false`다. r7과 그 이전 산출물은 superseded local
artifact로 취급하고 배포하지 않는다.

r8은 한 개발 Mac의 `/Applications/Blabee.app`에 설치해 버전 `0.1.0`, build `8`,
최소 macOS 13, exact `arm64`와 deep/strict ad-hoc 서명을 다시 확인했다. 첫 service
시작은 기존 ad-hoc 등록의 LWCR 갱신 오류로 실패했지만, 앱의 명시적 서비스 재시작이
unregister/re-register와 새 BTM 등록을 수행한 뒤 launchd running과 service 응답을
확인했다. 이는 clean Mac·다른 macOS 또는 seamless upgrade 자격이 아니다.

설치된 Doctor는 coordinator runtime, app bundle, embedded coordinator, MCP runtime,
daemon, reconciliation과 project scope를 통과했다. Codex `0.153.2`의 managed runtime
identity/version/code-mode allowlist는 계속 실패한다. 이는 일반 `0.153.2` Plugin CLI
호환성과 별개이며 관리형 승인 지원을 뜻하지 않는다.

## 실패했을 때

`hdiutil create failed - 장치가 구성되지 않았음`은 macOS DiskImages가 일시적으로
이미지를 만들지 못한 경우에도 나타날 수 있다. 빌더는 중복 실행을 피하기 위해 이를
자동 재시도하지 않는다. 남은 Blabee mount가 없고 출력 DMG·checksum·잠금이 없는지
확인한 뒤 같은 명령을 한 번 다시 실행한다.

숨겨진 `.blabee-internal-dmg.lock`, transaction marker 또는 보존된 work directory가
있다면 직접 삭제하지 않는다. 다른 빌더가 살아 있거나 안전한 detach를 증명하지
못했을 수 있으므로 경로와 원래 오류를 함께 개발 담당자에게 전달한다.

## 팀원에게 전달하고 확인하는 방법

DMG와 `.sha256` 파일을 반드시 함께 전달한다. 받은 팀원은 두 파일이 있는 폴더에서
먼저 checksum을 확인한다.

앱 설치, Pet 설정, 앱 실행형 서비스, Codex Plugin 연결과 제거 절차는
[`INTERNAL_TEST_INSTALL_GUIDE.md`](./INTERNAL_TEST_INSTALL_GUIDE.md)를 따른다.
일반 테스터는 소스 기반 dogfood 절차를 사용하지 않는다. DMG를 설치한 뒤 Blabee
설정의 **Codex 연결하기**를 사용하고, 새 Codex 세션의 `/hooks`에서 Hook 네 개를
직접 검토한다.

```sh
shasum -a 256 -c Blabee-0.1.0-internal-arm64-YYYYMMDD-rN.dmg.sha256
```

검사가 성공한 경우에만 다음 순서로 진행한다.

1. DMG를 연다.
2. `Blabee.app`을 같은 창의 `Applications` 링크로 끌어 복사한다.
3. Finder의 응용 프로그램 폴더에서 Blabee를 연다.
4. macOS가 미공증 내부 앱을 차단하면 Finder에서 앱을 Control-클릭(또는
   우클릭)한 뒤 **열기**를 선택한다.
5. 해당 선택이 제공되지 않으면 **시스템 설정 → 개인정보 보호 및 보안**에서
   차단된 Blabee에 대해 **확인 없이 열기**를 사용한다.

`xattr`로 quarantine을 제거하거나 `spctl` 또는 Gatekeeper를 시스템 전체에서
비활성화하는 명령은 사용하지 않는다. 조직 정책으로 열 수 없다면 우회하지 말고
테스트를 중단해 배포 담당자에게 알린다.

## 깨끗한 Mac 수동 스모크 테스트

DMG 검증 성공만으로 제품 설치가 완료된 것은 아니다. 소스 체크아웃과 기존 Blabee
상태가 없는 깨끗한 Mac에서 최소한 다음을 직접 확인해야 한다.

- DMG mount, checksum 확인, `/Applications` 복사가 정상인지
- 첫 실행과 Gatekeeper 안내가 실제 사용자에게 이해 가능한지
- Pet 메뉴바 아이콘과 창이 정상 표시되는지
- 지원 Codex가 별도로 설치된 상태에서 **Codex 연결하기**가 Plugin을 등록하는지
- Plugin 설치 상태와 Hook 신뢰 필요 상태가 구분되어 표시되는지
- 새 Codex 세션의 `/hooks`에서 `SessionStart`, `UserPromptSubmit`, `Stop`,
  `PermissionRequest`를 직접 검토하고 신뢰할 수 있는지
- 기존 macOS 등록의 명시적 해제, 앱 실행형 opt-in 및 실제 프로젝트 활성화가 정상인지
- Codex 답변 완료 → Pet 카드 → 선택 → 같은 세션 다음 턴 왕복이 정상인지
- 앱 종료·재실행과 Mac 재로그인 뒤 상태가 일관적인지

따라서 DMG 생성, `hdiutil verify`, checksum 성공은 Pet/Hook 왕복,
`SMAppService` 등록 또는 실제 Plugin 설치 성공의 증거로 사용하지 않는다. Plugin
설치는 공식 Codex CLI 실행 뒤 marketplace와 Plugin 상태를 재조회해 별도로
확인하며, Hook 신뢰는 `/hooks`에서 사용자가 따로 확인한다.

## 공개 배포로 전환하기 전에 남은 작업

내부 DMG를 그대로 공개 배포물로 승격하지 않는다. 공개 릴리스에는 별도의 다음
단계가 필요하다.

1. 앱 버전과 build number를 릴리스 입력에서 주입하고 산출물 이름과 일치시킨다.
2. Apple Silicon 전용인지 Universal 지원인지 결정하고 각 아키텍처를 검증한다.
3. 모든 내장 실행 파일과 앱을 안쪽에서 바깥쪽 순서로 Developer ID 서명한다.
4. 완성된 DMG 자체도 배포 identity로 서명한다.
5. `notarytool` 제출, 성공 결과 보존, `stapler` 적용과 검증을 수행한다.
6. Gatekeeper 평가와 인터넷 다운로드 quarantine을 깨끗한 Mac에서 검증한다.
7. 설치·업데이트·다운그레이드·제거와 데이터 보존 정책을 검증한다.
8. 서명된 업데이트 피드와 자동 업데이트 도입 여부를 결정한다.

Developer ID 인증서, Apple ID/App Store Connect credential, notary profile은 이
저장소나 내부 DMG 스크립트에 저장하지 않는다.

## ad-hoc 내부 앱 업데이트 제한

`CFBundleVersion` 증가는 서로 다른 앱 빌드를 구분하고 진단하는 데 필요하지만,
그 자체로 macOS background item의 코드 제약 갱신을 보장하지 않는다. ad-hoc 서명은
빌드 내용이 바뀔 때 code identity도 달라질 수 있기 때문이다. 실제로 2026-09-05의
동일 build `1` r5→r6 교체에서는 `SMAppService` 상태가 enabled여도 launchd가
`OS_REASON_CODESIGNING`, `needs LWCR update`를 보고하며 service 실행을 거부했다.

내부 ad-hoc 앱을 업데이트할 때 macOS 서비스 등록이 남아 있다면 **구버전 앱이 아직
설치된 상태에서** 명시적으로 등록 해제하고 `등록되지 않음`을 확인한다. 앱 실행형만
사용한다면 등록 해제는 필요 없지만 Blabee를 완전히 종료해 소유 자식이 종료되어야 한다.
그 다음 새 앱 번들 전체를 교체하고 더 큰 `CFBundleVersion`을 확인한다. 새 앱에서는
기억된 앱 실행형 모드의 자동 연결을 확인하거나 직접 켠다. `launchctl bootout`,
`bootstrap` 또는 `sfltool resetbtm`을 정상 업데이트 절차에 섞지 않는다.

이 절차도 seamless upgrade나 승인 연속성을 보장하는 공개 배포 해법은 아니다. 내부
테스트에서는 특정 산출물이 clean registration 뒤 실제 service socket에 응답했다는
범위까지만 승인한다. 안정적인 업데이트 정체성은 Apple Development 또는 Developer ID
서명과 지원 macOS별 실기기 검증으로 별도 자격화해야 한다.

2026-09-05 r8 로컬 설치에서는 첫 LWCR repair가 실패한 뒤 앱의 명시적 서비스 재시작
한 번으로 새 BTM 등록과 실제 service 응답을 확인했다. 같은 설치의 6-sample idle
`top`은 UI와 service 각각 0.0~0.1% CPU, 메모리 약 65 MiB와 151 MiB였고, 최근 2분
freshness-key 로그에는 실제 access entry가 없었다. 짧은 단일 Mac 표본이므로 장시간
발열·전력 또는 다른 환경의 성능 증거로 확대하지 않는다. 이 내부 업데이트 제약을
제거하려면 안정적인 Developer ID 서명·공증과 지원 macOS별 업데이트 검증이 필요하다.
