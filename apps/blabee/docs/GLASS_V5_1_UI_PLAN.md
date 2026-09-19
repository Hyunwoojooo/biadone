# Blabee V5.1 UI 적용 계획

작성: 2026-09-16. 상태: **계획 완료 / 제품 구현 미착수**.

목표는 `/Users/joo/Downloads/blabee-video-glass-v5-1`의 화면 구조를 참고하고, 사용자가
지정한 영상의 **Air 무드**를 기존 Blabee의 네이티브 화면에 적용하는 것이다.
2026-09-16 추가 방향: **시안의 배경색은 예시이며 고정 팔레트가 아니다.** 재질·빛·여백의
가벼운 인상을 우선한다. 이 방향 확정이 폭·곡률·선택 전달 방식까지 확정한 것은 아니다.
이번 문서는 화면 대응, 선택해야 할 동작, 구현 순서와 검증 기준을 정리한다.
제품 소스·설정·설치 앱·서비스·배포 파일은 이 계획 작업에서 변경하지 않는다.

## 1. 근거와 범위

- 디자인 근거: 참조 폴더의 `README.md`, `REFERENCE-DIRECTION.md`, `SCREEN-MAP.md`,
  `style.css`, `components.js`, `app.js`, `Preview.swift`, `build-native.py`.
- 최신 무드 근거: `/Users/joo/Downloads/KakaoTalk_Video_2026-09-16-17-23-53.mp4`.
  로컬 파일은 884×1920, 약 13.09초다. 1초 간격 전체 구간 표본, 2.3/4.3초 원본 크기
  프레임, 10초 부근의 연속 표본을 확인했다. 아래 관찰은 이 프레임에 근거하며,
  오디오나 프레임 단위 애니메이션 타이밍을 분석한 결과는 아니다.
  참조 폴더의 `REFERENCE-DIRECTION.md`가 기록한 9월 14일 영상과 동일 파일이라고 단정하지 않는다.
- 시각 근거: `captures/native-selected.png`, `native-permission.png`, `native-settings.png`,
  `exports/dark/12.png`, `exports/light/13.png` 등 대표 캡처.
- 23개 원본 대응 화면과 7개 보완 상태, 총 30개 상태 / PNG 60개가 있다.
- 제공된 검사 기록에는 가로 넘침 없음, 최소 12px, 대표 문구 140곳의 최소 대비 5.85:1이
  기록되어 있다. **작성 시 다시 실행한 검사도, 실제 Blabee의 접근성 보증도 아니다.**
- 시안의 기준은 r36/r39다. 현재 r42의 앱 내부 업데이트, 관리 세션 설정, 실제 연결 진단은
  시안에 없어도 제품에서 보존한다.

### 이식 범위

가볍게 떠 있는 표면, 섬세한 테두리, 부드러운 가장자리 조명, 도트 표시, 두 열 선택 카드,
여러 줄 제목, 명확히 구별되는 주 버튼, 탭으로 나눈 설정을 기존 SwiftUI/AppKit 화면에 적용한다.
블루그레이 바탕·흰색 버튼·하늘빛/크림빛은 비교할 후보 표현이며 필수 색상값이 아니다.

기존 서비스, 세션 라우팅, 승인 권한, 업데이트 트랜잭션, 저장 형식과 공개 계약은 유지한다.
새 production 의존성이나 WebKit 기반 제품 전환은 계획하지 않는다.

참조 앱은 `NSVisualEffectView + WKWebView`로 만든 독립 미리보기다. 통째로 제품에 넣으면
현재 SwiftUI 뷰모델과 웹 간 상태 동기화·메시지 검증·키보드 포커스 처리가 추가된다.
기존 네이티브 화면에 재질과 배치를 옮기는 쪽이 현재 동작을 보존하기 쉽다.

### Air 무드: 영상 관찰과 제품 적용 방향

여기서 Air는 사용자가 원하는 시각적 분위기다. 영상 속 공기청정기·공기 점수나
특정 Apple 제품의 시각 규격을 Blabee에 도입한다는 의미가 아니다.

| 영상에서 확인한 특징 | Blabee에 적용할 방향 |
| --- | --- |
| 2.3초: 흐린 배경 위의 반투명 카드, 부드러운 하늘빛·크림빛, 가는 밝은 경계 | 표면에 깊이와 주변 빛이 느껴지게 한다. 색은 약한 조명 후보로 사용하고, 전체 창을 고정 색으로 덮는 것을 목표로 삼지 않는다 |
| 4.3초: 따뜻한 주황·분홍 배경에서도 형태를 유지하는 작은 유리 카드 | 특정 배경색이 있어야만 완성되는 디자인을 피한다. 서로 다른 데스크톱 배경에서도 같은 표면 계층과 읽기 영역을 유지한다 |
| 휴대폰 화면과 떠 있는 위젯: 둥근 카드, 넓은 내부 여백, 작은 원형 제어 | 460pt 검토 폭 안에서 여백과 둥근 형태를 조율한다. 곡률 수치나 모바일 화면 비율을 그대로 확정하지 않는다 |
| 도트 숫자, 가는 선과 눈금, 대비되는 주요 조작부 | 도트는 벌 아이콘·실제 선택지 개수처럼 제한된 지점에 쓴다. 한글 본문·명령·오류 안내는 일반 글꼴로 선명하게 표시한다 |
| 10초 부근: 휴대폰과 위젯의 빠른 장면 전환 | 홍보 영상의 컷 전환을 앱의 상시 움직임으로 옮기지 않는다. 상태·선택·열기/닫기에만 짧고 절제된 전환을 제안하며, 시간값은 제품 시안에서 검증한다 |

스타일을 다음 네 층으로 분리한다.

1. **미리보기 배경:** 비교용 무대다. 배경 이미지나 색을 제품 창에 함께 넣지 않는다.
2. **창 재질:** 시스템 material/glass 위에 절제된 tint·경계·조명을 더한다. 고정 HEX나
   시안의 opacity를 합격 기준으로 삼지 않고, 실제 macOS 합성 결과를 확인한다.
3. **본문 읽기 영역:** 긴 한국어·명령문 뒤에는 안정적인 대비를 확보한다. 투명도만 높여
   Air를 표현하지 않고, 여백·경계·깊이로도 가벼움을 만든다.
4. **상태·행동 색:** 경고·오류·선택·비활성을 구분하는 의미 색은 주변 조명과 분리한다.
   주요 버튼 색은 테마에 맞춰 비교하되, 승인 범위나 상태의 의미를 색만으로 전달하지 않는다.

배경 샘플링·화면 캡처·영상 재생을 제품 기능으로 추가하지 않는다. 영상과 추출 프레임은
로컬 참고 자료이며 배포 자산에 포함하지 않는다. 다음 시각 검토는 **중성 유리**와
**옅은 하늘빛/크림빛 조명을 더한 유리**를 동일 콘텐츠·폭·곡률로 비교해 색과 형태의 영향을 분리한다.

## 2. 결정해야 할 차이

아래 권장안은 **사용자가 확정한 요구사항이 아니라 구현 제안**이다. 특히 이전의 화면 곡률
요청과 시안의 곡률은 다르므로, 서로 같다고 취급하지 않는다.

| ID | 항목 | 현재 제품 | V5.1 시안 | 초기 적용 제안과 대안 |
| --- | --- | --- | --- | --- |
| D1 | 창 폭 | 기본·상세·승인·설정 460pt | 일반 424, 승인 448, 설정 590 | **초기에는 모두 460pt 유지.** 상세나 이벤트 종류가 바뀌어도 폭이 움직이지 않음. 시안 크기를 그대로 쓰는 대안은 모드 전환 시 폭 변화와 설정 별도 창 여부를 함께 결정 |
| D2 | 바깥 곡률 | 20.2pt continuous, 이전 화면 안쪽 곡선 기준 | 네이티브 38pt. 웹 좁은 화면은 32px | 시안에 맞추려면 **38pt 후보를 20.2pt와 비교**. 초기 시각 검토에서 확정 전까지 제품값은 유지. CSS의 원호와 SwiftUI continuous 곡선은 같은 숫자만으로 동일하지 않으므로 캡처로 비교 |
| D3 | 일반 카드 클릭 | 바로 기존 선택 요청 수행 | 선택 표시 후 전달 버튼으로 확정 | 시안 일치 목표로 **선택 후 전달을 제안**하되 별도 행동 변경 단계로 분리. 외형만 바꾸는 첫 단계는 즉시 전달 유지 가능. 실제 승인은 이 일반 카드 선택 단계와 분리 |
| D4 | 선택 단축키 | 사용자가 저장한 조합으로 직접 선택 | ⌥1–4는 직접 전달 | 기존 저장 조합과 직접 전달 유지. 시안의 ⌥ 표기를 하드코딩하지 않고 실제 등록 상태에서 표시 |
| D5 | Enter 전달 | Pet이 키보드 포커스를 가져오지 않음 | 웹/활성 미리보기의 Enter 전달 | **초기 적용에서 제외.** 주 버튼과 기존 전역 선택 단축키 제공. Enter가 필요하면 키포커스가 있는 명시적 편집 모드부터 별도 설계; 전역 Enter 가로채기 금지 |
| D6 | 긴 내용 / 높이 | 일반 결정은 한 줄 제목, 스크롤 없음. 상세 등은 스크롤 | 여러 줄 제목, 네이티브는 화면 높이에 맞춰 본문 스크롤 | 두 열·여러 줄 표시와 결정 본문 스크롤 허용. 460pt 폭은 고정하고 높이는 기존 화면 경계 정책으로 제한. 주 버튼·대기열·하단 조작부를 본문 스크롤과 분리 |

참조 `build-native.py`는 웹의 `max-width` 미디어 규칙을 제거한다. 네이티브 참조를
재현할 때는 424pt 창이라고 해서 웹의 32px 모서리 규칙을 적용하지 않는다.

### 키보드 포커스와 크기의 보존 기준

- `PetNonactivatingPanel`의 nonactivating, `canBecomeKey=false`, `canBecomeMain=false`
  정책을 유지한다. 참조 앱의 `NSApp.activate` / `makeKeyAndOrderFront`를 이식하지 않는다.
- 기존 사용자의 창 위치, 화면 경계 보정, 메뉴바·다중 디스플레이 대응을 재사용한다.
  참조 앱처럼 크기가 바뀔 때마다 오른쪽 위로 재배치하지 않는다.
- 4개 선택지의 참조 웹 높이는 약 778px, 긴 문장은 약 968px다. 이 값을 창 높이로
  고정하지 않는다. 사용할 수 있는 화면 높이 안에서 내용과 고정 조작부가 공존해야 한다.
- 매우 작은 작업 영역에서는 창이 화면을 벗어나지 않는 기존 제한을 우선한다.

## 3. 화면별 코드 대응

아래의 파일명은 `src/coordinator-swift/Sources/BlabeeCoordinator/` 기준이다.
여러 ID를 한 행으로 묶은 경우에도 검증 fixture는 각각 유지한다.

| 시안 ID | 화면 / 상태 | 현재 대상 파일·지점 | 적용 및 완료 기준 |
| --- | --- | --- | --- |
| 전체 | 외곽 재질·헤더·아이콘·크기 | `PetView.swift`: `PetPanelVisualStyle`, `PetPanelSurfaceModifier`, `PetInsetSurfaceModifier`, `header`; `PetPanel.swift`: 크기·배치 정책 | 미리보기 배경·창 재질·본문 표면·의미 색을 분리하고 곡률·여백 토큰화. 밝음/어두움/투명도 감소와 서로 다른 배경에서도 본문 대비·버튼 구분 유지. 창 포커스 정책 보존 |
| 01, 08 | 준비됨 | `PetView.swift`: `emptyState`; `PetViewModel.swift`: `PetPresentationState` | 중복 제목 축소, 도트 벌 또는 상태 아이콘. 실제 `.ready`에서만 준비 상태 표시 |
| 09, 11, 12 | 2·3·4개 선택지 | `PetView.swift`: `decisionCard`, `choiceRow`; `PetModels.swift`: `PetInteraction`, `PetChoice` | 두 열 그리드·실제 순위·등록된 단축키 표시. 3개는 순서 1→2→3 유지, 빈 네 번째 행동 생성 금지 |
| 10 | 작업 전체 상세 | `PetView.swift`: `interactionDetails`, `contentViewport` | 현재 상세 데이터와 위험·세션 정보를 동일 폭 안에서 펼침. 가로 확장 없음 |
| 13 | 긴 제목·선택지 | 위 결정 뷰 + `PetPanel.swift`: `PetPanelContentPolicy`, `PetPanelSizePolicy` | 한 줄 제한 해제, 의미 있는 줄바꿈, 읽을 수 있는 전체 텍스트와 세로 스크롤. 주 버튼 가림·가로 넘침 없음 |
| 14 | 대기 작업 이동 | `PetView.swift`: `eventNavigationControls`; `PetEventNavigation.swift`, `PetEventNavigationHotKeys.swift`; `PetViewModel.swift` | 실제 혼합 이벤트 수/현재 위치 표시. ⌥←/→와 버튼이 동일한 명시적 포커스 경로 사용. 뒤 작업부터 처리해도 원래 세션으로 전달 |
| 15 | 리마인더 | `PetViewModel.swift`: `.reminder`; `PetView.swift`: 상태·결정 표시 | 실제 리마인더 정책을 표현만 변경. 데모 타이머로 상태를 만들지 않음 |
| 16 | 만료 | `PetViewModel.swift`: `.expired`; `PetModels.swift`: 선택 가능 여부 | 만료된 일반 선택·보관된 선택 표시·주 버튼·단축키 모두 실행 불가. 새 요청을 기다리는 안내 |
| 17 | Codex 작업 중 | `PetViewModel.swift`: `.working`; `PetView.swift`: `emptyState` | 실제 진행 상태에서만 작업 중 표시. 전달 중 상태와 구별하고 유휴 상태의 상시 애니메이션 금지 |
| 18, 22 | 응답 / 위험 정보 형식 오류 | `PetModels.swift`: 파싱·검증; `PetViewModel.swift`: `.malformed`; `PetView.swift`: 오류·진단 표시 | 검증 실패를 디자인으로 숨기지 않음. 미확인 응답으로 카드나 승인 버튼을 활성화하지 않음 |
| 19, 20 | 연결 오류 | `PetViewModel.swift`: `.disconnected`; `PetTransport.swift`, `PetAppService.swift`; `PetView.swift`: 오류·서비스 동작 | 읽기 쉬운 안내와 실제 가능한 재확인 동작 표시. 20의 파일명은 복구지만 원본 화면은 연결 오류임을 보존 |
| 21 | 비활성 보조 동작 | `PetView.swift`: `secondaryControls`, disabled 안내 | 동작 불가 이유를 읽을 수 있게 표시. 스타일을 바꾸면서 비활성을 해제하지 않음 |
| 24 | 승인 요청 | `PetView.swift`: `permissionRequestCard`, `managedCommandApprovalCard`, `permissionChoiceRow`, `PetApprovalCommandPreview`; `PetApprovalHotKeys.swift` | 네이티브 Hook 요청과 관리 App Server 요청을 구분. 실제 요청이 허용하는 응답만 표시하고 원래 명령·cwd·세션·번호·단축키 보존 |
| S1 | 정상 복구 가능 예시 | `PetViewModel.swift`: `.recoveryCapable`; `PetView.swift`: 상세·보조 동작 | 복구 상태 표현만 대응. 현재 이전 프롬프트 버튼은 비활성이므로 예시의 실행 가능한 복구 버튼/복구 성공을 만들지 않음. 복구 실행 기능은 별도 범위 |
| S2 | 높은 위험 예시 | `PetViewModel.swift`: 위험 확인 및 기존 선택 경로; `PetView.swift`: 확인 UI | 기존 위험 근거·확인 단계를 보존. 일반 선택 확인과 위험 확인, 실제 명령 승인은 각각 유지 |
| S3 | 선택 전달 중 | `PetViewModel.swift`: `selectionSubmission`와 전송 상태; `PetView.swift`: 선택 진행 표시 | 실제 요청 동안만 표시. 중복 클릭·동시 단축키를 차단하고 대상 카드만 진행 표시 |
| S4 | 원래 대화 수신 예시 | `PetViewModel.swift`: 실제 응답·후속 snapshot 처리 | `accepted`나 시간 경과만으로 수신/실행 완료를 표시하지 않음. 실제 증거가 없는 단계는 현재 제품의 대기/접수 문구 유지 |
| S5 | 전달 결과 불명확 | `PetViewModel.swift`, `PetTransport.swift`: 실패·불확실 상태 | 결과가 불명확하면 성공으로 바꾸지 않음. 일반 선택의 수신 확인 polling API는 없으므로 확인 타이머·재전송 버튼을 발명하지 않음. 기존 권위 해제·snapshot 갱신 경로 사용 |
| S6 | 승인 응답 전달 예시 | `PetViewModel.swift`: 승인 응답·acknowledgement 처리; `PetApprovalHotKeys.swift` | 승인 응답 전달과 명령 실행 성공을 구별. 응답 대기 장벽 및 정확한 요청 식별 유지 |
| S7 | 나중에 결정 예시 | `PetView.swift`: `secondaryControls`; `PetViewModel.swift`: 숨김·dismiss 처리 | 현재 ‘나중에 결정’은 패널 숨김이며 영속 보관함이 아님. ‘보관됨/되돌리기’를 발명하지 않음. ‘선택 건너뛰기’의 무전송 종료와도 구별 |
| 02 | 일반 설정 / 업데이트 | `PetView.swift`: `onboardingSettings`, `connectionReadinessCard`; `PetAppUpdateView.swift`, `PetAutomaticAppUpdateView.swift` | 현재 버전·실제 연결 상태 사용. r42의 업데이트 다운로드·검증·설치 확인·관리 세션 설정까지 유지 |
| 03, 04, 05 | 단축키 설정·메뉴·저장 | `PetView.swift`: `shortcutSettings`, `choicePreviewShortcutSettings`, `shortcutSettingRow`; `PetHotKeys.swift`, `PetChoicePreview.swift` | 기존 draft/save/cancel·등록 충돌·실패 시 복원 보존. 탭 이동으로 초안 유실 금지. 표시 조합은 실제 설정에서 가져옴 |
| 06 | 프로젝트 설정 | `PetView.swift`: `onboardingProjects`, 프로젝트 행; `PetOnboarding.swift` | 실제 설정 목록·작업 폴더·저장 결과를 사용. 고정 ‘8개 적용됨’ 사용 금지 |
| 07 | 연결·서비스·후속 제안 | `PetView.swift`: `codexPluginSetupCard`, `suggestionModeCard`, `onboardingServiceActions`, `appOwnedServiceSettings`; `PetConnectionReadiness.swift`, `PetSettingsStatusTone.swift` | 플러그인 설치·Hook 활성·카드 수신 확인을 별개로 표시. 재시작·등록·정리 버튼을 실제 동작과 연결 |
| 추가 필수 | 누르는 동안 선택지 상세 | `PetChoicePreview.swift`, `PetChoicePreviewView.swift`, `PetViewModel.swift`, `PetPanel.swift` | 시안에 구현이 없으므로 기존 기능을 그대로 이식. 설정된 hold modifier를 놓으면 닫힘. 선택 전송 없음, 동일 폭 유지 |

설치 안내·업데이트 도우미·앱 설치 화면 전체 재설계는 이 시안의 30개 화면 범위에 없다.
`AppInstallationUI.swift`와 설치 엔진은 초기 적용에서 유지한다.

## 4. 상태와 동작 설계

### 시각 요소

- §1의 Air 방향을 우선하며 시안의 배경색·블루그레이·흰색 버튼을 고정 요구사항으로 복사하지 않는다.
  재질·조명·경계와 텍스트 대비를 각각 조절하고, 실제 상태와 무관한 장식 도트의 점멸은 넣지 않는다.
- 현재 `PetView.swift`의 공통 표면을 작은 스타일 컴포넌트로 추출하는 정도로 분리한다.
  후보 파일은 `PetGlassStyle.swift`, `PetDecisionView.swift`, `PetSettingsView.swift`이며 아직 생성하지 않는다.
- 원형 제어, 카드, 선택 상태, 오류 안내에 공통 토큰을 사용한다. 기존 SF Symbols 기반
  접근성 라벨을 보존하고 도트 숫자는 실제 선택지 개수에서 계산하며 장식 자체는 읽기 대상에서 제외한다.
- 제목 16pt/본문 14pt/보조 12pt를 네이티브 검토의 출발값으로 삼는다. CSS px를
  기계적으로 옮기기보다 한글 줄바꿈·화면 배율·실제 글꼴로 확인한다.
- 현재 코드의 macOS 26 `glassEffect` 분기, 이전 OS의 material 대체, 투명도 감소
  분기를 유지한다. 흐림·조명은 글자 바로 뒤 대비를 떨어뜨리지 않게 제한한다.
- 동작 줄이기 설정에서는 회전·점멸·스프링을 제거한다. 숨긴 패널과 준비 상태에서
  새 상시 타이머를 만들지 않는다. 지원 OS 최소값은 기존 macOS 13을 유지한다.

### D3을 채택할 경우: 선택 표시와 실제 전송

1. 카드 클릭은 현재 카드의 **전체 `PetInteractionIdentity`와 optionID·slot**을 임시 보관한다.
   이때 `select_option`, 승인 응답, 프롬프트 큐 전송을 호출하지 않는다.
2. 주 버튼은 그 선택을 화면에 표시하고, 기존 선택 가능 조건이 모두 만족할 때만 활성화한다.
3. 전달 직전 보관한 optionID와 slot이 여전히 같은 선택지를 가리키는지 확인한다.
   전달은 기존 `focusAndRequestPanelSelection` 경로로 보내며, 보관한 identity를 사용한다.
   선택 버튼을 누른 시점에 다른 카드의 현재 identity로 바꾸어 보내지 않는다.
4. 이벤트 이동, 카드/packet/revision 변경, 만료, 연결 손실, 승인 화면 전환, 설정 진입,
   패널 닫기, 건너뛰기, 전송 시작 시 임시 선택을 비운다. 같은 유효 identity의 정기 poll만으로
   선택을 지우지는 않는다. 변경을 감지한 이후에는 다시 명시적으로 선택해야 한다.
5. 저장된 숫자 단축키는 기존 직접 선택 경로를 사용한다. 마우스 전송과 경합해도
   기존 single-flight와 정확한 요청 식별로 한 번만 처리한다.
6. 높은 위험의 기존 확인 단계를 생략하지 않는다. 실제 승인 화면은 일반 카드의
   ‘선택 후 전달’ 상태와 공유하지 않는다. 요청이 허용하는 승인 동작만 표시한다.

새 상태는 UI의 일시적 선택뿐이다. Coordinator 스키마·IPC·대화 저장 형식이나
권한 범위를 바꿀 필요가 생기면 UI 계획 범위를 벗어났음을 먼저 명시한다.

### 설정 탭 재배치

| 탭 | 유지할 내용 |
| --- | --- |
| 일반 | 실제 연결 준비 요약, 앱 업데이트 및 자동 설치·복원 상태 |
| 단축키 | 패널 열기, 선택 키, 상세 미리보기, 저장·취소·충돌 안내 |
| 프로젝트 | 관찰 대상, 실제 활성 프로젝트, 저장·재시작 필요 안내 |
| 연결 | 플러그인 설치·진단, 실제 동작 확인, 후속 제안 모드, 서비스·자동 시작·이전 연결 정리, Codex 관리 세션 설정 접근 |

업데이트 메뉴 진입 시 일반 탭의 업데이트 영역으로 이동한다. 연결 진단의 다음 단계
버튼은 올바른 탭과 기존 목적지에 연결한다. 미저장 단축키 초안은 탭 이동 시 보존하고
닫기/취소/저장의 의미를 구분한다. 미리보기의 `newModel()` 초기화 동작은 복사하지 않는다.

관리 세션 ID 같은 설정 텍스트 입력과 접근성 포커스는 현재 비활성 패널 구조에서 별도
실사용 확인 대상이다. 입력에 키포커스가 필요하면 명시적으로 연 설정 편집 창을 대안으로
검토한다. 주 작업 패널 전체를 자동 활성화시키는 변경으로 해결하지 않는다.

## 5. 단계별 작업과 담당 경계

모든 작업은 **미착수**다. 다음 단계에 들어가기 전에 이전 단계의 완료 기준을 확인한다.
같은 대형 `PetView.swift`를 여러 작업자가 동시에 수정하지 않는다.

| 작업 | 선행 | 담당 제안 / 수정 범위 | 완료 기준 및 검증 | 위험 |
| --- | --- | --- | --- | --- |
| T-01 기준 고정 | 없음 | lead/planner: Air 방향·D1–D6와 현재 동작 fixture 정리 | 배경색은 예시라는 기준과 적용할 폭·곡률·전달 방식·Enter 범위를 기록. 승인·설정·업데이트 누락 목록 확인 | 낮음 |
| T-02 공통 표면·크기 시안 | T-01 | UI implementer: `PetView.swift`, 필요 시 신규 스타일 파일; `PetPanel.swift` | 서비스 없는 렌더 fixture에서 중성/옅은 조명 재질과 배경별 가독성 비교. 같은 재질에서 밝음/어두움·20.2/38 곡률·투명도 감소 비교. 폭 유지와 화면 경계 검사 | 중간 |
| T-03 결정·상세·상태 화면 | T-02 | UI implementer: 결정 뷰, `PetChoicePreviewView.swift`, 콘텐츠/크기 정책 | 2/3/4개 카드·긴 문장·상세·만료·오류·작업 중 렌더링. 고정 버튼과 본문 스크롤, 같은 폭. 기존 즉시 선택 경로 보존 | 중간 |
| T-04 선택 후 전달 | T-03, D3 채택 시만 | behavior implementer: `PetViewModel.swift`, 결정 뷰, 관련 테스트 | 클릭은 무전송, 주 버튼은 정확한 한 번 전송. 이벤트/버전 변경 및 만료 시 임시 선택 제거. 저장 단축키와 중복 전송 회귀 검사 | 높음 |
| T-05 승인·혼합 대기열 | T-03, T-04 해당 시 | UI implementer + qa: 승인 뷰, 네비게이션 표시; 엔진은 보존 | Hook/managed 요청 각각의 실제 선택지·순서·번호 보존. 세 이벤트 중 세 번째 처리, 전송 중 이동 차단, 낡은 콜백 거부 | 높음 |
| T-06 설정 탭·업데이트 | T-02 | settings implementer: 설정 뷰, `PetAppUpdateView.swift`, `PetAutomaticAppUpdateView.swift` | 설정값 유지, 탭 목적지 연결, 저장 실패/충돌 표시. 최신/새 버전/오류/파일 없음/설치 검토/복원 결과 접근 가능 | 중간 |
| T-07 통합 QA | T-03~T-06 | qa_reviewer: 아래 검사 묶음과 실제 네이티브 화면 확인 | 미리보기 키 해제·⌥방향키·실제 등록 키·비활성화 포커스·화면 경계·접근성·유휴 회귀 통과. 미검증 항목 구분 | 높음 |
| T-08 배포 준비 | T-07 | release owner: 별도 새 빌드, 기존 배포 파이프라인 | 새 버전 번호, 소스 입력 기록, 서명·공증·재다운로드 검증. 기존 r42 보존. 실제 게시·설치는 별도 배포 요청 범위 | 중간 |

T-05와 T-06은 공유 뷰 분리가 완료된 뒤에만 병렬 구현한다. 첫 시각 검토는 T-02/T-03의
격리 fixture를 사용하고, 실제 서비스·설치 앱을 바꾸지 않아도 검토할 수 있게 한다.

## 6. 검증 계획

아래 명령과 검사는 **향후 구현 단계의 계획**이며 이번 문서 작업에서 실행하지 않았다.
실제 수정 범위에 맞는 검사부터 실행하고, 새로운 실패나 변경이 있을 때만 범위를 넓힌다.

### 기존 검사 재사용

```sh
npm run test:swift -- --filter 'PetPanelSizePolicy|PetPlatformPolicy|PetChoicePreview|PetPreviewShortcutConfiguration|PetSettingsStatus|PetAppUpdate'
npm run test:swift -- --filter 'blabeePet|PetEventNavigation|PetApprovalHotKey|PetSkipDecision|PetTransportConcurrency'
```

- 레이아웃·미리보기: `PetPanelSizePolicyTests.swift`, `PetPlatformPolicyTests.swift`,
  `PetChoicePreviewTests.swift`, `PetChoicePreviewViewTests.swift`, `PetPreviewShortcutConfigurationTests.swift`.
- 선택·정확한 세션·중복 방지·위험·만료: `PetBehaviorTests.swift`, `PetModelTests.swift`.
- 혼합 대기열·단축키·건너뛰기: `PetEventNavigationTests.swift`, `PetEventNavigationHotKeyTests.swift`,
  `PetApprovalHotKeyTests.swift`, `PetSkipDecisionTests.swift`, `PetTransportConcurrencyTests.swift`.
- 설정·연결·업데이트: `PetOnboardingTests.swift`, `PetConnectionReadinessTests.swift`,
  `PetSettingsStatusIndicatorTests.swift`, `PetSettingsStatusToneTests.swift`, `PetAppUpdateTests.swift`,
  `PetAppUpdateViewTests.swift`, `PetAppUpdateViewModelTests.swift`.
- 업데이트 UI 연결이 달라지면 `AppUpdateTransactionTests.swift` 등으로 종료 전 확인·실패
  상태도 검사한다. 엔진 변경이 없는 외형 수정만으로 서명·실제 업데이트 검사를 무조건 반복하지 않는다.

### 이번 변경에서 추가할 의미 있는 검사

- D3 채택 시 클릭 직후 전송 0회, 버튼/키 경합 전송 1회, revision/이벤트 변경 후 전송 0회.
- 오류·만료·연결 손실·승인 전환 중 선택 강조와 주 버튼이 낡은 대상으로 남지 않음.
- 여러 줄 카드가 스크롤되어도 선택 번호·접근성 순서 1→2→3→4가 유지됨.
- 상세 펼침/미리보기/닫힘/대기열 전환에서 폭 유지, 본문과 고정 조작부 겹침 없음.
- 키보드 표시가 사용자가 저장한 조합과 등록 성공 여부를 반영함.
- 설정 탭 전환 후 미저장 초안 유지, 저장 실패 시 원래 설정 복원, 메뉴 진입 목적지 유지.
- 시안의 S4/S6/S7 성공·보관 문구가 실제 증거 없이 나타나지 않음.

### 화면 및 실사용 검사

- 상태표 30개에 대해 밝음/어두움 fixture 캡처. 시안에 없는 실제 r42 업데이트 상태와
  hold 미리보기·단축키 충돌·mixed queue·연결 끊김 상태도 별도로 포함한다.
- 짧은 제목/긴 한글/긴 명령/긴 경로, 2/3/4개 카드, 실제 사용할 수 있는 높이가 작은 화면,
  배율이 다른 디스플레이와 화면 간 이동, 투명도 감소·동작 줄이기·대비 증가를 확인한다.
- **중성 배경·밝은 문서·어두운 터미널·복잡한 사진** 위에서 동일한 패널을 비교한다.
  특정 색 배경에 의존하지 않고 테두리·카드·주 버튼·본문이 구별되어야 한다.
  하늘빛/크림빛 조명은 긴 글이나 경고를 가리지 않아야 하며, 투명도 감소의 불투명
  대체 표면에서도 여백·계층·가독성이 유지되어야 한다. 실제 배경색을 추출하는 기능은 필요 없다.
- 원래 터미널의 입력 포커스를 유지한 채 카드 클릭, 승인 응답, 설정 조작,
  ⌥←/→, hold modifier 해제가 각각 올바른 이벤트에 적용되는지 확인한다.
- 스크린 리더가 상태·선택 번호·추천·비활성 이유·선택됨을 읽을 수 있고 장식 도트가
  중복 낭독되지 않아야 한다. 보조 문구를 잘라 중요한 오류나 명령 범위를 숨기지 않는다.
- offscreen 테스트는 시스템 glass compositor를 완전히 증명하지 못하므로 최종 네이티브
  캡처를 별도로 확인한다. 참고 폴더의 60개 PNG는 제품 회귀 검사 통과 증거가 아니다.

## 7. 완료 정의와 남은 결정

계획 완료 기준: 모든 시안 ID에 현재 코드/실제 상태/검증 항목을 대응하고 D1–D6를 비교한다.
구현 완료 기준: 확정한 디자인이 네이티브 화면에 반영되고 기존 세션·승인·업데이트 동작의
회귀 검사가 통과하며, 사용자 환경에서 확인하지 않은 항목을 명확히 기록한다.

첫 구현 전 가장 중요한 결정은 **460pt 유지 여부**, **20.2pt/38pt 곡률**,
**일반 카드의 즉시 전달/선택 후 전달**이다. Enter·별도 설정 창·복구 실행·영속 보관함은
기존 동작을 넓히는 별도 항목이며 외형 이식에 묶어 자동 도입하지 않는다.

관련 기존 문서:
[대기 이벤트 이동](../src/coordinator-swift/docs/EVENT_NAVIGATION.md),
[승인 라우팅과 선택 건너뛰기](../src/coordinator-swift/docs/APPROVAL_THREAD_ROUTING_AND_DISMISS.md),
[자동 업데이트](AUTOMATIC_UPDATES.md).
