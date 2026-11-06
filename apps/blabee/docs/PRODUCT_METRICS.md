# Blabee 제품 개선 지표

후속 확장은 [제안 반응 및 사용자 피드백](PRODUCT_FEEDBACK.md)에 기록한다.
기존 기능 접수 지표는 유지하고, 자동 수집 확대에는 v3 동의를 새로 받는다.

## 구현 범위 (2026-09-17)

사용자가 요청한 초기 설정, 기능 성공률·응답 속도, 앱/OS 버전 및 업데이트,
버튼/단축키, 실제 표시 언어를 선택적 사용 통계에 추가한다. 기존 사용 횟수와
오류 진단의 의미는 유지한다. 기존 동의의 범위를 자동 확장하지 않도록 새 버전의
사용 통계 동의는 기본 꺼짐으로 시작하고 설정에서 수집 범위를 안내한다.

계정과 동의가 확인된 뒤 관측한 데이터만 전송한다. 대화·코드·명령·경로·프로젝트명,
기기 식별자, 세션 식별자, 상세 작업 시간, 원문 로그는 입력 필드 자체를 제공하지 않는다.
기능 응답 시간은 단조 시계로 측정하고 구간만 전송한다. 화면 언어는 현재 실제 UI인 `ko`다.

## 앱/DB 계약

기존 사용 통계 대기열에 선택적인 제품 지표를 추가한다. 기존 이벤트는 기존 RPC를
유지하고, 제품 지표는 `public.record_blabee_product_event`로 보낸다.

RPC 인수:

| 인수 | 허용 값 |
| --- | --- |
| `p_event_id` | 전송 중복 방지 UUID |
| `p_occurred_at` | 원래 관측 시각, 최근 168시간~미래 5분 |
| `p_metric_kind` | 아래 고정 이벤트 종류 |
| `p_operation_id` | 기능/업데이트 시도 UUID, 그 외 NULL |
| `p_feature` | `none`, `choice`, `approval`, `dismiss`, `app_update` |
| `p_input_method` | `none`, `button`, `keyboard` |
| `p_latency_bucket` | `none`, `under_1s`, `1_to_3s`, `over_3s`, `unknown` |
| `p_app_version`, `p_app_build` | 숫자 점 버전(각 1~6자리, 최대 4구간) 또는 `unknown` |
| `p_os_major` | 1~6자리 숫자 또는 `unknown` |
| `p_ui_language` | `ko`, `en`, `other`, `unknown` (현재 앱은 `ko`) |
| `p_target_version`, `p_target_build` | 업데이트는 숫자 점 버전 또는 `unknown`, 그 외 `none` |

고정 이벤트:

- `environment_observed`: 로그인 및 동의 후 실제 앱 환경 관측. 사용자·UTC 날짜·환경별 한 번 집계.
- `account_ready`, `service_connected`, `card_received`, `first_action`: 단계별 최초 관측 날짜.
  서비스 응답만으로 Codex 연결을 확정하지 않는다. 첫 카드 수신과 첫 접수 성공을 별도로 기록한다.
- `feature_started`, `feature_succeeded`, `feature_failed`, `feature_cancelled`:
  동일 operation ID와 시작 날짜·환경·기능·입력 방식을 사용한다. 요청 접수 응답까지의 성공 여부다.
  완료가 먼저 도착해도 시도는 한 번만 집계한다. 취소 및 결과 미확인은 실패와 분리한다.
- `update_available`: 검증된 업데이트 제안. 사용자·날짜·대상 버전별 한 번 집계.
- `update_started`, `update_succeeded`, `update_failed`, `update_cancelled`:
  설치 작업 시도. 성공은 같은 계정·동의에서 시작한 업데이트의 대상 앱 실행을 확인해야 한다.
  설치 보조 프로세스 시작이나 앱 종료는 성공이 아니다. 원본 작업 정보를 전송하지 않는다.

환경·단계: feature/input/latency=`none`, operation=NULL, target=`none`.
기능: feature=choice/approval/dismiss, input=button/keyboard, target=`none`, operation 필수.
기능 시작은 latency=`none`, 종료는 속도 구간 또는 `unknown`.
업데이트: feature=app_update, input/latency=`none`, 대상 버전 필수;
available은 operation=NULL, 나머지는 필수.

## 보관과 조회

비공개 `blabee_analytics` 스키마, RLS 활성화, 클라이언트 직접 접근 금지,
로그인된 사용자만 RPC 실행 가능, 사용자 ID는 서버 `auth.uid()`에서 결정한다.
기능은 시도와 결과를 짝지어 집계해 성공률의 분모를 유지한다. 일별 집계와 단계별
최초 관측 날짜는 계정 삭제 시 함께 삭제한다. 재전송·시도 상태·수신일 한도용 보조
기록은 8일을 초과하면 일일 정리한다(예약 실행 사이 최대 약 9일). 사용자별 UTC 수신일
1,000개의 새로운 유효 전송을 허용하며, 동일 전송 ID 재시도는 상한을 소모하지 않는다.
새 ID로 같은 단계를 다시 보내는 경우에는 상한을 소모한다.

집계는 동의한 사용자의 관측치다. 동의 전 로그인/설정 이력은 소급 생성하지 않는다.
정상 종료하지 못한 시도, 전송 누락, 수신 한도로 전체 사용자 수·실제 성공률과 다를 수 있다.
표시 언어는 국적이나 위치가 아니며, 환경 관측은 실제 기능 사용 횟수가 아니다.

## 검증 및 적용

2026-09-17 완료:

- `supabase/migrations/202609170004_blabee_product_metrics.sql`과
  `202609170005_blabee_product_retention.sql`을 실제 Blabee 프로젝트
  `vulnkqyqqbucvbhwjswr`의 SQL Editor에서 순서대로 적용했다.
- 비공개 테이블 7개 모두 RLS 활성화, anon/authenticated/service_role 직접 테이블 접근
  차단, anon RPC 실행 차단, authenticated RPC 실행 허용, definer의 빈 search_path를
  운영 DB 메타데이터에서 확인했다. 확인 당시 새 제품 지표 수신 기록은 0건이었다.
- 정리 작업 `blabee-product-retention-daily`(job ID 2)는 postgres 소유로 활성화되어 있다.
  서버 cron 시간대 GMT, 매일 **03:27 UTC / 12:27 한국 시간**에 실행한다. 기존 오류 진단
  정리 작업은 유지된다. 예약의 첫 실제 실행 결과는 아직 관측하지 않았다.
- 운영자용 [Blabee 제품 사용·성능 현황](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/sql/092af1b4-c7c5-462d-ba03-225fa777e7e6)을
  비공개 SQL 보고서로 저장했다. 설정 단계·기능 결과·응답 속도·환경·업데이트별 SELECT를
  각각 실행할 수 있다. 원문은 `supabase/product-reports.sql`이다.
- 네이티브 제품 지표·기존 사용 통계·오류 진단·로그인·업데이트·단축키·설정 회귀 검증:
  **213개 테스트, 25개 모음 통과**. 로그 `/tmp/blabee-product-final-tests-20260917.log`.
  설정 화면은 260pt/384pt, 밝은/어두운 화면, 켜짐/꺼짐 8가지 렌더를 확인했다.
- 로컬 PostgreSQL(PGlite)에서 수집·보안·보존 17개와 실제 보고서 5개 assertion 그룹,
  합계 **22개 통과**. 별도 cron 함수 형태 fixture 검사도 통과했다. 이 검증은 실제
  다중 연결 경쟁 시험이나 pg_cron의 예약 실행을 대체하지 않는다.
  실행기는 `/tmp/blabee-usage-sql.4A3ysm/run-product-tests-20260917.mjs`다.
- 검토용 앱: `build/local-product-review-20260917-r55/Blabee.app`, 빌드 **55**.
  테스트한 Debug 실행 파일로 조립했으며 임시 서명과 `codesign --verify --deep --strict`를
  통과했다. Developer ID 서명·공증된 공개 배포본은 아니다.
  테스트 실행 파일과 앱 실행 파일의 Mach-O UUID는
  `8F7963F4-D270-3F68-91B5-EFC8EAF442F4`로 일치한다.
- 설치된 빌드 47과 실행 중인 사용자 세션은 교체·중단하지 않았다. 새 앱 설치 후 로그인 →
  설정/일반/사용 통계 켜기 → 실제 기능 사용 → 서버 집계 증가 경로의 실사용 확인은 남아 있다.
  이번 변경은 이전 통계 동의를 자동 승계하지 않으므로 기존 사용자도 설정에서 새 범위를 확인한다.

SQL Editor 적용은 Supabase CLI migration 이력에 자동 등록되지 않는다. CLI로 이전할 때는
0004/0005와 이전 수동 적용분의 이력을 실제 스키마에 맞춘 뒤 push한다.

## 변경 파일과 경계

- 앱 핵심: `PetUsageAnalytics.swift`, `PetProductMetrics.swift`, `PetUsageAnalyticsView.swift`.
- 앱 연결: `PetViewModel.swift`, `PetApplication.swift`.
- 업데이트 관측: `PetProductUpdateMetrics.swift`, `AppUpdateTransaction.swift`.
- 검증: `PetProductMetricsTests.swift`, `PetProductUpdateMetricsTests.swift`,
  `PetUsageIntegrationTests.swift`, `supabase/tests/product-metrics.sql`,
  `supabase/tests/product-reports.sql`.
- 업데이트의 성공은 대상 앱이 실행된 관측이다. Codex 세션 복원 성공률은 측정하지 않는다.
  재시작 후에도 원래 계정·동의와 정확히 일치하는 로컬 설치 작업만 인정하며, 설치 작업 ID는
  외부로 보내지 않는다. 로컬 표식은 4 KiB/7일로 제한하고 명시적 로그아웃 때 즉시 지운다.
- 앱에 새 외부 SDK나 production dependency는 추가하지 않았다. Coordinator SQLite는 유지한다.

DB 권한 설계 참고: [Supabase 함수 보안](https://supabase.com/docs/guides/database/functions),
[행 수준 보안](https://supabase.com/docs/guides/database/postgres/row-level-security).
