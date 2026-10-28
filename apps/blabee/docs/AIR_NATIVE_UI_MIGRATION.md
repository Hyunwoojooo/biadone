# Air UI 네이티브 적용 — 2026-09-16

사용자 요청: 기존 Blabee 기능을 최대한 보존하며 `ui-demos/air-v1`에서 검토한 UI를 실제 SwiftUI/AppKit 화면에 적용한다.

## 적용 기준

- 폭 460pt, 기존 창 위치·화면 경계·비활성 패널 정책을 유지한다.
- Air 재질, 38pt 곡률, 두 열 카드, 여러 줄 제목, 권장 배지, 도트 벌과 시계 눈금을 적용한다. 준비 상태 본문은 `Waiting`으로 표시한다.
- 카드 클릭과 등록된 단축키는 기존 직접 선택 경로를 사용한다. 웹 데모의 임시 데이터·전송 시뮬레이션은 사용하지 않는다.
- 실제 선택 identity, 요청별 승인 범위, 전송 중 차단, 위험 확인, 작업 이동, 건너뛰기, 상세 키 해제 동작을 보존한다.
- 일반·단축키·프로젝트·연결 설정 탭을 도입하고 계정, 진단, 서비스, 관리 세션과 설치·복원 기능의 접근 경로를 유지한다.
- 실제 업데이트 결과 중 최신/업데이트 가능만 버튼에 3초 표시한다. 실패·배포 없음은 최신 버전으로 오인시키지 않는다.
- 새로운 의존성, WebKit 제품 전환, 서비스/IPC/저장 형식 변경, 실제 승인 요청 실행은 범위에 포함하지 않는다.

## 작업 상태

- [x] 기존 동작 진입점과 회귀 검사 확인
- [x] 공통 재질·선택·상세·대기 화면 적용
- [x] 설정 탭·업데이트 피드백 및 기존 설정 보존
- [x] 네이티브 렌더링·기능 회귀 검사
- [x] 검토용 앱 빌드와 검증 결과 기록

기존 미커밋 변경을 기준으로 작업한다. 현재 설치 앱을 강제 종료하거나 배포물을 게시하지 않는다.

## 검증 결과 — 2026-09-17

- Swift 기능·렌더링 회귀 검사: **227 tests / 19 suites 통과**. 승인 우선순위와 요청 identity, 중복 전송 차단, 단축키, 상세 키 해제, 이벤트 이동, 건너뛰기, 설정 초안·탭 복원, 업데이트 표시 및 업데이트 트랜잭션을 포함한다.
- 네이티브 Air 렌더링: 460/340pt, 밝게/어둡게, 불투명 표면, 2~4개 카드와 긴 제목을 검사했다. 로컬 Vision OCR과 렌더 좌표, 스크롤 끝 문구로 가시성을 확인했다. 실제 선택·승인·포커스 변경 요청은 발생하지 않았다.
- 네 개 카드에서 하단이 가려지던 높이를 수정했다. 1~2개는 500pt, 3~4개는 650pt를 사용하고 화면 경계에 따라 줄어들면 내용만 스크롤한다. 하단 건너뛰기 등의 버튼은 고정된다.
- 설정 탭을 옮길 때 단축키 초안이 유지되며, 승인 화면이 끼어들어도 모델의 선택 탭이 유지된다. 설정을 닫으면 미완료 cleanup 확인은 취소된다.
- 수정 파일의 `git diff --check` 통과. 제품 의존성을 추가하지 않았다.

검사 로그: `/private/tmp/blabee-air-native-regression.log`.
렌더 이미지: `/private/tmp/blabee-air-native-render/`, `/private/tmp/blabee-air-native-renders/`.

검증 범위: 테스트는 가짜 전송과 오프스크린 화면을 사용한다. 실제 Codex 세션 왕복, 설치 앱에서의 전역 단축키, VoiceOver, macOS 실시간 유리 합성은 별도 실행 확인이 필요하다. 불투명 표면 검사는 같은 분기를 사용하는 테스트 환경값으로 수행했고 시스템의 투명도 감소 설정을 변경하지 않았다.

## 검토용 앱

- 현재 설치용 경로: `build/local-air-review-20260917-r46-compatible-5B7qzc/Blabee.app`
- 최초 검토본: `build/local-air-review-20260917-r46-a5ilCa/Blabee.app`. 설치본 45의 호환 정보가 없으므로, 실제 교체에는 아래 보완본을 사용한다.
- 버전: 0.1.0 / build 46. 공개 릴리스 번호 예약이 아닌 로컬 검토용 빌드다.
- 현재 작업 소스의 제한된 스냅샷 197개 파일로 새 arm64 Swift Release 빌드와 앱 조립을 완료했다. 빌드 전후 원본·스냅샷 fingerprint 일치도 확인했다.
- 입력 SHA-256: `fce1768ce0e31fbacaddff7f5b364dc6b8f317251895335b5f467aefec51efef`
- 기존 조립기의 번들·리소스 검증, ad-hoc Hardened Runtime 서명, `codesign --verify --deep --strict`를 통과했다. Developer ID 배포 서명·공증·업로드는 수행하지 않았다.
- 빌드 로그: `/private/tmp/blabee-air-review-build.log`

설치된 `/Applications/Blabee.app`이나 실행 중인 Blabee·Codex를 교체·종료하지 않았다. 검토 빌드를 실제로 설치한 뒤 카드 선택, 겹친 승인 요청, Option+방향키 이동, 상세 미리보기 키 해제 및 설정 저장을 실제 세션에서 확인하는 것이 다음 단계다.

### 설치 호환 정보 보완 — 2026-09-17

최초 r46에는 manifest의 `compatible_previous_runtimes`와 plist의
`BlabeeRuntimeUseLeasePreviousIdentities`가 모두 비어 있었다. 현재 설치본은 45이며,
이 경우 설치기는 이전 경로 검사로 돌아가 오래된 실행 파일을 쓰면서 현재 경로를
보고하는 보조 프로세스까지 차단할 수 있다. 현재 Codex의 보조 프로세스가 설치본 45를
실제로 사용하는 것도 별도로 확인했으므로, 보완 후에도 그 사용 잠금은 보호한다.

원래 r46 빌드의 입력을 그대로 사용해 새 경로에 재조립했다.

- 바이너리: `/tmp/blabee-air-review-r46-F5UEmj/swift-build/arm64-apple-macosx/release/blabee-coordinator`
- 리소스 스냅샷: `/tmp/blabee-air-review-r46-F5UEmj/release-source`
- 서명 전 바이너리 SHA-256: `a881a6206f7443e86770a33ca19e74caf68e8aef2c3593f223b06894c20bae3b` — 최초 r46 manifest와 일치.
- `assembleMacOSApp`에 `bundleVersion: "46"`, `compatiblePreviousApps: ["/Applications/Blabee.app"]`, 원래 `sourceRoot`와 바이너리를 지정했다. Swift 소스와 바이너리는 다시 수정·컴파일하지 않았다.
- 새 두 호환 목록에 설치본 45의 정확한 identity `sha256:c84adf4cf0f045c43c8083686d0e20e9a553c2c3507bd7795a8a6d239cc6fe29`가 포함됐다.
- manifest의 payload 24개를 비교했으며, 호환 목록이 추가된 `Contents/Info.plist` 이외의 항목은 동일했다. 앱 서명 정보와 assembly manifest는 재생성됐다.
- 새 앱의 `codesign --verify --deep --strict`, plist 검사 통과. 설치된 45의 실행 파일 해시는 유지됐다.

기존 r46 설치창을 닫고 보완본의 45 → 46 표시까지 확인했다. 실제 교체와 Air UI의 실사용 검증은 아직 수행하지 않았다. 작업을 저장하고 현재 설치본을 사용하는 Codex 세션 및 Blabee를 정상 종료한 뒤 다음 앱을 설치한다.

```sh
open -n "/Users/joo/BiaDone/apps/blabee/build/local-air-review-20260917-r46-compatible-5B7qzc/Blabee.app"
```

이후 로컬 업데이트용 앱을 조립할 때는 현재 설치본을 `--compatible-previous-app /Applications/Blabee.app`으로 명시하고, 조립 후 두 호환 목록에 그 정확한 identity가 포함됐는지 확인한다. 이 옵션 없이 만든 새 설치용 패키지가 기존 설치본의 실행 잠금 프로토콜을 자동으로 신뢰하는 것은 아니다.
