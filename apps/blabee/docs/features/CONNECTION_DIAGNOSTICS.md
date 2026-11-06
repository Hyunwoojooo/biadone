# Codex·Claude 연결 오류 진단

## 목적과 구현

기존 오류 수집 경로를 확장해 앱의 연결 검사·설정·실행 오류를 Supabase에서 도구·단계·원인·앱 버전별로 확인한다. 별도 웹 앱이나 제품 SDK는 추가하지 않았다. SQL 격리 검증에만 개발 의존성 `@electric-sql/pglite@0.5.8`을 사용한다.

`PetViewModel` / `PetClaudeConnectionController` → `PetConnectionDiagnostic` → 기존 `PetErrorDiagnostics` 개인 outbox → `record_blabee_connection_error` → 비공개 `blabee_analytics.error_events`.

엔진 journal·Hook·선택 권한·운영 세션은 바꾸지 않는다. 전송은 기존 비동기 작업으로 처리하며 연결 작업의 성공 여부에 영향을 주지 않는다.

## 수집되는 정보와 해석

- 도구: `codex`, `claude`.
- 단계: 설치/설정 검사, 설정 변경, 서비스 준비, Codex 실행 파일·Hook 검사, Claude 터미널 실행·응답 대기·연결 유실.
- 원인: 실행 파일 없음·경로 부적합·서명 확인 실패·지원하지 않는 버전·설정 충돌·실행 실패·응답 대기 시간 초과 등 고정 enum만 허용한다.
- 환경: 앱 버전·빌드, macOS 버전, 확인된 도구 버전. 도구 버전을 확인하지 않은 경우 `unknown`이다. Claude 버전 수집을 위해 별도 명령을 실행하지 않는다.
- 추적: 이벤트 UUID, 발생·서버 수신 시각, JWT의 `auth.uid()`. 본문으로 사용자 ID를 받지 않는다.

대화·프롬프트·명령·코드·프로젝트/세션 ID·파일 경로·로그/오류 메시지 원문·토큰은 전송하지 않는다. 기존 오류 전송은 그대로 유지한다. 도구 종류가 없는 과거 공통 오류를 추정해서 Codex나 Claude로 분류하지 않는다.

`inspection`의 실행 파일 없음은 설치 준비 상태일 수 있다. `handshake_timeout`은 사용자 로그인·프로젝트 신뢰·채널 허용을 기다리는 경우도 포함한다. 이 관측만으로 앱 장애를 확정하거나 전체 오류율을 계산하지 않는다. 일반 Claude 터미널 세션의 모든 내부 예외나 앱 전체 크래시 스택을 수집하는 기능은 아니다.

## 동의·안정성

- 기본 꺼짐, 로그인과 별도 오류 진단 동의가 필요하다. 최초 로그인 전 오류는 수집하지 않는다.
- 첫 실행에서 계정에 연결된 동의 기록을 저장한 직후부터 수집한다. 연결 설정 완료까지 기다리지 않는다. 동의 저장 실패·계정 변경·동의 철회·사용자 취소에는 기존 컨텍스트의 오류를 보내지 않는다.
- 같은 코드/도구/단계/원인/버전은 60초 동안 중복 억제한다. 클라이언트 시간당 50건, outbox 최대 256건·7일이다.
- 서버 한도는 기존 일반 오류와 합쳐 계정당 UTC 수신일 200건이다. 같은 이벤트 재시도는 추가 건수로 기록하지 않는다.
- 기존 30일 보관 정리·계정 삭제 cascade를 재사용한다. 네트워크 전송 오류 자체를 다시 진단 이벤트로 만들지 않는다.
- 설정 → 일반 → 오류 진단에서 전송 대기 건수, 최근 응답 시각, 문의용 진단 ID를 확인한다. 응답 확인은 중복/서버 한도에 의한 종료도 포함하므로 별도 저장 확정 표시가 아니다. 이 상태는 앱 실행 동안의 상태이며 계정 변경·동의 철회 시 지워진다.

## DB 적용과 운영 조회

1. `supabase/migrations/202609240001_blabee_connection_diagnostics.sql`은 **2026-09-24 운영 DB에 적용 완료**했다. 신규 환경에서는 기존 오류 마이그레이션 이후 한 번만 적용한다. 운영에 기존 0001/0002나 이번 파일을 다시 실행하지 않는다. 오류 테이블에 nullable 컬럼 4개, 제약과 부분 인덱스, 새 인증 RPC를 추가하며 기존 RPC·데이터·정리 예약은 유지한다.
2. `error_events` RLS, 클라이언트 직접 읽기/쓰기 금지, `anon`/`service_role`의 새 RPC 실행 금지, `authenticated`의 기록 RPC 실행만 허용되는지 확인한다. 신규 RPC는 빈 `search_path`를 사용한다.
3. `supabase/connection-error-reports.sql`의 SELECT를 관리자 SQL Editor에서 각각 실행한다. 첫 쿼리는 최근 7일 도구/단계/원인별 집계, 두 번째는 계정별 최근 내역, 세 번째는 정리 작업의 최신 실행 결과다.
4. 본인 테스트 계정은 두 번째 조회의 `errors.user_id`로 필터링한다. 문의는 앱이 표시한 `errors.event_id`로 찾는다. 이메일은 관리자 조회에서만 Auth와 결합한다.
5. DB 적용 후 새 앱을 빌드·배포하고, 본인 테스트 계정에서 오류 진단을 켜 실제 연결 실패 1건의 ID와 DB 수신을 대조한다. 고객 오류를 인위적으로 유발하거나 사용자 동의를 자동으로 켜지 않는다.

운영 DB는 기존 SQL Editor 적용 이력이 있고 CLI migration history가 없다. 따라서 무조건 `supabase db push`를 실행하지 않는다. 이력 정리는 별도 작업이며, 이번 새 migration의 적용 시각·파일 해시·실제 스키마 검증 결과를 남긴다.

## 검증 상태 — 2026-09-24

- 관련 Swift 테스트 **161개 / 16 suites 통과**. Codex 재검사 실제 ViewModel 경로, Claude 검사·실행 실패·응답 대기, 초기 동의 시점, 계정/동의 취소, 구 outbox 호환, 전송 payload allowlist, 기존 연결·온보딩 회귀를 포함한다.
- `npm run test:connection-sql` 통과. 기존 오류 SQL 검증 및 원본 관리자 보고서 assertion, 신규 RPC 인증·입력 제한·중복·공통 200건 한도·계정 삭제·30일 정리·조회 SQL을 격리 PGlite에서 실행했다. 실제 다중 연결 경합 시험·운영 HTTP/JWT 왕복·Cron 실행을 대체하지 않는다.
- 테스트 로그: `/private/tmp/blabee-connection-diagnostics-swift-final.log`.
- 사용자 승인 후 운영 DB에 신규 migration을 적용했다. 신규 함수 본문이 검토한 SQL과 일치하고, nullable text 컬럼 4개·제약 2개·인덱스·RLS·클라이언트 직접 접근 차단·인증 사용자 전용 RPC 권한을 실제 DB에서 확인했다. 기존 RPC 정의도 동일하며 정리 작업 1개가 활성이고 최신 실행은 `succeeded`다.
- 운영 DB의 읽기 전용 트랜잭션에서 익명 역할과 사용자 식별 없는 인증 역할의 호출이 거부됨을 확인했다. 테스트 계정이나 가짜 진단을 운영 DB에 저장하지 않았다. [적용 기록](CONNECTION_DIAGNOSTICS_DEPLOYMENT.md)에 시각·해시·권한 검증 결과를 남겼다.
- r70 내부 테스트 앱·DMG를 Swift Release로 빌드하고 Developer ID 서명·체크섬·번들 소스·새 진단 전송 경로를 검증했다. 산출물과 상세 결과는 `build/local-connection-diagnostics-20260924-r70/VERIFICATION.md`에 있다. Apple 공증·공개 배포는 수행하지 않았다.
- 운영 확인 시 새 연결 진단은 0건이다. r70 설치 후 앱에서 로그인·오류 진단 동의를 거친 실제 전송과 DB 수신 대조는 아직 수행하지 않았다. 기존 설치 앱·세션·사용자 수집 설정을 변경하지 않았다.

근거: [Supabase Functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Cron](https://supabase.com/docs/guides/cron).
