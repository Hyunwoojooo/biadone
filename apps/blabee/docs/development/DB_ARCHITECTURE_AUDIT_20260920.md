# Blabee DB 아키텍처 점검 — 2026-09-20

운영 Supabase의 메타데이터를 읽기 전용으로 확인하고, 현재 SQL을 격리된 PGlite에 적용해 점검했다. 확인 범위에서 다른 사용자 데이터 접근이나 집계 손상은 발견하지 못했다. 출시 전에 보완할 중간 우선순위 문제 3건과 지표 정의 불일치 1건을 확인했다.

운영 스키마·데이터·예약 작업과 앱 코드는 변경하지 않았다. 이 보고서만 추가했다. 운영 이메일, 피드백 원문, 토큰은 조회하지 않았다.

## 확인한 구조

- 네이티브 계정 인증: `app/account/`의 Supabase Auth 및 별도 Keychain 세션.
- 사용·제품·카드 반응: `app/telemetry/PetUsageAnalytics.swift`의 동의·계정 경계가 적용된 대기열 → 인증 RPC → 비공개 `blabee_analytics` 스키마.
- 오류 진단: 별도 동의와 대기열. 고정 오류 코드와 정규화된 버전만 전송.
- 피드백: 사용자가 확인하고 동의한 내용만 별도 RPC로 제출. 본인 목록·삭제 기능 분리.
- 로컬 Coordinator SQLite: `engine/persistence/SQLiteJournal.swift`에서 별도로 관리. 클라우드 계정·통계 테이블이 들어가지 않는다.
- 구독 이벤트: 서버 역할 전용 기록 RPC. 현재 점검한 SQL은 결제 권한을 판정하는 전체 entitlement 시스템이 아니다.

## 확인된 문제

### P2-1. 기본 사용 기록의 서버 수신 한도가 없다

위치: `supabase/migrations/202609170001_blabee_usage.sql:89–110`.

`record_blabee_usage`는 로그인 사용자와 입력 형식을 검증하지만, 서로 다른 이벤트 UUID가 들어오면 제한 없이 영수증을 추가하고 사용 횟수를 증가시킨다. 클라이언트의 256건 대기열 제한은 서버가 하루에 받아들이는 건수 제한이 아니다. 오류·제품·카드 반응 RPC에는 각각 서버 한도가 있다.

재현:

- 격리된 DB에서 `authenticated` 역할의 한 계정이 같은 날 서로 다른 이벤트 10,001건을 제출했다.
- 10,001건 모두 접수됐고 `event_receipts`와 `action_count`가 각각 10,001 증가했다.
- 별도 1,001건 재현에서도 같은 결과가 나왔다.
- 운영 함수 본문의 MD5가 현재 파일과 일치했다: `f9034484b3f3cf04632038975c077a44`. 운영에는 재현용 이벤트를 넣지 않았다.

영향: 오류 난 클라이언트나 직접 RPC 호출이 저장량과 자신의 사용 통계를 과도하게 늘릴 수 있다. 다른 계정의 데이터를 수정하는 문제는 아니다.

권장 수정: 사용자별 UTC **수신일** 한도와 원자적 카운터를 추가한다. 동일 UUID 재시도는 한도를 소비하지 않고, 한도 초과는 저장하지 않은 채 종료 응답을 반환한다. 한도 경계·중복·날짜 변경·계정 분리와 실제 다중 연결 경쟁을 검증한다. 이 한도는 저장량 보호이며 모든 HTTP 부하를 막는 수단은 아니다.

### P2-2. 기본 사용 영수증 정리가 자동 실행되지 않는다

위치:

- `supabase/migrations/202609170001_blabee_usage.sql:121–142`: 192시간보다 오래된 영수증을 삭제하는 함수.
- `supabase/migrations/202609170003_blabee_error_retention.sql:10–14`
- `supabase/migrations/202609170005_blabee_product_retention.sql:8–12`
- `supabase/migrations/202609170007_blabee_feedback_retention.sql:5–9`

예약된 세 작업은 오류·제품·피드백을 정리하며 기본 `event_receipts`를 정리하지 않는다. 운영 `cron.job`도 전체 3개, 기본 사용 영수증 정리 작업은 0개였다.

재현:

- 격리 DB에서 영수증 1,001건의 수신 시각을 30일 전으로 바꿨다.
- 예약된 세 정리 명령을 모두 실행해도 1,001건이 남았다.
- `prune_usage_event_receipts()`를 직접 실행하면 1,001건이 삭제되고 일별 사용 집계 1,001회는 유지됐다.

운영 조회 시 영수증은 197건이었고, 가장 오래된 수신 시각은 `2026-09-18T04:25:04.018857Z`, 192시간 초과 기록은 0건이었다. **현재 오래된 데이터가 이미 쌓였다는 의미는 아니다.** 수동 정리나 별도 외부 작업이 없다면 계속 누적되는 구조다. 외부 스케줄러는 이번 범위에서 확인하지 않았다.

`docs/USAGE_ANALYTICS.md:96`에도 자동 예약을 하지 않았다고 명시돼 있다. 따라서 약속된 자동 삭제의 오작동보다는 운영 자동화가 남아 있는 상태로 분류한다.

권장 수정: 기존 세 작업을 유지하고 사용 영수증 전용 일일 cron을 추가한다. 192시간 경계, 집계 보존, 재실행 안전성, 실제 예약 실행 성공을 확인한다. 일일 실행이라 물리 삭제는 경계 후 다음 실행까지 지연될 수 있다.

### P2-3. DB 검증·배포 이력을 저장소에서 재현하기 어렵다

위치: `package.json:7–24`, `docs/PRODUCT_METRICS.md:90–104`, `docs/USAGE_ANALYTICS.md:89`.

- SQL 테스트 파일은 있지만 저장소에 실행기와 SQL 테스트 명령이 없다.
- 기존 실행기는 `/tmp/blabee-usage-sql.4A3ysm/`에 있어 새 개발 환경에서 바로 재현할 수 없다.
- Supabase CLI 설정과 Blabee DB 검사 CI가 없다.
- 운영에서 `to_regclass('supabase_migrations.schema_migrations')`는 `null`이었다. 기존 SQL Editor 수동 적용 내역이 CLI 이력으로 관리되지 않는다.

영향: 일반 앱 검사만 통과해도 DB 계약이 깨질 수 있고, CLI로 옮길 때 이미 적용한 SQL을 다시 실행하려는 상황이 생길 수 있다. **이번에 비교한 함수 12개의 본문은 운영과 소스가 일치했다.** 현재 전체 스키마가 다르다는 주장은 아니다.

권장 수정: 격리 DB 실행기와 고정된 개발 의존성, 명령·CI를 저장소에 추가한다. 실제 운영 스키마를 대조한 뒤 기존 적용분의 이력을 맞추고 이후 변경을 migration으로 관리한다. 이력부터 임의로 완료 처리하거나 기존 migration을 운영에 다시 실행하지 않는다. Supabase 공식 문서도 SQL Editor 변경이 migration 이력을 우회하며, CLI가 별도 이력 테이블로 적용 여부를 판단한다고 설명한다. [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)

### P3-1. 승인 관련 사용 횟수의 설명이 실제 집계와 다르다

위치:

- `docs/USAGE_ANALYTICS.md:24`: `approval_resolved`를 승인 또는 거절의 접수로 설명.
- `app/coordination/PetViewModel.swift:2176–2219`, `2262–2305`: `deferToCodex`·`decideInCodex`도 사용 횟수와 기능 성공에 포함.
- `Tests/swift/BlabeePetTests/PetUsageIntegrationTests.swift:101–134`: 모든 승인 선택을 같은 사용 범주로 기록하도록 명시.

카드 반응 지표에서는 이 두 위임 선택을 승인/거절로 기록하지 않는다. 따라서 사용 횟수의 승인 범주와 카드 승인·거절 합계는 같은 숫자가 아니다. 저장 오류로 확인된 것은 아니지만 운영자가 지표를 잘못 해석할 수 있다.

권장 수정: 현재 이벤트를 ‘권한 요청에 대한 사용자 선택 접수’로 설명하고 위임 포함 여부를 보고서에 명시한다. 승인·거절만 별도로 측정하려면 이벤트 계약과 이전 데이터 해석을 함께 설계한다.

## 정상 확인 결과

운영 DB 읽기 전용 점검:

- 비공개 analytics 테이블 20개 모두 RLS 활성화, 클라이언트 정책 0개.
- `anon`·`authenticated`·`service_role` 모두 해당 스키마 USAGE 및 직접 테이블 SELECT/INSERT/UPDATE/DELETE 권한이 없다.
- 공개 Blabee RPC 8개 모두 `SECURITY DEFINER`, 빈 `search_path` 적용, 익명 실행 차단.
- 사용자 RPC 7개는 authenticated 실행 허용. 구독 이벤트 RPC는 service_role만 실행 허용.
- 원래 사용 RPC에는 service_role의 EXECUTE도 남아 있다. 함수는 `auth.uid()`를 요구하며, 일반 사용자 권한 상승 경로는 확인되지 않았다. 격리 fixture에는 운영의 이 기본 권한이 없어 실제 ACL은 별도 조회했다.
- RPC 8개와 정리 함수 4개 본문 해시가 소스와 모두 일치했다. 함수 본문 외 전체 스키마의 동일성을 증명하는 검사는 아니다.
- 오류·제품·피드백 cron은 모두 활성 상태다. 각각 2026-09-20 **03:17 / 03:27 / 03:37 UTC** 실행이 `succeeded`였으며, 남아 있는 최근 7일 실행 이력의 실패 건수는 0이었다. 작업 존재와 성공 여부는 `cron.job`·`cron.job_run_details`로 확인했다. [Supabase Cron](https://supabase.com/docs/guides/cron)

격리 DB 검증:

- 기존 SQL 검증 **75개 그룹 통과**: 사용 14, 오류 15, 제품 22, 피드백 24.
- migration 적용, fixture 롤백, 제품·피드백 cron 함수 형태 및 재등록 검사도 통과했다.
- 계정 삭제 시 analytics 20개 테이블의 해당 계정 행이 모두 삭제됐다.
- 사용자 FK를 지원하는 선두 인덱스 누락은 없었다.
- 중복 수신, 입력 허용 목록, 동의 필수 조건, 본인 피드백 조회·삭제, 만료·삭제 후 재전송 방지, UTC 경계와 실제 보고서 분모 검증을 통과했다.
- 오래된 원래 발생 시각을 유지한 사용 이벤트 재전송은 영수증 정리 후에도 거부됐다.

현재의 고정 `search_path` 및 명시적 실행 권한 검사는 Supabase의 함수 보안 권장사항과도 일치한다. [Database Functions](https://supabase.com/docs/guides/database/functions)

## 실행 증거와 한계

이번 재실행 로그:

```text
/tmp/blabee-db-architecture-audit.jYUPEt/usage.log
/tmp/blabee-db-architecture-audit.jYUPEt/errors.log
/tmp/blabee-db-architecture-audit.jYUPEt/product.log
/tmp/blabee-db-architecture-audit.jYUPEt/feedback.log
/tmp/blabee-db-consistency-audit.IFG3lw/run.mjs
/tmp/blabee-db-consistency-audit.IFG3lw/result.log
```

사용한 기존 실행기는 `/tmp/blabee-usage-sql.4A3ysm/`의 `run-usage-tests.mjs`, `run-error-tests.mjs`, `run-product-tests-20260917.mjs`, `run-feedback-tests-20260917.mjs`다. 네 실행 모두 종료 코드 0이었다. 임시 경로의 영구 보존은 보장되지 않는다.

PGlite 검증은 실제 다중 연결의 경합·부하나 실제 pg_cron 실행을 대체하지 않는다. 운영 cron은 별도의 실행 이력을 읽어 확인했으며 시험 실행하지 않았다. 새 PostgreSQL 인스턴스를 설치하지 않았고 앱·Swift 테스트는 이번에 실행하지 않았다. 앱과 SQL의 인수·허용값·재시도·계정 전환 경계는 소스로 검토했다.

PostgREST의 exposed schema 설정은 SQL Editor에서 보이지 않아 확인하지 못했다. 실 HTTP/JWT 보안 재현, 백업 복구 시험, 전체 스키마 차이 비교와 로컬 Coordinator SQLite 내부의 전체 감사를 수행한 것은 아니다.

운영에서는 SELECT만 실행했다. Dashboard SQL Editor에는 이번 점검용 새 Untitled query 탭이 생겼으며 기존 저장된 보고서는 수정하지 않았다. 커밋·배포·앱 교체·설정/비밀키 변경은 하지 않았다.

후속 작업 순서는 수신 한도와 정리 예약 보완 → 재현 가능한 DB 검사·이력 관리 → 지표 정의 정리가 적절하다. 이번 점검은 완료됐으며 운영 수정 적용은 포함하지 않는다.
