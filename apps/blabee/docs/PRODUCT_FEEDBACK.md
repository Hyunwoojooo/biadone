# Blabee 제안 반응과 사용자 피드백

## 작업 범위 (2026-09-17)

사용자가 승인한 추가 데이터: 카드 노출·반응·반응 시간 구간, 선택형 평가와 이유,
사용 목적, 사용자가 검토하고 직접 제출한 질문·답변·Blabee 제안, Codex 연결 환경,
향후 결제 연동에서 검증한 구독 이벤트. 기존 Coordinator SQLite와 설치본은 유지한다.

자동 통계 범위 확장은 `blabee.usageAnalytics.enabled.v3`로 새 동의를 받는다.
대화 원문은 자동 통계 대기열에 넣지 않으며 공유 화면의 메모리에만 유지한다.
평가/목적만 제출할 수 있고, 원문을 포함할 때는 민감정보 가림 후 미리보기 및 별도
확인을 거쳐 전송한다. 원문과 평가 제출은 30일 보관하며 본인의 제출 내역 삭제를 제공한다.
현재 로컬 데이터나 Codex 대화를 자동으로 업로드하지 않는다.

## 구현 계약

### 고정된 자동 지표

`public.record_blabee_insight_event`는 다음 14개 인수를 받으며 boolean을 반환한다.

| 인수 | 값 |
| --- | --- |
| `p_event_id` | 전송 중복 방지 UUID |
| `p_occurred_at` | 연결 관측 시각 또는 카드 최초 표시 시각, 최근 7일~미래 5분 |
| `p_metric_kind` | `card_presented`, `card_responded`, `connection_observed` |
| `p_card_id` | 카드별 새 무작위 통계 UUID, 연결 관측은 NULL |
| `p_card_kind` | `suggestion`, `approval`, 연결 관측은 `none` |
| `p_response` | `none`, `selected`, `dismissed`, `approved`, `denied` |
| `p_reaction_bucket` | `none`, `under_5s`, `5_to_30s`, `over_30s`, `unknown` |
| `p_app_version`, `p_app_build`, `p_os_major`, `p_ui_language` | 기존 제품 지표의 정규화된 환경 |
| `p_codex_version` | 숫자 점 버전 또는 `unknown`; 카드 지표는 `unknown` |
| `p_connection_mode` | `plugin`, `managed`, `unknown`; 카드 지표는 `none` |
| `p_compatibility` | `qualified`, `unqualified`, `unknown`; 카드 지표는 `none` |

실제 패널에 표시한 카드만 노출로 기록한다. 설정 화면, 숨겨진 패널, 미리보기,
수신만 된 카드는 제외한다. 같은 로컬 카드의 재렌더링/폴링은 중복 집계하지 않는다.
원래 카드·세션·프로젝트 식별자는 서버로 전송하지 않는다.
로컬 카드 추적은 메모리의 최대 256개 항목으로 제한한다. 추적에서 제거된 카드나
앱 재시작 후 다시 나타난 카드는 새 노출로 관측될 수 있다. 따라서 전역 고유 카드 수나
모든 사용자의 정확한 노출 총계로 해석하지 않는다.
반응은 정상 접수된 선택/건너뛰기/승인/거절이며 카드당 첫 반응만 집계한다.
Codex에서 직접 선택하기, 패널 닫기, 표시만 하고 응답하지 않은 경우는 이 네 반응에
포함하지 않는다. 따라서 반응 미관측을 사용자의 무시나 불만으로 해석하지 않는다.
반응 시간은 표시부터 사용자 조작까지의 단조 시계 구간이다. AI 작업 성공률이 아니다.
역순 전송에서도 카드 1개는 분모 1개이며 최초 날짜와 환경을 유지한다.
연결 환경은 사용자가 실행한 Codex 재검사 결과만 UTC 날짜별 집계하고 경로나 전체 버전
출력은 전송하지 않는다. `connection_mode=plugin`은 Plugin 설치가 관측된 경우만 사용하며,
실제 대화 연결 성공을 뜻하지 않는다. `compatibility`는 Plugin용 CLI 버전 허용 여부다.
Hook 신뢰, 서명 검증, 실제 실행 성공 여부를 대신하지 않는다. 설치나 버전 미확인은 unknown이다.
비공개 집계는 계정 삭제까지, 중복·카드 상태·수신일 한도 기록은 8일 초과 후 일일 정리한다.
사용자·UTC 수신일당 신규 전송은 1,000개로 제한한다.

### 사용자가 직접 제출하는 피드백

`public.submit_blabee_feedback` (UUID 반환):

- `p_submission_id uuid`: 재시도 시 동일 UUID.
- `p_rating text`: `none`, `helpful`, `unhelpful`.
- `p_reason text`: `none`; helpful이면 `next_step_clear`/`easier_action`;
  unhelpful이면 `irrelevant`/`already_done`/`repetitive`/`did_not_work`.
- `p_use_purpose text`: `none`, `development`, `debugging`, `writing`, `learning`, `other`.
- `p_question`, `p_answer`, `p_suggestion text`: 각각 UTF-8 최대 8,000 bytes, 생략은 빈 문자열.
- `p_note text`: UTF-8 최대 2,000 bytes, 생략은 빈 문자열.
- `p_content_consent boolean`: 하나라도 원문 필드가 있으면 true 필수.
- `p_policy_version integer`: `1`.
- `p_app_version`, `p_app_build`, `p_os_major`, `p_ui_language text`: 현재 정규화된 앱 환경.

모든 인수는 NULL을 허용하지 않는다. 아무 평가/목적/원문도 없는 제출은 거절한다.
서버가 `auth.uid()`와 수신 시각을 결정하고, 사용자당 하루 10건으로 제한한다.
동일 ID와 다른 본문은 충돌로 거절하고, 삭제된 제출의 늦은 재시도는 복원하지 않는다.
UI는 로그인/로그아웃/계정 전환과 비동기 응답 경계를 확인하며 원문을 디스크에 보관하지 않는다.

`public.list_blabee_feedback()`는 본인의 아직 만료되지 않은 제출 요약 최대 320개를
반환한다: `submission_id`, `received_at`, `expires_at`, `rating`, `reason`, `use_purpose`,
`has_content`. 이 목록 API는 원문을 반환하지 않는다.
`public.delete_blabee_feedback(p_submission_id uuid)`는 본인 제출만 즉시 삭제한다.
삭제 표식/중복 방지 기록은 31일간 보관해 네트워크 재시도로 내용이 되살아나지 않게 한다.
31일은 삭제/만료 시점부터 계산하는 재전송 방지 범위다. 표식 제거 후 동일 ID를
새 제출로 보내는 것까지 영구 차단하지는 않으며 앱은 원문 재전송을 디스크에 저장하지 않는다.
30일 만료 데이터는 목록과 운영자 보고서에서 즉시 제외하고 매일 실제 정리한다.

### 향후 결제 이벤트

서명 검증을 끝낸 결제 서버만 호출할 수 있는 구독 이벤트 기록 함수와 비공개 테이블을
준비한다. 로그인 사용자나 앱에서는 실행할 수 없다. 공급자 이벤트 ID로 중복을 제거하고
발생 시각과 수신 시각을 별도로 보관한다. 구독 시작/갱신/해지 예약/종료를 구분한다.
이 분석용 기록은 과금 권한이나 entitlement를 변경하지 않는다. 결제 공급자 연동은
아직 없으므로 실제 결제 데이터 수집과 유료 권한 활성화는 이번 구현에 포함되지 않는다.

`public.record_blabee_subscription_event(p_provider text, p_provider_event_id text,
p_user_id uuid, p_event_kind text, p_occurred_at timestamptz, p_cancellation_reason text)`는
boolean을 반환한다. service_role만 실행할 수 있다. provider는 stripe/paddle/lemonsqueezy/toss,
종류는 started/renewed/cancellation_scheduled/ended이며, 해지 이유는 고정 선택 항목이다.
이는 향후 입력 계약으로, 해당 공급자와의 실제 연동을 완료했다는 뜻이 아니다.

## 작업 분담 및 검증 계획

- DB: 추가 migration 0006/0007, 수집/삭제/보관/권한 테스트, 관리자 보고서.
- 자동 통계: 기존 제한된 대기열 확장, v3 동의, 카드 관측·연결 지표와 전송 테스트.
- 피드백: 전용 전송/상태 관리, 선택 입력/미리보기/제출/삭제 화면, 인증 경계와 검증 테스트.
- 앱 연결: 실제 표시·정상 접수 경계, 설정 진입점, 로그인 변경 연결.
- 종합 확인: 기존 계정/사용 통계/오류/업데이트 회귀, 화면 렌더, SQL 검증 후 운영 DB 적용.

## 구현 및 운영 적용 결과 (2026-09-17)

- 운영 Supabase에 `202609170006_blabee_feedback.sql`과
  `202609170007_blabee_feedback_retention.sql`을 순서대로 적용했다.
- 새 비공개 테이블 9개 모두 RLS 활성화, anon/authenticated/service_role의 직접 테이블
  접근 차단을 확인했다. 공개 RPC 5개의 빈 search_path와 실행 역할도 확인했다.
  사용자용 RPC 4개는 authenticated, 구독 기록 RPC는 service_role에만 허용한다.
- `blabee-feedback-retention-daily`가 매일 03:37 UTC(12:37 KST)에 실행되도록 등록했다.
  기존 오류 03:17 UTC, 제품 지표 03:27 UTC 작업도 유지됐다. 예약 등록까지 확인했으며
  운영 환경에서 다음 예약 시각의 실제 실행 결과를 관측한 것은 아니다.
- 카드/연결/피드백/구독 신규 테이블은 모두 0건이었다. 테스트 사용자나 원문을
  운영 DB에 삽입하지 않았다.
- SQL Editor의 개인 쿼리
  [Blabee 제안 반응·피드백 현황](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/sql/e3016011-9e53-469e-9485-b13017a637be)을
  저장했다. `supabase/feedback-reports.sql`의 SELECT 6개를 각각 선택해 실행한다.
  노출/첫 반응, 반응 시간, 연결 환경, 평가/목적, 직접 제출한 내용, 구독 관측을 조회한다.

### 변경 파일

- DB: migration 0006/0007, `supabase/feedback-reports.sql`,
  `supabase/tests/feedback.sql`, `supabase/tests/feedback-reports.sql`.
- 자동 통계: `PetInsightMetrics.swift`, `PetUsageAnalytics.swift`,
  `PetUsageAnalyticsView.swift`, `PetInsightMetricsTests.swift`,
  `PetInsightObservationTests.swift`, `PetUsageIntegrationTests.swift`.
- 직접 제출: `PetFeedback.swift`, `PetFeedbackView.swift`, `PetFeedbackWindow.swift`,
  `PetFeedbackTests.swift`, `PetFeedbackViewTests.swift`.
- 앱 연결: `PetApplication.swift`, `PetViewModel.swift`, `PetView.swift`,
  `PetSettingsView.swift`. 관련 안내는 이 문서와 `USAGE_ANALYTICS.md`, `PRODUCT_METRICS.md`.

### 검증 결과

- PGlite: 수집/인증/한도/삭제/보존 검증 18개 그룹과 실제 보고서 결과 6개 그룹 통과.
  별도 cron 예약/기존 작업 보존 fixture도 통과했다.
- Swift 순차 실행: 선택한 324개 테스트 선언 중 323개 통과. 새 피드백/insight
  7개 suite의 56개 선언은 모두 통과했고, 사용 행동 연결/로그인/진단/업데이트
  관련 회귀도 통과했다. 로그: `/tmp/blabee-feedback-tests-serial-20260917.log`.
- 남은 자동 검사 실패는 기존 `PetAirViewTests.choiceGrid`의 count 3/4에서 작은
  `권장` 배지를 판독하지 못한 OCR 2건이다. 단독 실행에서도 재현됐으며, 해당
  16개 렌더 이미지 모두 배지가 잘리지 않고 보이는 것을 확인했다. 이 fixture는
  feedback=nil이므로 새 피드백 버튼을 표시하지 않는다. 제품 레이아웃은 변경하지 않았다.
- 피드백 편집/미리보기의 최소·기본 크기와 밝은·어두운 화면 8개를 렌더했다.
  검토한 화면에서 가려진 이메일, 선택하지 않은 원문 공유 확인, 비활성 전송 버튼,
  보관/삭제 안내가 정상 표시됐다. `/tmp/blabee-feedback-renders-20260917`.
- 초기 병렬 실행에서는 UI 렌더링과 타이머 기반 검사가 경합했다. `--no-parallel`로
  실행해 타이머 실패가 없어지는 것을 확인했다. 새 렌더 테스트의 출력 디렉터리 생성
  누락도 수정했다. 소스 및 신규 파일 공백 검사를 수행했다.

### 검토용 빌드와 남은 실제 사용 확인

`build/local-feedback-review-20260917-r56/Blabee.app`에 build 56 검토용 앱을 만들었다.
격리된 Swift 테스트 산출물과 실행 파일 UUID 일치, Info.plist 검사,
`codesign --verify --deep --strict` 통과. 개발용 ad-hoc 서명이며 공개 배포용 공증
패키지는 아니다. 현재 설치된 build 47은 실행·교체하지 않았다.

패키지에는 설치된 앱의 전송 호환 식별자를 포함했다. 이전 앱과 현재 소스의 Plugin
launcher가 달라 실행 중 교체를 위한 lease 호환 목록은 비어 있다. 기존 패키저의
검증 결과이며 이 목록을 수동으로 채우거나 설치 보호를 우회하지 않았다.

새 앱에서는 설정 → 사용 통계 보내기를 다시 선택해야 자동 통계가 시작된다.
피드백은 상단 말풍선 또는 설정 → 제품 개선에 참여하기에서 별도 창을 열어 제출한다.
로그인 갱신은 초안을 보존하고, 계정 변경/로그아웃/창 닫기는 초안과 이전 비동기 응답을
차단한다. 새 앱 설치 후 실제 계정으로 전송 → 본인 내역 조회 → 삭제의 전체 흐름과
카드 관측 수집을 확인하는 단계는 남아 있다. 운영 원문 전송은 이번 검증에서 실행하지 않았다.
실제 결제 공급자 webhook 및 다중 PostgreSQL 연결의 동시성 검증도 별도 후속 범위다.

설계 참고: [Supabase 함수 권한](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
