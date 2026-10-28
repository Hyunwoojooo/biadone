# T-012b-3b Pet 온보딩 UI 보고서

업데이트: 2026-08-22
상태: UI·수명주기 어댑터 코드 계약 자격 완료, 실제 자동 시작 미승인

## 결과

Pet 설정 화면에 제품 서비스 상태와 프로젝트 활성화 설정을 연결했다. 앱 시작이나
주기적 snapshot 갱신은 상태를 읽기만 하며 자동으로 서비스를 등록하지 않는다.

```text
Pet의 명시적 온보딩 버튼
  → PetViewModel single-flight
    → PetOnboardingAdapting
      ├─ service status/config 읽기
      ├─ 등록·해제·System Settings 열기
      └─ 기존 ProductServiceSettingsWriter로 프로젝트 enable/disable
```

운영 어댑터는 번들 LaunchAgent
`com.biadone.blabee.coordinator.plist`의 `SMAppService.agent(plistName:)`를 사용한다.
`notRegistered`, `enabled`, `requiresApproval`, `notFound`와 알 수 없는 상태를
구분하며 `notFound`와 알 수 없는 상태에서는 변경 버튼을 fail-closed한다.
`enabled`는 등록·실행 자격을 뜻할 뿐 daemon health를 증명하지 않는다.

## 명시적 동작 경계

- 등록, 해제, System Settings 열기, 프로젝트 추가·제거는 대응하는 사용자 버튼에서만
  호출한다.
- 앱 시작, UDS poll, snapshot 갱신, 온보딩 화면 열기는 등록 상태와 설정만 읽는다.
- 변경은 하나만 진행하는 single-flight이며 중복 버튼과 서로 다른 변경의 동시 실행을
  막는다.
- 성공과 실패 모두 실제 상태와 설정을 다시 읽고, 낙관적으로 UI 상태를 바꾸지 않는다.
- 설정을 읽지 못하면 이전 프로젝트 목록을 지우고 비권위 상태를 표시하며 프로젝트
  변경을 막는다.
- `requiresApproval`에서는 System Settings 이동과 등록 해제만 명시적으로 제공한다.

## 설정값과 현재 실행 상태

`service.json`에 저장된 configured projects와 현재 daemon snapshot의 active projects는
별도 권위다. 프로젝트를 추가·제거해도 service를 자동 재시작하지 않으므로 변경은 다음
service 재시작부터 적용된다. 설정에서 제거됐지만 현재 service가 아직 사용하는 경로는
`현재 서비스에서만 활성 · 재시작 후 비활성`으로 계속 표시한다.

raw `pet --socket` 개발 모드처럼 exact 제품 앱 identity가 없는 경우에는 온보딩 변경을
사용 불가로 표시하되 기존 Pet 시작 자체는 유지한다.

## 검증 결과

- fake onboarding adapter 집중 테스트: 10/10 통과
- Swift `BlabeePetTests`: 88/88 통과
- 전체 Swift package: XCTest 5/5 + Swift Testing 160/160 통과
- `npm run test:t011`: 23/23 통과
- `npm run test:t012`: 7/7 통과
- `npm run test:contracts`: 114/114 통과
- release `blabee-coordinator` build: 통과
- 임시 ad-hoc `Blabee.app` 조립과 `codesign --verify --deep --strict`: 통과
- 독립 QA가 찾은 설정 read 실패 뒤 stale 목록·변경 허용과 config 제거 뒤 active-only
  경로 소실 두 Medium finding을 수정하고 회귀를 추가했다. 최종 재검토에서 열린
  Critical/High/Medium/Low finding은 없다.

온보딩 집중 테스트는 fake adapter와 fake folder chooser만 사용했다. 실제
`SMAppService`, `service`, `launchctl`, 사용자 Application Support, `NSOpenPanel`,
System Settings 또는 제품 primary Keychain 상태를 만들거나 변경하지 않았다. 전체
Swift 회귀에는 격리된 임의 `test-*` Keychain account를 생성·CAS하고
`deleteForTesting()`으로 정리하는 기존 integration test가 포함된다.

## 남은 경계

- 사용자 동의를 받은 signed 앱에서 실제 등록·`requiresApproval`·System Settings·
  해제 상태 전이 검증
- 등록 직후 service 시작, 로그인/로그아웃, 재부팅, crash, sleep, 앱 이동·업데이트
  수명주기 검증
- 실제 `NSOpenPanel` 폴더 선택과 440×620 Pet 화면의 시각·overflow 검증
- signed Data Protection Keychain/access group·`LAContext`
- Developer ID, 공증, Gatekeeper, DMG, updater와 터미널 매트릭스

실제 등록은 즉시 bundled service를 시작할 수 있으므로 T-012b-3c에서 별도의 사용자
승인을 받은 뒤 수행한다.
