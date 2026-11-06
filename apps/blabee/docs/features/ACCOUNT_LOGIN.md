# macOS 계정 로그인

## 범위

Blabee 설정에서 Google/GitHub 선택 → 시스템 브라우저에서 인증 → 앱 복귀 → 검증된 이메일 표시 → 앱 재실행 시 세션 복원 → 현재 기기 로그아웃을 연결한다. 웹 계정 페이지와는 같은 Supabase 사용자를 사용하지만 세션과 로그아웃 범위는 별개다. 운영 웹 도메인이나 로컬 Vite 서버는 네이티브 로그인에 필요하지 않다.

로그인은 제품 계정의 신원을 확인한다. 구독 권한·결제·기기 수 제한은 아직 연결하지 않는다. Coordinator SQLite, Codex 실행·권한 요청·서비스 연결 정책은 계정 상태에 의존하지 않는다.

## 현재 설치 후보

2026-09-16 로그인 콜백 충돌을 수정한 **build 45**를 사용한다.

```sh
open -n "/tmp/blabee-account-build45.RjVoA4/Blabee.app"
```

이 앱은 로그인 브라우저 콜백의 스레드 처리를 수정하고 다시 컴파일한 내부 검증용 앱이다. 설치된 build 44의 정확한 runtime identity가 서명된 `BlabeeRuntimeUseLeasePreviousIdentities`에 포함됐고, `codesign --verify --deep --strict`를 통과했다. 실행 중인 세션을 종료하거나 설치본을 교체하지 않았다.

관련 Swift 테스트는 5개 suite의 85개 모두 통과했다. 새 브라우저 회귀 검사는 성공·취소·실패·빈 결과 4가지 상황에서 실제 production completion을 백그라운드 큐로 호출하고 MainActor 전달을 확인한다. 앞서 build 44에서 검증한 패키징 수정과 38개 패키징 테스트 결과는 유지되며, 이번 변경은 브라우저 콜백·해당 테스트·문서에 한정한다.

사용자의 설치 완료 보고와 `/Applications/Blabee.app/Contents/Info.plist` 조회로 build 44가 실제 설치된 것을 확인했다. Google 로그인 시도에서 아래 콜백 충돌이 관찰돼 build 45를 준비했다. 이전 설치창을 닫고 새 창의 44 → 45 표시까지 확인했으며 실제 교체는 미실행이다. 현재 설치 파일을 사용하는 Codex 세션과 Blabee를 정상 종료한 뒤 교체한다. Google/GitHub 네이티브 로그인 완료·재실행 유지·로그아웃 검증은 아직 남아 있다.

## 구성

- `PetAccountAuth.swift`: 공개 프로젝트 설정, Google/GitHub, 랜덤 PKCE verifier/S256, 고정 callback 검증, Supabase REST. 외부 Swift 패키지를 추가하지 않는다.
- `PetAccountBrowser.swift`: macOS 13 이상 `ASWebAuthenticationSession`. 진행 중인 세션만 callback을 받으며, 다섯 분 제한·사용자 취소·시작 실패를 처리한다.
- `PetAccountKeychain.swift`: 프로젝트별 `com.biadone.blabee.account.v1.<host>` 서비스의 `session` 항목. 접근/갱신 토큰은 macOS login Keychain에 보관하고 iCloud 동기화를 사용하지 않는다. 기본 코드 서명 ACL을 사용하며 Coordinator freshness 항목과 분리한다. 별도 entitlement가 필요한 Data Protection Keychain이나 iOS의 ThisDeviceOnly 접근 정책을 적용했다고 주장하지 않는다.
- `PetAccountController.swift`: 재실행 복원, 서버 사용자 검증, 만료 전 갱신, 실패 시 재시도, 취소·로그아웃 뒤 늦은 응답 무효화.
- `PetAccountView.swift`: 계정 카드. 앱의 설정 화면이 같은 controller를 관찰하며 패널이 닫혀도 로그인 작업은 유지된다.

공개 Supabase URL과 publishable key는 네이티브 클라이언트에 포함할 수 있다. OAuth client secret, service-role key, 결제 비밀키는 포함하지 않는다. HTTP 응답의 provider token은 디코딩·저장하지 않는다. 인증 요청은 캐시·쿠키·저장된 HTTP 자격증명을 사용하지 않고 리디렉션을 따라가지 않는다.

## 인증 경계

1. 로그인마다 `SecRandomCopyBytes`로 32바이트 verifier를 생성한다. verifier는 메모리에만 유지하고 SHA-256 challenge만 인증 주소에 넣는다.
2. 앱이 고정 Supabase `/auth/v1/authorize` 주소를 `ASWebAuthenticationSession`으로 연다. 허용 공급자는 Google/GitHub뿐이다.
3. Supabase가 Google/GitHub 인증과 공급자 `state`를 관리한다. 최종 복귀 주소는 `com.biadone.blabee://auth/callback`이다.
4. 앱은 활성 세션의 callback만 받고 scheme/host/path와 단일 코드를 검사한다. bearer token을 포함한 implicit callback이나 임의 복귀 주소를 허용하지 않는다.
5. 앱이 `auth_code`와 verifier를 HTTPS로 교환한다. 발급된 세션은 Keychain에 보관하고 `/auth/v1/user` 확인 뒤 이메일을 표시한다.
6. 저장된 사용자 정보만으로 로그인 완료를 표시하지 않는다. 만료가 가까우면 refresh하고 다시 사용자 정보를 확인한다. 네트워크 오류·429·서버 오류는 저장된 세션을 보존하며, 확인된 만료·폐기 오류는 재로그인을 요구한다.
7. 갱신된 refresh token을 후속 사용자 확인 요청 전에 저장한다. 로그아웃·취소·종료는 작업 세대를 바꾸므로 이전 응답이 Keychain이나 화면을 복구할 수 없다.
8. 로그아웃은 먼저 현재 기기 Keychain 항목을 지우고 `scope=local`로 원격 세션 종료를 요청한다. 원격 요청 실패는 로컬 로그아웃과 구분해 알린다. Keychain 삭제 실패를 로그아웃 성공으로 표시하지 않는다.

`callbackURLScheme`을 지정하는 AuthenticationServices 경로를 사용하므로 전역 URL handler나 `CFBundleURLTypes` 등록이 필요하지 않다. 일반 URL 열기로 로그인 코드를 주입하는 별도 경로는 만들지 않는다.

## Supabase 설정

2026-09-16 대시보드에서 다음 두 Redirect URLs가 저장된 것을 확인했다.

```text
http://127.0.0.1:4321/
com.biadone.blabee://auth/callback
```

Site URL은 기존 로컬 주소다. Google/GitHub 개발자 설정의 callback은 계속 `https://vulnkqyqqbucvbhwjswr.supabase.co/auth/v1/callback`을 가리킨다. 네이티브 URI로 교체하지 않는다. 운영 웹 공개 시 별도로 HTTPS 주소·브랜딩·Google 공개 상태를 정리한다.

## 검증 기준

자동 테스트는 네트워크·브라우저·Security API를 가짜 어댑터로 대체한다. 실제 사용자 계정이나 Keychain을 읽거나 변경하지 않는다.

- 알려진 RFC PKCE 벡터와 랜덤 verifier 형식, 허용 주소·공급자와 callback 거절 규칙
- 실제 REST 요청 형식·응답 검증·로그아웃 범위와 오류 분류
- Keychain 프로젝트 범위·동기화 비활성·추가/갱신/삭제 실패
- 로그인과 세션 복원, 토큰 갱신·보관·사용자 확인, 취소와 비동기 응답 경합
- 좁은/일반 너비, 밝은/어두운 테마의 계정 UI

네이티브 실사용 검증은 아래 절차가 별도로 필요하다. 기존 실행 중인 Blabee를 임의 종료하거나 자동 설치하지 않는다.

1. 새 빌드의 Blabee 설정에서 Google 로그인, 본인 계정 선택·동의, 앱 복귀 후 이메일 확인.
2. 앱을 정상 종료하고 다시 열어 동일 계정 복원 확인.
3. 현재 기기 로그아웃 후 재실행해 로그아웃 유지 확인. 웹 브라우저의 Blabee 세션은 유지될 수 있다.
4. GitHub로 같은 과정을 확인.
5. 로그인 취소, 연속 클릭, 로그인 대기 중 패널 닫기, 네트워크 단절 뒤 다시 확인, 만료 전 자동 갱신 확인.
6. 서명한 앱 업데이트 후에도 동일 Keychain 항목을 읽을 수 있는지 확인. ad-hoc 빌드와 배포용 Developer ID 빌드 간 Keychain 접근 결과를 동일하다고 가정하지 않는다.

웹에서 사용자가 확인한 로그인 성공은 네이티브 AuthenticationServices 복귀·Keychain 실사용 검증을 대신하지 않는다.

### 2026-09-16 실행 결과

- Xcode Swift 6 환경에서 네이티브 앱 빌드 통과.
- `swift test --filter 'PetAccount|PetPanelSizePolicyTests|PetPlatformPolicyTests'` 관련 테스트 84개 통과. PKCE/HTTP/Keychain/컨트롤러 테스트 외에 기존 패널·앱 동작 정책 회귀 검증을 포함한다.
- 260pt/384pt, light/dark, 로그인 전·후/진행/실패 등 40가지 UI 렌더 통과. 생성 이미지에서 로그인 버튼, 긴 이메일 줄바꿈, 오류 안내를 확인했다.
- 확인용 앱 조립과 ad-hoc 코드 서명 검증 통과. 외부 배포용 Developer ID 서명·공증 검증 결과는 아니다.
- 첫 확인용 산출물은 `/tmp/blabee-account-build43.N0g8Bv/Blabee.app` (build 43). 당시 설치된 build 42를 `--compatible-previous-app /Applications/Blabee.app`으로 검증해 전송 호환 정보를 포함했다. 이후 패키징은 build 44에서, 로그인 콜백은 build 45에서 수정했다. 당시에는 기존 앱을 실제 교체하거나 실행 중인 세션을 종료하지 않았다.
- 실제 계정의 네이티브 로그인, 운영체제 Keychain 접근과 앱 재실행, 배포 서명 간 자격증명 유지 확인은 아직 수행하지 않았다.

현재 작업을 저장하고 연결된 관리 세션과 Blabee를 정상 종료한 뒤 현재 설치 후보인 build 45를 연다. 설치 화면에서 44 → 45 교체 대상을 확인하고 `백업하고 교체`를 선택한다. 설치 후 설정의 `Blabee 계정`에서 위 실사용 절차를 수행한다. 임의 `pet --socket` 실행은 기존 사용자별 프로세스 lease·설정·서비스를 분리하지 못하므로 병행 테스트 방법으로 사용하지 않는다.

재현 명령(프로젝트 루트):

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /usr/bin/xcrun swift test \
  --package-path src/coordinator-swift \
  --scratch-path /tmp/blabee-account-native-build \
  --experimental-maximum-parallelization-width 1 \
  --filter 'PetAccount|PetPanelSizePolicyTests|PetPlatformPolicyTests'
```

### 2026-09-16 실제 설치·로그인 검증 시도

| 항목 | 관찰 결과 |
| --- | --- |
| 현재 설치본 / 테스트 앱 | `/Applications/Blabee.app`은 build 42, 준비된 테스트 앱은 build 43 |
| 코드 서명 | 두 앱 모두 `codesign --verify --deep --strict` 통과 |
| 설치 UI | 테스트 앱에서 설치 위치와 42 → 43 대상 표시 확인 |
| 설치 진행 조건 | 설치기가 실행 중인 Blabee 또는 Codex 연결 보조 프로세스를 감지하고 진행을 차단함 |
| 프로세스 확인 | 명령 인자 없이 이름·부모 PID만 조회하여, 여러 Codex 프로세스 아래 설치된 Blabee 실행 파일의 보조 프로세스가 남아 있음을 확인 |
| 실제 교체 | 미실행. 차단 후 설치된 앱이 여전히 build 42임을 확인 |
| Google / GitHub 네이티브 로그인 | 미실행 |
| 앱 재실행 후 로그인 유지 / 로그아웃 후 재실행 | 미실행 |

선택 작업의 조건인 “앱 교체 전 사용자의 현재 작업 종료 상태를 확인한다”에 따라 사용자 확인을 요청했다. 재개 요청 후 사용자가 “아직 진행 중인 작업이 있습니다”라고 답했으므로 앱 교체는 보류했다. 관리 세션을 강제 종료하거나 설치 보호 장치를 우회하지 않았다. 이 대화 자체가 설치된 Blabee의 관리 세션에서 실행 중이라면, 작업을 저장하고 일반 Codex 환경에서 이어서 진행해야 해당 앱의 사용 잠금을 해제할 수 있다.

재개 시 이름·부모 PID만 다시 조회해 Codex 세션 3개가 설치본의 보조 프로세스를 사용 중임을 확인했다. 설치기의 `다시 확인`으로 42 → 43 교체 확인창까지 열었지만, 에이전트는 `백업하고 교체`를 누르지 않았다. 이후 다시 조회한 화면은 활성 런타임 차단 상태였으며, 테스트 설치 화면의 `닫기`를 눌렀다. 마지막으로 설치된 앱이 여전히 build 42임을 확인했다.

화면 제어는 최초 연결 오류 뒤 복구되어 설치 화면까지 확인했다. 중단 사유는 진행 중인 사용자 작업과 설치기의 활성 런타임 보호이며, OAuth 성공/실패를 관찰한 결과가 아니다. 작업 저장과 연결된 관리 세션의 정상 종료가 확인되면 같은 build 43 앱을 다시 열어 설치하고, Google/GitHub 각각의 앱 복귀·계정 표시·재실행 유지·로그아웃 후 재실행을 확인한다. 이 네이티브 실사용 검증은 모두 미실행 상태다.

### 종료 후에도 설치가 차단되는 현상 추가 진단

사용자가 Codex와 Blabee를 모두 종료했다고 보고한 뒤 실제 프로세스와 설치본 실행 파일 사용 여부를 조회했다. 아래 PID와 터미널은 2026-09-16 진단 시점의 값이며, 이후 재실행하면 달라진다.

- 현재 대화의 진단 명령을 실행한 부모는 Codex PID `90921` (`ttys002`)이었다. 그 자식인 Blabee 보조 프로세스 `90936`이 설치본 실행 파일을 실제로 사용 중임을 `lsof`로 확인했다. 따라서 이 대화를 관리 세션으로 다시 열어둔 상태에서도 설치가 차단될 수 있다.
- 같은 Ghostty의 `ttys010`에도 Codex `92215`와 Blabee 보조 프로세스가 남아 있었다. 프로세스 이름·부모 PID·터미널과 해당 실행 파일의 사용 여부만 확인했으며 대화, 토큰, Keychain은 읽지 않았다.
- 테스트 설치 앱과 설치본은 다른 실행 파일 inode를 사용한다. 설치창 자체가 `/Applications/Blabee.app`의 실행 파일을 사용하는 것으로 확인된 것은 아니다.
- 실패 안내는 자동으로 해제되지 않을 수 있다. 작업을 저장하고 현재 대화를 포함한 연결된 Codex 세션 및 Blabee를 정상 종료한 다음, **Codex를 다시 시작하기 전에** 설치창에서 `다시 확인`하고 42 → 43 교체를 진행한다. 설치창을 닫았다면 일반 터미널에서 `open -n "/tmp/blabee-account-build43.N0g8Bv/Blabee.app"`으로 연다.

프로세스를 종료하거나 설치 보호를 우회하지 않았다. 진단 후 설치본은 여전히 build 42이며 실제 네이티브 로그인 검증은 미실행이다.

### 반복 실패 후 확인한 패키징 원인

이후 재진단에서 단순히 세션 종료를 반복하는 안내로 해결되지 않는 조건을 확인했다. 오래된 보조 프로세스가 현재 설치 경로를 보고하지만 실제로는 다른 inode의 이전 실행 파일을 사용하고 있었다. build 43의 `BlabeeRuntimeUseLeasePreviousIdentities`가 비어 있어 이 오래된 경로도 차단하는 검사로 돌아갔다.

호환 정보 누락의 원인은 이전 앱의 실행 파일만 떼어 검사하는 패키징 probe였다. 실제 build 42 복사본이 `invalid Info.plist` 서명 오류로 종료됐으며, 기존 코드는 이 실패를 호환되지 않는 이전 버전으로 처리했다. 원본 서명을 유지한 전체 앱 복사본을 쓰기·네트워크·Mach IPC·자식 프로세스가 차단된 sandbox에서 검사하면 정상 응답을 받았다. 설치기의 활성 사용자 보호를 해제하거나 이전 앱을 재서명하는 방식은 사용하지 않는다. 상세 근거는 프로젝트 루트의 `INSTALLER_RUNTIME_LEASE_KO.md`에 기록했다.

### build 44 로그인 콜백 충돌

2026-09-16 22:17:02의 macOS 충돌 보고서에서 설치된 build 44가 실제로 종료된 것을 확인했다. 패널이 숨겨진 현상만은 아니다. 보고서에서는 프로세스·빌드·예외·호출 스택만 추출했으며 계정 정보, 토큰, Keychain은 조회하지 않았다.

- 예외: `EXC_BREAKPOINT / SIGTRAP`.
- 호출 스레드: `com.apple.NSXPCConnection.m-user.com.apple.SafariLaunchAgent`.
- 스택: `_dispatch_assert_queue_fail` → Swift actor 실행 검사 → `PetASWebAccountBrowser.authenticate`의 AuthenticationServices completion.
- 원인: `@MainActor` 클래스 안에서 만든 Objective-C completion이 Swift 6에서 MainActor 격리를 상속했다. 시스템이 이를 다른 스레드에서 호출하면, 기존 `Task { @MainActor }`에 진입하기 전에 격리 검사에서 종료된다.
- 컴파일러 확인: 기존 completion의 SIL에는 MainActor 진입 검사가 있으며, 명시적인 `@Sendable` completion은 nonisolated로 생성되고 내부 Task만 MainActor를 유지한다.

이 보고서만으로 Google 계정 인증이나 토큰 교환의 성공을 확인할 수는 없다. Google과 GitHub는 같은 completion 경로를 사용한다. 기존 컨트롤러 테스트는 브라우저를 가짜 어댑터로 대체했으므로, 실제 production completion을 백그라운드 큐에서 호출하는 회귀 검증이 추가로 필요하다.

`PetAccountBrowser.swift`에 nonisolated factory와 명시적인 `@Sendable` completion을 적용했다. `finish` 호출은 MainActor Task 안에서만 실행하며, 기존 weak 참조·시도 ID 검사·취소·timeout 정책을 유지했다. `PetAccountBrowserTests.swift`는 실제 factory의 completion을 SDK의 non-Sendable 콜백 타입으로 넘겨 백그라운드 serial queue에서 호출한다. 4가지 입력 모두 MainActor 전달을 통과했다.

전체 관련 테스트의 첫 실행은 UI 이미지 저장 폴더를 만들지 않아 1건 실패했다. 폴더를 준비한 뒤 같은 85개 테스트가 모두 통과했고, 40개 UI 상태 렌더도 완료했다. 최종 로그는 `/tmp/blabee-account-native-tests-build45-20260916-rerun.log`다. build 45의 서명과 설치본 44의 정확한 호환 identity 포함을 확인했으나, 새 빌드의 실제 Google/GitHub 인증 성공을 검증한 결과는 아니다.

## 공식 참고

- [Apple ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)
- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase 인증 오류](https://supabase.com/docs/guides/auth/debugging/error-codes)
- [Supabase 로그아웃](https://supabase.com/docs/guides/auth/signout)
- [RFC 9700 CSRF 방어](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7.1)
