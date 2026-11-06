# DB 영역 안내

Supabase의 비공개 스키마와 `public.*` RPC, 그 Swift 클라이언트(`app/account`, `app/telemetry`), 계정 웹(`account-web`), PGlite 테스트(`Tests/Cloud`)를 다룬다.
**운영 DB에 Claude Code가 SQL을 실행하거나 cron을 등록하지 않는다.** 적용은 사용자가 Dashboard SQL Editor에서 직접 한다.

## 구조

- 스키마 `blabee_analytics`(사용·오류·제품·피드백), `blabee_access`(계정 정지·서비스 중지). 둘 다 REST 노출 스키마에 넣지 않는다.
  `blabee_analytics`는 `public`/`anon`/`authenticated` 직접 권한을 회수했고(`service_role`은 `202609170006`의 일부 테이블만 추가 회수),
  `blabee_access`는 `service_role`까지 스키마·테이블 단위로 회수했다.
- 클라이언트는 `public.*` RPC만 호출한다. 모두 `security definer`, `search_path=''`, `auth.uid()` 필수.

| 호출자 | RPC | 조건 |
| --- | --- | --- |
| `app/telemetry/PetUsageAnalytics.swift` | `record_blabee_usage`, `record_blabee_product_event`, `record_blabee_insight_event` | 사용 통계 동의(`blabee.usageAnalytics.enabled.v3`) + 로그인 |
| `app/telemetry/PetErrorDiagnostics.swift` | `record_blabee_error`, `record_blabee_connection_error` | 별도 오류 진단 동의(`blabee.errorDiagnostics.enabled`). 첫 실행 온보딩 전엔 강제 off |
| `app/telemetry/PetFeedback.swift` | `submit_blabee_feedback`, `list_blabee_feedback`, `delete_blabee_feedback` | 사용자 직접 제출. 본문은 `p_content_consent` 참일 때만(SQL CHECK) |
| `app/account/ProductAccess.swift` | `get_blabee_access(p_nonce)` | 동의와 무관. 제품 사용에 항상 필요 |
| 서버 전용 | `record_blabee_subscription_event`(service_role), `admin_set_blabee_user_access`, `admin_set_blabee_service_access`(함수 안에서 관리자 membership 재확인) | |

인증은 Supabase Auth PKCE(`app/account/PetAccountAuth.swift`), 콜백 `com.biadone.blabee://auth/callback`. `account-web`은 Vite + supabase-js 정적 웹이며 publishable key만 쓴다.

| migration | 내용 |
| --- | --- |
| `202609170001_blabee_usage` | `blabee_analytics` 스키마, `event_receipts`/`daily_activity`, `record_blabee_usage`, 정리 함수(cron 미등록) |
| `202609170002_blabee_errors`, `202609170003_blabee_error_retention` | `error_events`, `record_blabee_error`, pg_cron 정리 |
| `202609170004_blabee_product_metrics`, `202609170005_blabee_product_retention` | product_* 테이블 7개, `record_blabee_product_event`, 정리 cron |
| `202609170006_blabee_feedback`, `202609170007_blabee_feedback_retention` | insight·card·feedback·subscription 테이블과 RPC 5개, 정리 cron |
| `202609240001_blabee_connection_diagnostics` | `error_events` nullable 컬럼 4개, `record_blabee_connection_error` |
| `202609270001_blabee_access_control` | `blabee_access` 스키마(테이블 4개, RLS), `get_blabee_access`, 관리자 RPC 2개, 감사 로그 |

## 적용 절차(운영)

- Supabase CLI 설정(`config.toml`)과 CI 실행기가 저장소에 없다. 운영 `supabase_migrations.schema_migrations`는 CLI가 관리하지 않는다(`docs/development/DB_ARCHITECTURE_AUDIT_20260920.md`).
- 새 migration **하나**를 사용자 승인 뒤 SQL Editor에서 **한 번** 실행하고, 적용한 원본의 SHA-256을 문서에 기록한다
  (`docs/features/ACCESS_CONTROL_ADMIN.md`, `docs/features/CONNECTION_DIAGNOSTICS_DEPLOYMENT.md` 형식). `supabase db push`를 쓰지 않는다.
- 이미 적용한 migration 본문을 수정하거나 다시 실행하지 않는다. 이력을 임의로 완료 처리하지 않는다.

## 새 migration 체크리스트

1. `migrations/<YYYYMMDDNNNN>_blabee_<기능>.sql`. 머리말 주석에 선행 migration·적용 role·노출 스키마 제외를 적고 `begin;`/`commit;`으로 감싼다. 기존 RPC와 append-only 호환.
2. `tests/<기능>.sql`: 일회용 DB에서 돌리고 끝에 롤백.
3. `Tests/Cloud/*.test.mjs`(PGlite). 실행기는 `access-control`, `connection-diagnostics` 둘뿐이다. `access-control.test.mjs`는 `docs/features/ACCESS_CONTROL_ADMIN.md`의 sql 코드 블록까지 파싱해 실행하고,
   `connection-diagnostics.test.mjs`는 Swift 소스와 `connection-error-reports.sql`을 대조한다. 그 문서·소스를 고치면 이 테스트가 깨질 수 있다.
   usage/feedback/product-metrics SQL 테스트는 수동 `psql` 대상.
4. `*-reports.sql`: 관리자가 postgres 권한으로 SQL Editor에서 돌리는 쿼리. 공개 view나 클라이언트 API로 만들지 않는다.
5. Swift 클라이언트의 RPC 인자명·허용값과 관련 Swift 테스트.
6. 문서: `docs/features/PRODUCT_ACCESS.md`, `docs/features/ACCESS_CONTROL_ADMIN.md`, `docs/features/CONNECTION_DIAGNOSTICS.md`,
   `docs/USAGE_ANALYTICS.md`, `docs/ERROR_DIAGNOSTICS.md`, `docs/PRODUCT_METRICS.md`, `docs/PRODUCT_FEEDBACK.md`에 적용 기록·런북.

## 바꾸면 안 되는 것

- Keychain 서비스명 `com.biadone.blabee.account.v1.<projectHost>`(`app/account/PetAccountKeychain.swift`), UserDefaults 동의 키 `blabee.usageAnalytics.*.v3`, `blabee.errorDiagnostics.*`. 키를 바꾸면 사용자가 다시 동의해야 한다.
- 운영 스키마, 노출 스키마 설정, 이미 적용한 migration 본문.
- `.env`, `.env.local`(account-web), 인증 정보, 운영 project ref·키. 읽거나 출력하지 않는다.

## 테스트

| 명령 | 범위 |
| --- | --- |
| `npm run test:access-sql` | `Tests/Cloud/access-control.test.mjs` (PGlite, 운영 접속 없음) |
| `npm run test:connection-sql` | `Tests/Cloud/connection-diagnostics.test.mjs` |
| `npm --prefix account-web test` | 계정 웹 |
| `npm run test:swift -- --filter 'ProductAccess\|PetAccess\|PetAccount\|PetUsage\|PetError\|PetFeedback\|PetProductMetrics\|PetInsightMetrics'` | Swift 클라이언트 suite(`Tests/swift/BlabeePetTests/`) |
