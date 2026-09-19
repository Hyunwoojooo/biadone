# Blabee 배포용 DMG 빌드와 공증

이 경로는 기존 `build:internal-dmg`의 ad-hoc 빌드를 유지하면서 Developer ID로 서명한
배포 후보를 만든다. `build:release-dmg` 완료는 서명된 후보 생성이며,
`notarize:dmg`에서 Apple의 `Accepted`, stapling, Gatekeeper 검사를 통과한 파일이
테스터에게 전달할 최종 DMG다. 앱 기능과 다른 Mac의 첫 설치 검증은 별도로 진행한다.

## 준비

- Apple Silicon Mac, 전체 Xcode, Node.js 22 이상
- Keychain에 개인 키와 함께 설치된 유효한 **Developer ID Application** 인증서
- `notarytool`에서 사용할 Keychain 프로필
- 이전 전달본보다 큰 빌드 번호와 새 출력 경로

현재 앱 버전은 `0.1.0`, 대상은 `arm64`, 최소 macOS는 `13.0`이다. Intel/Universal
바이너리를 만들거나 앱 버전 템플릿을 자동 변경하지 않는다. 빌드 번호는
`CFBundleVersion`에 주입하며 출력 이름의 `-rN.dmg`와 일치해야 한다.

이 프로젝트에서 사용하는 배포 identity는
`Developer ID Application: Hyunwoo Joo (VN7AMDG677)`, Team ID는 `VN7AMDG677`이다.
인증서 이름과 Team ID는 CLI에 명시한다. 암호나 개인 키는 저장소와 명령에 넣지 않는다.
macOS에서 개인 키 사용 확인이 뜨면 개발자가 시스템 대화상자를 직접 확인한다.

## 서명된 후보 생성

`apps/blabee`에서 실행한다. 출력 폴더는 먼저 만들고, 기존 산출물이 없는 이름을 쓴다.

```sh
mkdir -p "$PWD/build/release-r39"
npm run build:release-dmg -- \
  --build-number 39 \
  --identity "Developer ID Application: Hyunwoo Joo (VN7AMDG677)" \
  --team-id VN7AMDG677 \
  --output "$PWD/build/release-r39/Blabee-0.1.0-arm64-r39.dmg"
```

기존 내부 빌드에서 업그레이드를 검증할 때는 정확한 이전 앱을 최대 두 개까지
`--compatible-previous-app /absolute/path/to/Blabee.app`으로 추가한다. 이것은 이전
런타임 identity의 검증 자료를 포함하는 기능이며 실행 중인 앱의 교체 제한을 해제하지
않는다. 빌드나 공증 과정은 `/Applications/Blabee.app`, Codex 세션, 사용자 설정을
교체하거나 재시작하지 않는다.

빌더가 수행하는 작업:

1. 현재 Swift 소스와 제품 리소스를 별도 폴더에 고정하고 새 Release 바이너리를 만든다.
2. 앱을 조립하고 `Developer ID Application`, Hardened Runtime, secure timestamp로 서명한다.
3. Apple Developer ID 인증서 체인, Team ID, bundle identifier, timestamp와 runtime을 확인한다.
4. 앱과 Applications 링크, 설치 안내를 담은 DMG를 만들고 같은 identity로 서명한다.
5. DMG를 읽기 전용으로 마운트해 내부 앱과 내용물을 검사하고 마운트를 해제한다.

현재 앱의 서명 대상은 주 실행 파일을 가진 앱 번들 하나다. 리소스의 셸 launcher는
번들 리소스로 봉인된다. 허용 목록에 없는 추가 실행 파일은 패키징을 실패시킨다.
앞으로 framework, helper, 중첩 앱을 추가할 때는 내부 구성 요소부터 서명하도록
목록과 검증을 함께 확장해야 한다. `codesign --deep`은 검증에만 사용한다.

이 단계의 SHA-256은 **공증 전 후보**의 값이다. 공증 후 생성되는 최종 값으로 교체된다.

## Apple 제출과 최종 검증

```sh
npm run notarize:dmg -- \
  --dmg "$PWD/build/release-r39/Blabee-0.1.0-arm64-r39.dmg" \
  --team-id VN7AMDG677 \
  --keychain-profile blabee-notary \
  --keychain "$HOME/Library/Keychains/login.keychain-db"
```

프로필은 Keychain에서만 읽는다. 스크립트는 기존 인증 정보를 생성·변경·내보내지 않는다.
Apple에 보내는 파일은 명시한 DMG다.

제출 ID와 제출 시점의 SHA-256을 기록한 뒤 처리 결과를 확인한다. 대기 제한 내에
완료되지 않으면 `In Progress`로 남기고 종료 코드 `2`를 반환한다. 다음 실행에
`--resume`을 붙이면 같은 제출 ID를 확인하며 중복 제출하지 않는다.

```sh
npm run notarize:dmg -- \
  --dmg "$PWD/build/release-r39/Blabee-0.1.0-arm64-r39.dmg" \
  --team-id VN7AMDG677 \
  --keychain-profile blabee-notary \
  --keychain "$HOME/Library/Keychains/login.keychain-db" \
  --resume
```

- `Accepted`: Apple 로그를 저장하고 ticket을 붙여 검증한다. 서명과 Gatekeeper 검사 후
  최종 DMG의 SHA-256을 계산한다.
- `Invalid`: Apple 로그에 기록된 문제를 수정하고 새 후보를 만든다. 성공으로 표시하거나
  배포용 checksum을 확정하지 않는다.
- `In Progress`: 같은 ID로 기다린다. 새 제출을 만들지 않는다.
- 업로드 결과를 확인하지 못한 경우: 자동 재제출하지 않는다. Apple 제출 이력에서 ID를
  확인한 뒤 `--submission-id`를 사용한다. 파일과 제출 로그의 SHA-256이 일치해야 한다.

## 전달할 파일과 개발 기록

- `Blabee-0.1.0-arm64-r39.dmg`: 공증 및 stapling을 완료한 최종 설치 파일
- `Blabee-0.1.0-arm64-r39.dmg.sha256`: **최종 DMG**의 SHA-256
- `<DMG>.notarization.json`: 제출 ID, 단계, 검증 결과
- `<DMG>.notarization.log.json`: Apple의 공증 결과 로그

테스터에게는 DMG와 checksum을 전달한다. 제출 ID·로그와 사용한 소스/빌드 기록은
개발 기록으로 보관한다. `Accepted`만 확인하고 stapling 전 파일이나 예전 checksum을
전달하지 않는다. 공증은 앱 기능 검증이나 GitHub Releases 게시를 대신하지 않는다.

## 다른 Mac에서 확인할 항목

빌드에 사용하지 않은 Apple Silicon Mac에서 실제 전달 경로로 다운로드한다.

1. Gatekeeper 경고 우회 없이 DMG를 열고 Applications에 설치한 뒤 최초 실행한다.
2. 메뉴바 아이콘과 Pet 표시, 서비스 연결 상태를 확인한다.
3. Blabee 설정에서 Codex 연결을 등록하고 새 Codex 세션에서 Hook을 검토한다.
4. 결정 카드 선택, 승인 요청, 동시에 도착한 이벤트와 `⌥←`/`⌥→` 이동을 확인한다.
5. 앱을 정상 종료하고 다시 열어 설정과 연결이 유지되는지 확인한다.

처음 보는 macOS 권한 요청과 실제 사용 화면은 테스터가 직접 확인한다.
GitHub 업데이트와 Blabee 관리 Codex 세션의 종료·복원은
[자동 업데이트 설계와 검증 항목](docs/AUTOMATIC_UPDATES.md)을 따른다.
기존 r39/r40 설치 파일에는 이 기능이 없으며, 새 updater를 처음 적용할 때에는
수동 설치가 필요하다. 외부에서 이미 실행 중인 Codex는 처음 한 번 정상 종료하고
관리 세션으로 전환해야 한다.

## 근거

- [Apple: Creating distribution-signed code for macOS](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [Apple: Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [Apple TN3127: Code signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
