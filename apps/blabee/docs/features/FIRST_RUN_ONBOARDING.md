# Blabee 첫 실행 온보딩

`/Applications/Blabee.app`의 제품 Pet을 처음 실행하면 다음 네 단계로 진행한다.

1. **사용법:** 선택지 도착 → 선택 → 원래 대화로 전달을 세 장면으로 설명한다. 체험 카드는 메모리 안의 예시이며 실제 Codex 요청을 전송하지 않는다.
2. **로그인:** 기존 Google/GitHub OAuth와 Keychain을 사용한다. 서버에서 확인된 계정만 다음 단계로 진행할 수 있다.
3. **약관:** 필수 확인과 선택형 사용 통계·오류 진단 동의를 구분한다. 선택 항목은 각각 기본값이 꺼짐이다.
4. **설정:** 실제 서비스·Plugin·프로젝트 상태, 패널 단축키, 화면 모드, Mac 로그인 시 실행을 설정한다. 연결 준비를 확인하면 시작할 수 있고, 명시적으로 **연결은 나중에**를 선택할 수도 있다.

완료하면 기존 메뉴바와 선택 패널을 시작한다. 일반 설정에서 화면 모드, 로그인 시 실행, 계정, 통계·진단 설정을 다시 변경할 수 있다.

## 단계별 행동 안내

2026-10-16 개선: 주 행동은 대비가 높은 단색 버튼으로, 뒤로·건너뛰기·다시 확인 등
보조 행동은 상황에 따라 약한 스타일로 구분한다. 색만으로 의미를 전달하지 않고
행동 문구, 체크 표시와 선택됨 배지를 함께 사용한다.

- 튜토리얼 첫 장면은 `미리보기`라고 표시하고 `카드 선택해 보기`로 체험을 시작한다.
- 체험에서는 카드 선택 전 두 선택지를 강조한다. 선택한 카드에 `선택됨`을 표시하고,
  하단 고정 버튼을 `예시 선택 전달하기`로 바꾼다. 이 버튼은 예시 상태만 갱신하며,
  전달 완료 후 같은 하단 위치에서 `다음`으로 진행한다.
- 체험을 하지 않고 넘어가는 버튼은 `체험 건너뛰고 다음`이라고 명시한다.
  소개 건너뛰기와 로그인·약관·저장·연결 완료 조건은 유지한다.
- 로그인에는 계정 선택 영역과 브라우저 로그인 순서를 안내한다. 필수 동의와
  선택 데이터 공유는 구분하며 선택 동의를 켜도록 유도하지 않는다.
- 도구 연결에는 현재 상태에 따른 `지금 할 일`을 표시한다. 선택한 도구는
  테두리·체크박스·배지로 구분하고, 현재 필요한 연결 또는 복구 버튼을 강조한다.
  준비 완료는 실제 세션의 선택 전달 성공과 구분한다.
- 단축키·화면 모드 등은 나중에 변경할 수 있는 선택 설정임을 표시한다.
- 언어 선택은 상단에 배치하고 반복 설명을 줄여, 460×550 창에서도 체험 카드와
  로그인 제공자 버튼이 첫 화면에 보이게 한다. 긴 약관·연결 설정은 스크롤한다.

화면 표시만으로 실제 명령·계정 로그인·동의·연결 변경을 실행하지 않는다.
연결 설정은 사용자의 명시적인 버튼 조작으로 시작한다. 앱 전체의 승인 카드나
단축키 동작은 변경하지 않는다.

## 처음 연결할 때의 진행 안내

2026-10-18 개선: 온보딩과 설정의 연결 탭에서 같은 흐름을 사용한다.

1. Codex·Claude 중 사용할 도구를 선택하고 **연결하기**를 누른다. 별도의 사전
   검사 버튼은 필요 없다. 새 설치에서 Codex 설정 파일이 없으면 이 과정에서 OS 계정의
   **홈 폴더와 하위 폴더**를 기본 범위로 저장한다. 폴더 선택 창은 띄우지 않는다.
2. Blabee가 기존 adapter로 작업 폴더·서비스·Plugin을 순서대로 준비하고 현재 상태를
   다시 확인한다. 실행 파일 오류에서 **재검사 후 연결**을 선택해도 이 전체 흐름을
   이어간다. 이전의 Plugin 설치 전용 재시도 API는 별도로 보존한다.
3. Codex Hook 검토가 남은 경우에만 새 Codex 대화 → `/hooks`에서 Blabee 검토·활성화
   → Blabee로 돌아오는 순서를 보여준다. 앱 활성화 시 신뢰 상태와 현재 서비스 증거를
   읽기 전용으로 재검사하며, **Codex 승인 확인**으로 수동 재검사도 가능하다.
4. 설정 완료에는 현재 서비스·적용된 폴더·Plugin·Hook 신뢰 증거가 여전히 필요하다.
   완료되면 다시 연결하라는 주 버튼은 숨긴다. 실제 카드 수신과 선택 반환은 별도 확인이다.

첫 화면에는 작은 도구 선택 카드와 현재 상태에 맞는 주 버튼을 둔다. 작업 폴더 추가,
검사 보고서, 재검사, 연결 범위 설명은 **문제 해결 · 고급 설정**으로 모은다.
미설치 도구는 공식 설치 안내를 열며, 설치 후 연결을 이어가는 보조 행동을 제공한다.
Codex·Claude 자체 설치와 계정 로그인, 도구의 신뢰·권한 승인은 사용자가 수행한다.

2026-10-20 기본 범위·설정 요약:

- 기본 범위 저장은 명시적인 Codex **연결하기**에서만 수행한다. 단순 조회·앱 활성화·
  Claude만 연결할 때는 저장하지 않는다. `HOME`·`CODEX_HOME` 환경변수는 기본 홈의 출처로 쓰지 않는다.
- 검증된 기존 폴더 목록과 명시적 빈 목록은 보존한다. 빈 목록은 고급 설정에서 폴더를 추가할
  때까지 유지되며, 잘못된 설정 파일을 첫 설치로 취급하지 않는다.
- 최초 저장은 기존 설정 잠금 안에서 다시 읽고, create-only 원자적 게시로 동시 생성된 파일을
  덮어쓰지 않는다. 저장 실패 시 서비스 시작·Plugin 설정으로 진행하지 않는다.
- Test 앱은 실제 홈 대신 해당 run의 fixture 폴더만 기본값으로 저장한다.
- 일반 설정에는 하나의 Codex 연결 요약과 연결 설정 버튼을 둔다. Plugin·Hook·폴더 범위의
  상세 검사는 연결 탭으로 모으고, 실제 증거 없이 고정 표시되던 선택 전달 경고는 제거한다.
- 이 기본값은 Codex 카드의 프로젝트 범위다. 홈 파일을 재귀 수집하거나 명령·파일 접근을
  자동 승인하는 설정이 아니며, 기존 Hook 신뢰와 실행 권한 확인은 유지한다.

자동 복귀 검사는 설치·서비스 시작·재시작·로그인·신뢰 승인·카드 선택을 수행하지 않는다.
중복 활성화는 하나의 검사로 합치며, 중단·화면 종료·선택 도구·작업 폴더·서비스 세대가
바뀐 뒤 돌아온 오래된 결과로 연결 상태를 복구하지 않는다. 설정 중단은 이미 완료된
원자적 설정 변경을 되돌리지 않으며, 다음 명시적 시도에서 상태를 다시 확인한다.

## 진행 상태

`~/Library/Application Support/Blabee/onboarding/state-v1.json`에 진행 단계, 문서 버전과 계정 ID에 묶인 동의 기록, 연결 연기 여부, 완료 시각을 저장한다. 토큰·암호·로그인 증명은 저장하지 않는다. Coordinator SQLite 스키마와 분리하며, 임시 파일을 원자적으로 교체한다.

- 마지막 설정 단계에서 성공적으로 저장한 경우에만 완료된다.
- 중간에 닫으면 앱을 종료한다. 재실행 시 계정을 다시 확인한 뒤 저장된 진행을 이어간다.
- 완료 후 재실행·앱 업데이트·로그아웃으로 온보딩을 다시 열지 않는다.
- 이전 빌드에는 완료 기록이 없으므로 이 기능을 처음 포함한 빌드에서도 한 번 표시된다. 기존 설치를 동의한 것으로 간주하지 않는다.
- 계정이 바뀌면 기존 동의를 재사용하지 않는다. 일시적인 계정 확인 중에는 현재 화면을 유지하면서 진행을 잠근다.
- 파일 읽기 실패는 재시도할 수 있으며, 저장 실패는 완료로 처리하지 않는다.

## 현재 약관은 더미

사용자 요청에 따라 `PetFirstRunLegalDocuments.placeholder`를 사용한다. 화면에는 **임시 약관 · 추후 교체 예정**, 기록에는 `isPlaceholder: true`, `documentVersion: draft-onboarding-v1`을 남긴다. 정식 약관 동의 증빙으로 취급하지 않는다.

정식 문서로 교체할 때 앱 Info.plist의 세 값을 함께 제공한다.

- `BlabeeTermsURL`: HTTPS 서비스 이용약관 URL
- `BlabeePrivacyURL`: HTTPS 개인정보처리방침 URL
- `BlabeeLegalDocumentVersion`: 문서 버전

일부 값만 있거나 URL이 유효하지 않으면 동의 진행을 막는다. 완료한 사용자에게 정식 약관을 다시 받는 정책·서버 동의 기록 API는 이번 첫 실행 화면과 별도로 설계해야 한다.

## 실행 경계

설치 위치 확인과 단일 Pet 프로세스 잠금은 기존 흐름을 유지한다. 개발용 CLI와 백그라운드 명령은 첫 실행 기록을 소비하지 않는다. 온보딩 창은 키보드 입력과 OAuth 표시가 가능한 일반 NSWindow이며, 정상 선택 패널은 완료 뒤 생성한다.

설정 단계의 2초 간격 상태 확인은 `get_state` 읽기만 수행한다. `consumer_heartbeat`, 작업 포커스, 선택, 승인 응답이나 카드 수신 통계를 보내지 않는다. 정상 화면 전환 뒤 도착하는 오래된 응답은 generation/token으로 무시한다. 첫 실제 카드 전달 검증은 정상 화면에서 수행한다.

Mac 로그인 시 실행은 `SMAppService.mainApp`을 사용하며, Blabee의 백그라운드 서비스 등록과 별개다. 사용자 조작 없이 로그인 항목을 등록하지 않는다. 테마는 앱 전용 UserDefaults에 저장해 다음 실행에도 적용한다.

## 검증

주요 자동 검사: `PetFirstRunTests`, `PetFirstRunSetupTests`, `PetFirstRunPreferencesTests`, `PetFirstRunViewTests`. 상태와 통신·계정·로그인 항목은 격리된 테스트 대역을 사용한다. `BLABEE_FIRST_RUN_RENDER_DIRECTORY`를 지정하면 네 단계의 밝은/어두운 화면을 590×720, 460×550 크기로 저장한다.

2026-10-16 행동 안내 변경 검증: `npm run test:swift -- --filter
'PetFirstRunViewTests|PetFirstRunTests|PetConnectionSetupViewTests|PetCodexConnectionRecoveryTests|PetLocalizationTests'`
59개 검사를 통과했다. 선택→예시 전달→다음의 상태 전환, 건너뛰기, 로그인·동의 조건,
연결 상태별 안내, 영어·한국어를 검사했다. 임시 설정과 테스트 대역을 사용해
실제 선택·승인·로그인·연결을 실행하지 않았으며, 화면은 표시하지 않은 테스트 창에서 렌더했다.
작은 창의 카드 선택·전달·로그인과 밝은/어두운 화면의 주요 배치를 이미지로 확인했다.
한국어 렌더는 문구의 테스트 언어를 강제하므로 언어 선택기 값은 실제 테스트 프로세스의
기본 언어로 보일 수 있다. 운영 언어 설정은 바꾸지 않는다.
실제 키보드 탐색·VoiceOver, 설치 앱의 전체 첫 실행 흐름은 별도 확인 대상이다.

실제 설치본에서는 Google/GitHub 로그인·취소·재시도, 중간 종료와 재실행, 완료 뒤 재실행, 로그인 항목 승인, Codex Plugin 연결과 첫 카드 전달을 별도로 확인해야 한다. 소스 테스트가 실계정 로그인이나 설치 성공을 증명하지는 않는다.

### 2026-10-18 연결 흐름 검증

`npm run test:swift -- --filter
'PetConnectionSetup|PetCodexConnectionRecovery|PetCodexNativeRecheck|PetHookReadiness|PetFirstRun|PetConnectionReadiness|PetLocalizationTests|PetOnboardingTests|PetClaudeConnectionTests|PetIdleEfficiencyTests|PetSettingsStatusToneTests'`
결과: **220개 검사 / 12 suites 통과**. 전체 Swift suite 실행 결과는 아니다.

- 명시적인 native 재검사 뒤 폴더 → 서비스 → Plugin → Hook 확인이 추가 연결 클릭 없이 이어진다.
- 중복 클릭·활성화 알림, 취소 중 원자적 쓰기, 폴더·도구 선택·서비스·세션·화면 전환 뒤
  늦은 응답, 정상 health poll과 느린 Hook 검사 공존, 최종 응답 순서 역전을 검사했다.
- 복귀 검사는 `get_state {}`와 읽기 전용 Plugin·Hook 검사만 수행한다. 테스트 대역에서
  서비스 재시작·세션 실행·선택 전송·소비자 heartbeat가 없음을 확인했다.
- 서비스 준비·검사 실패 안내는 정상 poll로 지워지지 않는다. 명시적 재검사·재시도 또는
  선택한 도구와 서비스가 모두 준비됐다는 새 관측에서 해제된다.
- 영어·한국어, 밝은/어두운 460×550 전체 온보딩에서 Hook 검토·호환성 오류·서비스 준비
  실패의 주 버튼을 로컬 Vision으로 읽고 스크롤 viewport와 고정 footer 사이의 가시성을
  검사했다. 주요 네 화면은 별도 시각 검토에서도 버튼 누락·잘림이 없었다.

렌더 언어는 테스트 프로세스의 휘발성 `UserDefaults.argumentDomain`에만 적용한 뒤
원래 값으로 복원한다. 실제 사용자 언어 설정을 저장하지 않는다. 상단 언어 선택기는
기존 shared controller를 사용하므로 한국어 fixture에서도 English로 보일 수 있다.

검증 로그: `/private/tmp/blabee-connection-ux-20261018-swift-complete.log`.
연결 화면: `/private/tmp/blabee-connection-ux-20261018-renders/`.
첫 실행 화면: `/private/tmp/blabee-connection-ux-20261018-first-run/`.
변경 대상 `git diff --check`와 별도 정적 검토를 통과했다.

제품 빌드·서명·공증·패키징·설치·운영 앱 재시작·commit·push는 이번 작업에서
실행하지 않았다. 운영 DB·Keychain·실제 사용자 프로필을 변경하지 않았다.
설치본의 실제 새 Codex 세션에서 `/hooks` 승인 → Blabee 복귀 알림 → 완료와 첫 카드
왕복, 키보드·VoiceOver는 다음 설치 검증에서 확인한다.

### 2026-10-19 설정 단계의 복구 안내와 부분 연결

실제 설치 앱 r85의 첫 실행 창을 읽어 `freshness_storage_missing`을 확인했다.
같은 시점의 파일 메타데이터에서 운영 `Blabee/storage` 디렉터리와 DB·키가 모두
없었다. 기존 검증 기록에 대응하는 파일이 없어 시작을 거절하는 것은 의도된
무결성 보호다. 저장소가 언제, 어떤 작업으로 없어졌는지는 확인하지 못했다.
설치 앱의 복구 가능 여부 확인은 성공했고, 확인 버튼을 누르지 않은 복구 계획까지
준비했다. 이 관찰을 코드 테스트 또는 설치본 수정 완료로 간주하지 않는다.

별도로 `.zshrc`에는 현재 생성 규칙과 정확히 같은 Claude 관리 블록 하나가 남아
있었지만, 그것이 참조하는 `shell/claude-v1/bin/claude`는 없었다. 내용 자체를
출력하거나 셸을 실행하지 않고 메타데이터와 일치 여부만 확인했다. 이는 현재
소스의 `manualReview` 조건과 일치하며, 설치 바이너리 내부 구현까지 분석한
결과는 아니다.

변경 사항:

- `PetConnectionSetupInspection.serviceIssue`로 관측된 서비스 오류를 별도 전달한다.
  명시적 재검사·일반 poll·검사 실패 뒤에도 이 오류를 유지하며, 새로운 정상 서비스
  응답에서 해제한다. 서비스 오류 중에는 설정 쓰기와 완료를 허용하지 않는다.
- 저장소 누락은 도구 상태보다 먼저 안내하고 기존 `PetStorageRecoveryView`를
  바로 표시한다. 복구 가능 여부 확인과 보관·새로 시작 확인은 계속 별개다.
  준비 성공이나 복구 영수증만으로 완료 권한을 부여하지 않는다.
- 서비스가 꺼졌으면 명시적 켜기, 이전 등록이 남았으면 명시적 등록 해제를 제공한다.
  등록 해제 뒤의 재시작도 별도 클릭이다. 등록 상태를 모르면 읽기 전용 확인만 한다.
- Codex가 available이고 Claude가 needsAction인 경우 `Connect Codex`로 가능한
  연결부터 진행한다. Claude를 임의로 완료 처리하거나 선택 해제하지 않는다.
  선택한 모든 도구의 설정과 현재 서비스 증거가 필요하다는 완료 조건은 유지한다.
- Claude 보조 파일이 없더라도 현재 경로의 정확한 관리 블록 하나만 있고 다른 관리
  참조가 없다면 명시적인 연결 시 복원할 수 있다. 검사는 쓰지 않으며, 복원은 기존
  잠금·백업·원자적 교체·동시 편집 검사를 유지한다. 변조·중복·다른 경로·위험한 파일은
  계속 거절한다. 실패 시 이번에 만든 정확한 보조 파일만 되돌리고 사용자 편집은 보존한다.

검증: 직렬 잠금을 유지한 `npm run test:swift -- --jobs 1 --disable-keychain
--disable-netrc --filter
'PetConnectionSetupTests|PetConnectionSetupIntegrationTests|PetConnectionSetupViewTests|PetFirstRunViewTests|PetConnectionRecoveryTests|ClaudeAutoConnectSetupTests|PetClaudeConnectionTests'`
**140개 검사 / 7 suites 통과**. 실제 연결 대신 대역 서비스·임시 셸 파일을 사용했다.
운영 앱·로그인·DB·Keychain을 쓰는 테스트는 실행하지 않았다. 영어·한국어,
밝은/어두운 460×550 온보딩에서 저장소 복구와 혼합 도구 상태의 주 버튼 가시성을
Vision으로 검사하고 주요 렌더 이미지를 시각 검토했다. 코드 검토에서 발견한
disabled 재시도와 이전 서비스 등록 처리 회귀도 수정 후 검사에 포함했다.

- 검사 로그: `/private/tmp/blabee-onboarding-recovery-tests-final-20261019.log`
- 렌더: `/private/tmp/blabee-onboarding-recovery-renders-20261019/`
- 관련 구현: `PetConnectionSetup.swift`, `PetViewModel.swift`, `PetConnectionSetupView.swift`,
  `PetFirstRunView.swift`, `PetConnectionRecoveryView.swift`, `ClaudeAutoConnectSetup.swift`.
- 회귀: `PetConnectionSetupTests.swift`, `PetConnectionSetupIntegrationTests.swift`,
  `PetConnectionSetupViewTests.swift`, `ClaudeAutoConnectSetupTests.swift`.

이는 테스트용 컴파일·렌더 결과다. 새 제품 번들·공증·설치와 실제 사용자 셸 복구,
온보딩 완료 및 새 Codex·Claude 연결 검증(M3)은 별도다. commit·push는 하지 않았다.
