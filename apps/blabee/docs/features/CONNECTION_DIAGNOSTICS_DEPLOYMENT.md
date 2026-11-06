# 연결 진단 운영 DB 적용 기록 — 2026-09-24

사용자가 검토된 마이그레이션의 운영 적용을 승인한 뒤 Supabase SQL Editor에서 한 번 실행했다. 프로젝트는 `vulnkqyqqbucvbhwjswr` (BiaDone / Blabee, main Production)다.

- 파일: `supabase/migrations/202609240001_blabee_connection_diagnostics.sql`
- SHA-256: `653c26f1cd843718647aa7b7c0f7d9f71aa8e724f4e21927df3966964d57b82e`
- 적용 전 확인: `2026-09-24T04:08:41.583019Z` (한국 13:08:41)
- 적용 후 확인: `2026-09-24T04:11:31.536911Z` (한국 13:11:31)
- SQL 실행 결과: `Success. No rows returned`
- 적용 전 신규 함수 없음, 기존 오류 컬럼 8개. 적용 후 nullable text 컬럼 4개가 추가됐다.

## 실제 운영 DB 검증

| 항목 | 결과 |
| --- | --- |
| 새 함수 본문과 검토 SQL 일치 | 통과, `pg_proc.prosrc` MD5 `032a62090eeb9eb10b6200f484255bc5` |
| 함수 소유자와 오류 테이블 소유자 일치 | 통과 |
| `SECURITY DEFINER`, 빈 `search_path` | 통과 |
| `authenticated`의 새 RPC 실행 | 허용 |
| `PUBLIC`, `anon`, `service_role`의 새 RPC 실행 | 차단 |
| 두 오류 테이블에 대한 클라이언트 SELECT/INSERT/UPDATE/DELETE | 차단 |
| 오류 테이블 RLS / 클라이언트 정책 수 | 켜짐 / 0개 |
| 새 코드·연결 컨텍스트 제약 | 2개 모두 validated |
| 연결 도구·수신 시각 부분 인덱스 | valid |
| 기존 `record_blabee_error` 정의 | 변경 없음, MD5 `b1bb53b8a418407ca524a833a1a62412` |
| 기존 `blabee-error-retention-daily` | 활성 1개, 최신 실행 `succeeded` |
| 새 연결 진단 저장 건수 | 0건 |

기존 오류 기록은 적용 전 281건, 적용 후 285건으로 관측됐다. 운영 수집이 계속되는 DB이므로 건수 불변 검증으로 해석하지 않는다. 이번 마이그레이션은 기존 이벤트를 삭제·갱신하지 않는다.

추가로 운영 DB에서 `begin read only` 트랜잭션을 사용해 `anon` 호출은 `insufficient_privilege`, 사용자 식별 없는 `authenticated` 호출은 `invalid_authorization_specification`으로 거부되는지 assertion을 실행하고 rollback했다. 결과는 성공이었다. 실제 사용자 계정을 대신하거나 테스트 사용자·가짜 진단을 저장하지 않았다.

## 운영 조회

SQL Editor의 비공개 [Blabee Codex·Claude 연결 오류 현황](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/sql/97cab667-61a1-4f00-9d0d-f7748a8b49ff)에 최근 7일 집계 SELECT를 저장했다. 상세 계정·이벤트 조회와 정리 예약 확인은 `supabase/connection-error-reports.sql`의 나머지 SELECT를 관리자 권한으로 각각 실행한다.

## 검증 범위와 다음 확인

- 격리 SQL 테스트에서 입력 제한·구 RPC 호환·중복·공통 200건 한도·계정 삭제·30일 정리를 검증했다. 운영에서는 스키마·권한·함수 일치와 인증 거부를 확인했다.
- 운영 HTTP/JWT 왕복, 여러 연결의 동시 경합, 새 앱의 실제 오류 수신까지 검증한 것은 아니다. r70 설치 후 본인 테스트 계정이 오류 진단에 동의한 상태에서 실제 진단 ID와 DB 이벤트를 대조해야 한다.
- 설치 앱은 이 작업에서 교체하지 않았고, 앱·서비스·세션을 종료하거나 진단 동의를 자동으로 변경하지 않았다.
- Supabase CLI 마이그레이션 이력 테이블은 기존 운영에 없었다. 이번 SQL Editor 적용도 CLI 이력을 생성하지 않는다. 이후 `db push` 전 실제 스키마와 이력을 정리해야 하며, 이 파일을 재실행하지 않는다.
