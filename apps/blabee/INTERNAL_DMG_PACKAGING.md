# Blabee 내부 테스트용 DMG 패키징

- 작성일: 2026-09-03
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
- 아키텍처: 빌드한 `blabee-coordinator` 바이너리가 지원하는 아키텍처와 테스트
  기기의 아키텍처가 같아야 한다.

패키징 전 `uname -m`과 다음 명령의 출력을 비교한다.

```sh
file /absolute/path/to/blabee-coordinator
```

현재 단계는 Universal Binary 지원을 보장하지 않는다. Intel과 Apple Silicon을 모두
지원하려면 별도의 빌드·서명·실기기 검증이 필요하다.

## 빌드 절차

저장소 루트가 `/Users/joo/BiaDone/apps/blabee`인 개발 환경의 예시는 다음과 같다.
각 입력과 출력은 반드시 절대 경로로 지정한다.

```sh
swift build -c release \
  --package-path /Users/joo/BiaDone/apps/blabee/src/coordinator-swift

npm run build:internal-dmg -- \
  --binary /Users/joo/BiaDone/apps/blabee/src/coordinator-swift/.build/release/blabee-coordinator \
  --output /Users/joo/BiaDone/apps/blabee/build/internal-dmg/Blabee-0.1.0-internal.dmg
```

빌더는 기존 출력 파일을 덮어쓰지 않는다. 같은 이름의 산출물이 이미 있으면 보존한
채 실패하므로, 새 버전이나 새 검증 시도에는 새 출력 이름을 사용한다.

출력 폴더는 개발자 본인만 쓰는 저장소 또는 시스템 임시 폴더를 사용한다. 빌더는
폴더의 real path와 inode를 주요 단계마다 다시 확인하지만, Node.js에는 macOS의
`openat`/`linkat` 계열 디렉터리 FD API가 없으므로 다른 프로세스가 출력 폴더 자체를
악의적으로 교체하는 상황까지 완전히 원자적으로 막는 도구는 아니다.

## 산출물 계약

성공 시 다음 두 파일이 함께 생성된다.

```text
Blabee-0.1.0-internal.dmg
Blabee-0.1.0-internal.dmg.sha256
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

현재 내부 빌드는 OpenAI 서명과 파일 identity를 확인한 Codex `0.151.0`, `0.152.0`,
`0.152.1`만 Plugin 연결 대상으로 허용한다. PATH의 이름만 같은 파일은 실행하지
않는다. 후보의 소유권·쓰기 권한·상위 경로·서명·버전을 확인하고, 모든 조회·설치·
제거 프로세스 직전에 같은 identity인지 다시 검사한다. 지원하지 않는 첫 후보가 있어도
뒤의 안전한 지원 후보를 확인한다.

다른 Blabee marketplace 또는 dogfood Plugin이 이미 있으면 자동 제거·교체하지 않고
충돌 상태로 중단한다. Hook 신뢰도 이 설치 동작에 포함하지 않는다. 사용자가 새 Codex
세션의 `/hooks`에서 네 Hook을 따로 검토해야 한다.

Marketplace만 등록되고 Plugin 설치가 끝나지 않은 부분 상태는 완료로 표시하지 않는다.
사용자는 앱에서 설치를 다시 시도하거나 Blabee가 소유한 exact Marketplace만 정리할 수
있다. exit code가 0이어도 사후 조회 결과가 바뀌지 않으면 성공으로 처리하지 않는다.

## 빌더의 자동 검증 범위

DMG 빌더는 성공을 보고하기 전에 다음을 검사한다.

- 입력 바이너리와 출력 경로가 명시적 절대 경로인지 확인한다.
- 입력 바이너리를 private 작업 폴더에 한 번 고정하고 SHA-256을 계산한 뒤 그
  snapshot만 앱 조립에 사용한다.
- 기존 파일, symlink, 특수 파일 또는 안전 범위 밖의 출력을 거부한다.
- 같은 출력에 대한 프로세스별 잠금을 복구 시작부터 정리 완료까지 유지한다.
- 기존 macOS 앱 조립기를 사용해 `Blabee.app`을 만들고 ad-hoc 서명한다.
- marketplace manifest가 정확히 `blabee-app`과 `./Plugin/blabee`를 가리키는지
  확인하고, manifest와 Plugin payload를 앱 리소스에 함께 넣는다.
- 조립된 앱을 `codesign --verify --deep --strict`로 확인한다.
- DMG 안에 위 세 항목만 있고 `Applications`가 정확히 `/Applications`를
  가리키는지 확인한다.
- 생성된 이미지를 `hdiutil verify`로 확인한다.
- attach가 mount 전에 일부만 진행된 경우에도 새 disk device를 찾아 강제 옵션 없이
  정상 detach하고, 해제를 증명하지 못하면 게시하지 않은 채 조사 파일을 보존한다.
- 완성된 DMG의 SHA-256을 계산하고 `.sha256` 파일에 기록한다.
- 게시 도중 중단된 checksum-only transaction은 다음 실행에서 소유권과 hash를
  재검증한 뒤 복구한다. 살아 있는 빌더, 초기화 중인 잠금 또는 검증할 수 없는
  잠금은 자동 삭제하지 않고 실패 폐쇄한다.
- 실패 중 만든 private staging과 같은 inode의 부분 산출물만 정리하며 기존 사용자
  파일은 덮어쓰거나 삭제하지 않는다. 정리 자체도 실패하면 최초 오류를 유지한 채
  정리 오류를 함께 보고한다.

2026-09-03 기준 실제 DMG 집중 테스트 12/12와 전체 T-012 패키징 테스트 26/26가
통과했다. 실행 환경과 실제 산출물 hash는 `T012_APP_BUNDLE_REPORT.md`와
`TASK_STATUS.md`에 기록한다.

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

앱 설치, Pet 설정, 서비스 등록, Codex Plugin 연결과 제거 절차는
[`INTERNAL_TEST_INSTALL_GUIDE.md`](./INTERNAL_TEST_INSTALL_GUIDE.md)를 따른다.
일반 테스터는 소스 기반 dogfood 절차를 사용하지 않는다. DMG를 설치한 뒤 Blabee
설정의 **Codex 연결하기**를 사용하고, 새 Codex 세션의 `/hooks`에서 Hook 네 개를
직접 검토한다.

```sh
shasum -a 256 -c Blabee-0.1.0-internal.dmg.sha256
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
- 프로젝트 활성화와 `SMAppService` 등록·해제 흐름이 정상인지
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
