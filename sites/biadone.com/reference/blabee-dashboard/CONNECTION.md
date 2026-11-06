# Blabee 대시보드 실제 연결 기록

2026-10-17 UTC 확인. **운영 Supabase 연결과 사용자 승인에 따른 Cloudflare 운영 배포를 완료했다.** 실제 소유자의 Google 로그인·집계 조회는 로컬에서 확인했으며, 운영 도메인의 provider 복귀와 실제 소유자 조회·쓰기는 아직 직접 검증하지 않았다.

- 운영 진입 링크: <https://biadone.com/blabee/관리자>
- 운영 관리자 화면: <https://biadone.com/blabee/admin/>
- 별도 샘플 화면: <https://biadone.com/blabee/admin/?demo=1>
- 로컬 실제 연결 확인 주소: <http://127.0.0.1:8814/>
- Supabase 프로젝트: `vulnkqyqqbucvbhwjswr`
- API 원천: `https://vulnkqyqqbucvbhwjswr.supabase.co`
- 구현: [소스·운영 문서](../../tools/blabee-dashboard/README.md)

## 적용 범위

기존 `blabee_marketing.landing_daily_views`와 `beta_requests`의 구조를 먼저 확인했다. 전달받은 UTM 커밋 `92dd6b1`·`97fa6a5`와 SQL 계약이 일치했다. 기존 수집 마이그레이션은 재실행하지 않았다.

| 대시보드 전용 마이그레이션 | 운영 식별자 |
|---|---|
| `001_dashboard.sql` | `20261017120311_blabee_dashboard_owner_api_v1` |
| `002_enroll_owner.sql` | `20261017120319_blabee_dashboard_enroll_owner_v1` |

`001`은 최초 적용용이므로 이 프로젝트에 다시 실행하지 않는다. 비공개 대시보드 스키마·권한·집계와 게시물 RPC만 추가했다. `002`는 사용자가 직접 Google 로그인한 후 이메일 확인을 마친 지정 계정 하나를 등록했다. SQL이 Auth 계정을 만들거나 기존 Auth 사용자를 변경하지 않았다.

API 설정의 관리자 UID와 DB 허용 목록은 동일한 계정을 가리킨다. 공개 설정 API에는 관리자 이메일·UID가 포함되지 않는다. 배포 설정에는 기존 랜딩의 의도된 공개 publishable key를 사용하며 service-role·secret key는 없다. 저장된 MCP 설정의 프로젝트 한정 읽기 전용 구성은 유지했고, 별도 적용 프로세스만 프로젝트 한정 SQL 적용 권한과 정상 승인 검토를 사용했다.

## 기존 수집 기능 보존

적용 전후 다음 함수 정의의 MD5가 모두 일치했다. 함수 ACL과 원천 스키마 메타데이터도 동일했다. 정상 유입은 계속될 수 있으므로 적용 전후 총건수의 같음을 보존 근거로 사용하지 않았다.

| 함수 | 적용 전후 동일한 정의 해시 |
|---|---|
| `public.record_blabee_landing_view(jsonb)` | `0fb8e8838c8a47459601d6b5975ade74` |
| `public.request_blabee_beta(text)` | `4c2b5b14884c060f851977dc71ef7fe6` |
| `public.request_blabee_beta_tracked(text,jsonb)` | `d04d49079efb1c39509c08c467b80927` |
| `blabee_marketing.normalize_attribution(jsonb)` | `dfcd6fb64d9ac75679d284eef6882887` |

테스트 방문·신청·게시물은 운영 DB에 삽입하지 않았다. 원본 신청 이메일을 내보내지 않았고 대시보드의 `posts`·`source_bounds`는 처음 연결 시 모두 비어 있다.

## 권한과 집계 대조

[000_preflight.sql](../../tools/blabee-dashboard/database/000_preflight.sql)과 [003_verify_connection.sql](../../tools/blabee-dashboard/database/003_verify_connection.sql)을 준비했다. 후자는 같은 repeatable-read, read-only 트랜잭션에서 DB 권한·집계를 확인한 뒤 롤백한다.

- 세 대시보드 테이블: RLS 활성화. `anon`·`authenticated`·`service_role`에 스키마 사용·직접 테이블·컬럼 접근 권한 없음.
- 두 공개 RPC: `SECURITY DEFINER`, 빈 `search_path`, `authenticated` 실행만 허용하며 함수 안에서 등록 UID를 다시 검사.
- 등록된 지정 관리자: 정확히 한 명. 검증된 수집 경계와 게시물 기록: 각각 0건.
- 최근 7 UTC 날짜 `[2026-10-11, 2026-10-18)`의 원본/RPC 관측수: 조회 **1=1**, 신규 신청 **1=1**.
- `authenticated` SQL 역할에서 집계 7일·게시물 0개 읽기 성공. 이 SQL의 트랜잭션 한정 claim은 외부 JWT 검증 근거로 사용하지 않는다.

별도의 최근 30일 `[2026-09-18, 2026-10-18)` 원천 읽기 스냅샷은 Reddit 조회 1회와 신규 신청 3건이었다. 신청 3건은 모두 `unmeasured`였다. 해당 수치는 이 문서의 확인 시점 값이며 이후 정상 유입에 따라 달라질 수 있다. 일별 카운터는 페이지 조회이며 사람·세션·고유 방문자 전환율이 아니다.

## 실제 관리자 JWT와 HTTP 확인

MCP 연결 OAuth와 대시보드 Google 로그인을 별도로 완료했다. 사용자가 지정 계정으로 로컬 대시보드에 로그인했고, 이후 해당 소유자 UID의 실제 Supabase 요청 로그를 경로·상태·건수로만 집계했다. 요청 헤더·토큰·IP·User-Agent·전체 URL은 추출하지 않았다.

2026-10-17 12:04:50 UTC에 다음 요청이 모두 **200**이었다.

| 경로 | 확인 범위 |
|---|---|
| `/auth/v1/user` | 전달된 실제 사용자 JWT의 Supabase Auth 검증 |
| `/rest/v1/rpc/blabee_dashboard_overview` | 등록 소유자의 실제 집계 읽기 |
| `/rest/v1/rpc/blabee_dashboard_posts` | 등록 소유자의 실제 게시물 목록 읽기 |

두 RPC는 각각 성공 요청 4건을 확인했다. 설치 전의 404 기록은 12:02:16 UTC이며 설치 이후 성공과 구분했다.

실제 익명 요청도 확인했다.

- 로컬 `GET /api/admin/overview`·`GET /api/admin/posts`: **401**, `private, no-store`.
- 공개용 키만 전달한 Supabase 집계 RPC: **401**, 코드 `42501`, 일별 데이터 없음.

Node·격리 SQL·실제 Pages 핸들러 왕복 검사 **63/63**을 다시 통과했다. 새 설정과 점검 SQL 보안 검토도 통과했다. 앞서 모의 API로 검증한 브라우저 6개 시나리오·반응형 결과는 별도 UI 근거다. 실제 관리자 계정의 게시물 쓰기·삭제는 운영 데이터에 테스트 기록을 남기지 않기 위해 실행하지 않았으며 격리 SQL/API 검사에서 검증했다.

## 데이터 표시의 한계

수집 완전성을 확인한 `source_bounds`를 임의로 만들지 않았다. 과거·누락 구간은 0으로 채우지 않고 부분 합계·미수집으로 남긴다. 조회 원천은 기본·호환 Blabee 랜딩을 함께 집계하며 경로 차원이 없으므로 화면의 `Blabee 랜딩 합산` 범위를 유지한다. 과거 신청 유입은 복원하지 않는다.

## 운영 배포와 검증

사용자 요청에 따라 기존 Pages `biadone` 프로젝트의 `https://biadone.com/blabee/admin/`에 통합한다. 요청한 형태의 `https://biadone.com/blabee/관리자` 진입 링크도 추가했다. 한글 경로는 정식 관리자 주소로 302 이동한다. 기존 홍보용 리디렉션 아홉 개 뒤에 관리자 별칭 두 개만 추가했다.

사이트 배포 스크립트는 허용한 기존 사이트와 관리자 자산을 함께 임시 `public/`에 넣는다. 서버·설정·Functions는 공개 디렉터리 밖이다. `_routes.json`은 `/blabee/admin`과 `/blabee/admin/*`만 포함하며, 관리자 middleware가 겹치는 랜딩 CSP를 하나의 관리자 정책으로 교체한다. 모르는 관리자 자산·API는 404다.

검토한 준비 패키지와 최종 패키지의 60개 파일 크기·SHA-256을 각각 `/private/tmp/blabee-admin-subpath-manifest.json`과 `/private/tmp/blabee-admin-live-package.json`에 기록했다. 공개 파일은 48개이며 관리자 자산은 그중 허용한 9개다. 공개 파일에 설정·SQL·테스트·내부 문서·실제 데이터 내보내기가 없는지 확인했다. 배포 후 보완한 파일은 비공개 `dashboard-server/http.mjs`와 `dashboard-route.mjs`뿐이고 공개 자산은 같았다. 프로젝트 이름은 `biadone`, API 설정은 확인된 소유자 UID와 기존 공개용 Supabase 키다.

하위 경로 변경 후 Node·SQL·패키지 검사 **86/86**, 기존 브라우저 **6개**와 하위 경로 브라우저 **4개**를 통과했다. 통합 패키지를 Wrangler 4.151.1로 실제 컴파일하고 로컬 Cloudflare에서 다음을 확인했다.

- 관리자 HTML·CSS 200, 단일 CSP, Supabase Auth 연결 origin 허용.
- 익명 관리자 API 401, 알 수 없는 API·SQL 경로 404.
- 한글 관리자 링크 302, 슬래시 없는 관리자 경로 308 및 쿼리 보존.
- 기존 네 플랫폼 짧은 링크 302와 메인 페이지 200.
- 브라우저의 상대 자산·API base·모바일, 실제 페이지 이탈과 뒤로 이동 시 이전 데이터 제거, PKCE verifier 보존.
- BFCache persisted-pageshow 이벤트와 Google OAuth 목적지는 모의 검증했다. 실제 provider 호출·신청·조회수 삽입은 없었다. 이미지와 결과는 `/tmp/blabee-dashboard-subpath-qa/`에 있다.

같은 origin의 경로는 별도 origin처럼 격리되지 않는다. 메인 페이지의 외부 CDN 코드도 해당 origin의 신뢰 범위에 들어간다. 이를 완화하기 위해 하위 경로 문서의 이탈·새로고침·BFCache 복귀 시 토큰·집계·게시물·폼을 정리한다. 따라서 하위 경로에서는 새로고침 후 재로그인이 필요하다. PKCE verifier는 Google 로그인 복귀를 위해 유지한다. 이 조치가 완전한 origin 격리를 제공하는 것은 아니다.

로컬 루트 OAuth 콜백은 실제 로그인으로 검증했다. 운영 콜백 `https://biadone.com/blabee/admin/?auth_return=1`은 사용자가 Supabase Redirect URLs에 추가 완료했다고 확인했다. 운영 provider 복귀는 아직 직접 검증하지 않았으며, 최종 Cloudflare 헤더와 브라우저의 정확한 OAuth 목적지는 확인했다.

사용자의 `운영 배포해` 승인으로 기존 Pages 프로젝트에 업로드했다. Cloudflare 프로젝트 생성·DNS 변경·추가 DB 마이그레이션·커밋·푸시는 수행하지 않았다.

초기 대시보드 완료 배포는 `27571b16-03fb-4b82-8809-5afb4ba18fe5`, <https://27571b16.biadone.pages.dev>이다. Cloudflare API에서 `production`, 배포 단계 `success`, 완료 시각 **2026-10-17 12:39:35 UTC**를 확인했다. 이 작업 전 운영 배포는 `9042855d-ec36-4253-b0a6-ad5cce8292e4`였다. 이후 관리자 두 계정 추가 배포는 아래에 별도로 기록한다.

운영에서 발견한 두 문제를 보완했다.

1. Zone Web Analytics가 관리자 HTML에 외부 beacon을 자동 삽입해 CSP 오류가 발생했다. 관리자 정적 응답만 `Cache-Control: no-store, no-transform`으로 설정했고 실제 운영 브라우저에서 삽입과 CSP 오류가 사라졌다. Cloudflare의 외부 설정은 변경하지 않았다.
2. workerd가 지원하지 않는 `redirect: error` 때문에 Supabase 요청 전 TypeError가 발생해 인증을 503으로 표시했다. 격리된 실제 workerd에서 `error → TypeError`, `manual → Supabase 403 bad_jwt`를 대조했다. 서버는 `manual`로 바꾸고 모든 3xx를 거부해 인증 헤더가 다른 주소로 전달되지 않게 했다. 알려진 잘못된 JWT는 401이며 원천 본문을 반환하지 않는다.

최종 검증 범위:

- Node·격리 SQL·실제 Pages 핸들러·통합 패키지 **91/91 통과**. Auth·데이터 리디렉션 거부와 실제 관측한 `403 bad_jwt`를 포함한다.
- 운영 도메인 브라우저 **4개 시나리오 통과**. 실제 문서·자산·CSP를 사용하고 관리자 API와 OAuth만 모의 처리했다. 런타임·CSP 오류, 외부 QA 요청이 없었다.
- 별도 운영 브라우저에서 실제 설정 API 200, 로그인 창·Google 버튼, 실제 익명 API 두 개 401을 확인했다. 수치는 대시로 표시돼 비공개 데이터가 보이지 않았다.
- 공개 자산 45개 대조: 40개 바이트 일치, HTML 5개는 Cloudflare 이메일 보호 변환만 되돌리면 일치. 해당 변환 이외의 차이는 없었다.
- 한글 관리자 별칭·정식 경로 리디렉션 4개와 기존 플랫폼 짧은 링크 8개가 정상이다. 운영 자산과 리디렉션 대조 기록은 `/private/tmp/blabee-admin-live-integrity-normalized.json`에 있다.
- apex·www·프로젝트 `pages.dev`·배포별 `pages.dev`에서 단일 CSP·noindex·no-referrer, 익명 차단, 미지원 관리자·SQL·설정 경로 404를 확인했다. 공개 config는 URL·공개용 키·configured만 반환한다.
- 최종 배포의 네 호스트에서 HTML과 가짜 JWT의 두 API를 좁게 재검증해 **12/12 통과**했다. 가짜 JWT 요청 8건 모두 `401 UNAUTHORIZED`, `auth_uncertain` 없음, `private, no-store`였으며 기존 503은 해결됐다.

운영 이미지·브라우저 결과는 `/private/tmp/blabee-dashboard-production-qa/`, 전체 테스트 기록은 `/private/tmp/blabee-dashboard-final-tests.tap`에 있다. 실제 운영 소유자 Google 로그인·집계 읽기·게시물 저장·로그아웃 왕복은 남은 사용자 확인 범위다. 테스트 신청·조회수·게시물을 운영 DB에 만들지 않았다.

## 관리자 두 계정 추가 — 2026-10-17

사용자가 두 이메일을 관리자에 추가해 달라고 요청했다. 운영 `auth.users`를 읽어 두 계정 모두 기존의 이메일 확인이 완료된 계정임을 확인했다. 기존 계정을 포함한 현재 허용 목록은 다음과 같다.

| Google 로그인 이메일 | 확인한 Auth UID |
|---|---|
| `biadone.official@gmail.com` | `b0723835-2e5f-488c-b12e-dc50bf1cdc66` |
| `hyunwoojoo.33@gmail.com` | `338752c1-9293-47eb-ab45-b9832348860f` |
| `hn7742@gmail.com` | `642f7cfe-003e-4d63-9bfa-c25056b1325a` |

[004_enroll_additional_admins.sql](../../tools/blabee-dashboard/database/004_enroll_additional_admins.sql)을 `20261017125044_blabee_dashboard_additional_admins_v1`로 한 번 적용했다. 검토한 파일의 SHA-256은 `04f576092b1fd49c2c86bddd02b8c707ceed4c1925286c0e167cdfd424a87647`이다. 정확한 이메일 한 건·이메일 확인·예상 UID를 모두 검사한 뒤 두 UID만 멱등 추가한다. Auth 계정 생성·기존 관리자 삭제·기존 마이그레이션 재실행은 없었다. 저장된 MCP 연결은 계속 읽기 전용이며, 기존에 인증한 프로젝트 한정 쓰기 연결을 별도 적용 프로세스에서만 사용했다. 앞선 다른 연결 주소 시도 두 개는 인증 단계에서 끝났으며 DB를 변경하지 않았다.

API는 `DASHBOARD_OWNER_UIDS`의 명시적인 세 UID만 허용한다. 복수 설정이 존재하면 기존 단일 UID·이메일보다 우선하며, 목록이 비었거나 항목 하나라도 잘못되면 연결을 거부한다. 공개 설정에는 계정 이메일·UID 목록을 포함하지 않는다. DB의 독립 UID 검사도 유지한다.

관리자 추가 완료 배포는 **`ce7316b9-e992-4ec9-9135-2d17e86b85d3`**, <https://ce7316b9.biadone.pages.dev>이며 **2026-10-17 12:51:45 UTC**에 성공했다. Cloudflare 배포 메타데이터의 허용 목록이 요청한 세 UID와 정확히 같고 기존 UID가 유지됨을 확인했다. 이전 패키지와 비교해 변경된 배포 파일은 비공개 `dashboard-server/auth.mjs`와 `wrangler.jsonc` 두 개뿐이며, 공개 자산은 모두 동일하다. 패키지 60개 파일의 기록은 `/private/tmp/blabee-admin-addition-package.json`에 있다. 이후 로그인 화면 변경 배포는 아래에 별도로 기록한다.

검증:

- 전체 Node·격리 SQL·API·패키지 검사 **99/99 통과**, 기록 `/private/tmp/blabee-dashboard-admin-addition-tests.tap`.
- 세 UID 각각의 집계 조회·게시물 읽기/쓰기 허용, 외부 UID 거부, 잘못된 설정 차단을 모의 Auth/API와 격리 SQL에서 확인했다.
- 등록 SQL은 두 계정 각각의 누락·이메일 미확인·UID 불일치·대소문자 중복 8개 실패 조합에서 기존 허용 목록을 완전히 보존했다. 정상 재실행도 멱등이다.
- 운영 DB를 다시 읽어 허용 목록이 정확히 세 명이며 모두 확인된 요청 계정임을 확인했다. 기존 수집·대시보드 함수 일곱 개의 정의가 같고, 직접 테이블 접근 차단과 RPC 역할 권한도 유지됐다.
- 최신 배포의 apex·www·프로젝트 `pages.dev`·배포별 `pages.dev`에서 **24개 GET 검사 통과**. 공개 config는 `configured:true`와 Supabase URL·공개 키만 제공하며, 익명·가짜 JWT의 두 API는 모두 401이다. HTML의 단일 CSP·`no-store, no-transform`과 API의 `private, no-store`도 유지됐다.
- 운영 읽기 전용 MCP의 `SET ROLE authenticated` 재현은 연결 역할의 권한 부족으로 거부됐다. 이를 세 계정의 운영 SQL 역할 실행 성공으로 기록하지 않는다. 역할별 RPC 허용/거부는 격리 DB에서 검증했다.
- 두 신규 계정의 실제 Google 로그인·JWT를 사용하는 운영 조회/쓰기는 직접 실행하지 않았다. 운영에 테스트 방문·신청·게시물을 만들지 않았다.

## 로그인 화면 분리 — 2026-10-17

사용자가 관리자 주소에서 로그인 화면만 먼저 표시하고 인증 후 메인 화면을 보여 달라고 요청했다. `public/index.html`, `styles.css`, `app.mjs`를 변경했다. 기존 헤더·메뉴·수치·차트·표·private dialog를 `#dashboard-screen`에 넣고 최초 HTML부터 `hidden`과 `inert`로 숨긴다. 로그인 화면은 독립된 `#login-screen`으로 표시한다.

Google/GitHub PKCE 복귀 후 집계·게시물 API가 모두 성공하고 토큰이 여전히 유효할 때만 메인을 연다. 초기 설정·토큰 교환·관리자 권한 확인 중에도 메인은 숨겨져 있다. 로그아웃·401·403·만료·페이지 이탈·BFCache 복귀에는 기간 선택창을 포함한 모든 모달, 수치, 필터, 폼을 정리하고 로그인으로 돌아간다. 늦은 응답은 화면을 다시 열지 못한다. 연결 오류는 로그인 화면에서 재시도할 수 있고, JavaScript 차단 시에는 안내와 비활성 로그인 버튼을 표시한다. 로그인 화면의 샘플 진입 버튼은 제거했으며 명시적 `?demo=1` 합성 데이터 모드는 보존했다.

로그인 화면 분리 완료 배포는 **`3856591f-252d-40ca-b7da-4a498d9da4af`**, <https://3856591f.biadone.pages.dev>이며 **2026-10-17 13:02:37 UTC**에 성공했다. 검토 패키지 60개 파일은 `/private/tmp/blabee-login-gate-package.json`에 기록했다. 이전 패키지와 비교해 관리자 정적 자산 3개만 달라졌으며 서버·설정·공개 랜딩·UTM은 동일하다. Cloudflare 메타데이터에서 세 관리자 UID가 유지됨을 확인했다. DB·Auth 설정·OAuth 허용 URL은 변경하지 않았다.

검증:

- Node 단위·라우팅·패키지 검사 **88/88 통과**. 이번에는 DB SQL을 변경하거나 운영 DB에 쓰지 않았다.
- 로컬 Chromium의 새 로그인 게이트 **9개**, 기존 회귀 **6개**, 하위 경로 **4개**로 총 **19개 시나리오 통과**. JS 차단, 느린 설정, PKCE 콜백, 두 API 대기, 로그인 후 메인, 로그아웃, 401/403, 만료, 재시도, 뒤로 이동, 필터·게시물 기능을 확인했다.
- 실제 운영 주소에서 새 로그인 게이트 **9개 시나리오 통과**. 실제 배포 문서·자산·CSP를 사용하고 OAuth·관리자 API만 모의 처리했다. 실제 Google 계정 로그인 성공 근거로 사용하지 않는다.
- 별도 운영 브라우저에서 실제 config 200과 활성 로그인 버튼, 대시보드·네비게이션·수치 숨김, 실제 익명 API 두 개 401을 확인했다. 1440×1000·390×844에서 가로 넘침과 런타임·CSP 오류가 없고 자동 beacon도 삽입되지 않았다.
- 로그인 화면과 인증된 메인 화면의 데스크톱·모바일 캡처를 직접 확인했다. Browser 플러그인/skill이 제공되지 않아 기존 Playwright 1.55.0과 설치된 Chromium을 사용했다. 외부 QA 요청·운영 테스트 방문·신청·게시물 쓰기는 없었다.

단위 기록은 `/private/tmp/blabee-login-gate-unit.tap`, 로컬 결과는 `/private/tmp/blabee-login-gate-local/`, `blabee-login-gate-subpath/`, `blabee-login-gate-regression/`에 있다. 운영 결과·이미지는 `/private/tmp/blabee-login-gate-production/`의 `results.json`, `real-login.json`, `real-login-desktop.png`, `real-login-mobile.png`다. 실제 Google provider의 사람 로그인은 이번 검증에서 실행하지 않았다.

## 로그인 화면 최소화 — 2026-10-17

추가 요청에 따라 기본 로그인 화면의 보이는 내용은 `Blabee` 제목과 `Google로 로그인` 버튼 두 개뿐이다. 로고 도형·카드 테두리·설명·GitHub 버튼·별도 재시도 버튼을 제거했다. 실제 오류나 JavaScript 차단일 때만 필요한 안내를 보이며, 연결 실패의 재시도는 같은 Google 버튼을 사용한다. 일반 로그아웃·복귀 안내도 기본 화면에 남기지 않는다.

최신 운영 배포는 **`e02a1eae-f825-465d-aac1-252431261935`**, <https://e02a1eae.biadone.pages.dev>, **2026-10-17 13:13:53 UTC** 성공이다. 60개 파일 패키지 비교에서 관리자 HTML·CSS·app 세 파일만 변경됐고, 서버·설정·공개 랜딩은 동일했다. 패키지 기록은 `/private/tmp/blabee-minimal-login-package.json`이다.

로컬 로그인 게이트 9개와 회귀 6개로 **15개 검사 통과**, 운영 게이트 **9개 검사 통과**. 정상·준비 중·로그아웃 후 화면에서 두 요소만 보이는지, GitHub/재시도 버튼이 없는지, Google PKCE·오류 재시도·권한 거부·만료 동작을 확인했다. OAuth·관리자 API는 모의 처리했다. 별도 운영 브라우저는 실제 config 200·익명 API 두 개 401과 두 요소만 표시되는 1440×1000·390×844 화면을 확인했다. 런타임·CSP 오류, 외부 QA 요청과 운영 데이터 쓰기는 없다.

결과와 캡처는 `/private/tmp/blabee-minimal-login-local/`, `blabee-minimal-login-regression/`, `blabee-minimal-login-production/`에 있다. 실제 Google 사용자 로그인은 이번 검증에서 수행하지 않았다. DB·Auth provider 설정은 변경하지 않았다.

## 접속 분석 개편 — 2026-10-17

사용자 요청에 따라 게시물 목록·등록 폼·게시 시점 표시·관련 UI 요청과 `홍보 성과` 제목·설명·녹색 안내를 제거했다. 기존 게시물 DB와 서버 계약은 삭제하지 않았다. 기본 로그인은 `Blabee`와 `Google로 로그인`만 유지한다.

추가한 항목은 정확한 `biadone.com/blabee`와 `biadone.com/blabee/`의 페이지 조회수·Visits·동일 경과 기간 대비 변화·시간 추이·시간대 합계·국가·브라우저·운영체제다. 국가의 `T1`·알 수 없음도 보존한다. UTC 오늘·7일·30일·직접 선택을 제공한다. 시간 격자의 관측되지 않은 구간은 null로 남기고 그래프 선을 연결하지 않는다. 샘플링·조회 한도·부분 집계·원천 오류·명시적으로 측정된 0을 구분한다.

Supabase의 `유입 경로·베타 신청` 표는 기본·호환 랜딩 합산이라는 원래 범위를 표시하고 날짜·채널별 기록된 조회수와 최초 이메일 신청을 보여 준다. 채널·캠페인 필터는 이 표에만 적용한다. Cloudflare 지표와 합치거나 고유 방문자 전환율을 만들지 않는다.

### 원천 검증과 접근 경계

실제 Cloudflare MCP GraphQL 읽기로 `httpRequestsAdaptiveGroups`를 검증했다. 고정 host·정확한 두 경로·GET·eyeball·HTML·2xx 필터를 적용한다. 관리자·에셋·정책·회사 메인 요청은 제외한다. `2026-10-10T00:00:00Z`부터 `2026-10-17T13:35:00Z`까지 조회 186회, Visits 158회, 시간별 61행·국가 21개·브라우저 12개·OS 6개를 확인했다. 각 세부 조회수 합계도 186이었다. 이 수치는 확인 당시 원천 증거이며 운영 화면에 고정하지 않았다. 봇·Headless·Curl을 포함하고 사람 수를 의미하지 않는다.

원천 설정은 조회 최대 30일·보존 31일이었다. 서버는 매번 실제 설정을 읽고 범위를 검사하며, 지원하지 않는 이전 비교 구간은 제외한다. 공개 랜딩의 CSP·UTM 수집·신청 함수는 변경하지 않았다. 비어 있던 RUM 데이터를 이 집계 대신 사용하지 않는다.

새 비공개 `api/admin/analytics`는 실제 Supabase JWT·서버의 세 관리자 UID·기존 DB allowlist를 모두 검사한 뒤 Cloudflare에 접근한다. 임의 GraphQL·host·path 입력을 받지 않는다. 원천 요청은 고정 URL, `redirect: manual`, 3xx 거부, timeout을 사용한다. 로그인 게이트는 기존 overview 성공을 필수로 하며 Cloudflare만 실패하면 허용된 Supabase 데이터는 유지한다. 만료·권한 거부·늦은 응답·로그아웃은 기존의 전체 비공개 데이터 정리 규칙을 적용한다.

사용자가 Production에 `CF_ANALYTICS_API_TOKEN` Secret을 저장했다. Cloudflare 메타데이터에서 최신 배포와 Production 설정 모두 `secret_text`임을 확인했다. 값·길이·식별자를 조회하거나 복사하지 않았다. MCP 자체 조회 성공은 이 별도 런타임 토큰의 성공 근거가 아니다.

### 배포와 검증

접속 분석 UI/API 배포는 **`37171ad4-368d-4961-be4c-b2273ab0f9a4`**, <https://37171ad4.biadone.pages.dev>, **2026-10-17 13:56:54 UTC** 성공이다. 이후 토큰 형식·활성 상태·실패 단계를 구분한 서버 진단 배포는 **`511580d9-0821-417b-976c-6b767bc55994`**, <https://511580d9.biadone.pages.dev>, **14:07:37 UTC** 성공이다. 두 번째 배포에서 공개 자산은 모두 동일했고 비공개 `dashboard-server/analytics.mjs`만 달라졌다.

패키지는 62개 파일이며 공개 파일 48개 중 관리자 자산은 기존과 같은 9개다. 다른 공개 랜딩·UTM 파일은 이전 로그인 배포와 바이트가 같다. 기존 공개 정책 Markdown 두 개 외에는 SQL·테스트·내부 문서·실제 데이터 내보내기·토큰을 공개하지 않는다. 기록은 `/private/tmp/blabee-analytics-package.json`, `blabee-analytics-diagnostics-package.json`이다. Wrangler 4.151.1 Functions 실제 컴파일을 통과했다.

- 진단 배포 기준 Node·격리 PGlite·API·패키지 **124/124 통과**. `/private/tmp/blabee-analytics-diagnostics-tests.tap`.
- 실제 원천 응답을 서버 정규화와 클라이언트 검증에 통과시켜 186·158과 세부 합계가 유지됨을 확인했다. 개인별 요청 원문·IP·전체 UA를 수집하지 않았다.
- 로컬 브라우저 회귀 11개·로그인 게이트 10개·하위 경로 4개로 **25개 시나리오 통과**. 실제 운영 문서·자산·CSP의 회귀 11개·로그인 게이트 10개로 **21개 통과**. Google·관리자 API는 모의 처리한 UI 근거다. 날짜 변경, 표 필터 범위, 0·누락·부분 집계, XSS, CSP, 권한 거부, 오래된 인증 응답, 로그아웃 후 응답, PKCE, BFCache를 확인했다.
- 데스크톱·랩톱·태블릿·모바일 캡처를 확인했다. 가로 넘침·런타임·CSP 오류가 없었다. 결과는 `/private/tmp/blabee-analytics-local-final/`, `blabee-analytics-production/`, `blabee-analytics-production-login/` 등에 있다. 캡처의 샘플 숫자는 명시적 합성 데이터 모드이며 실제 유입 값으로 사용하지 않는다.
- 실제 로컬 workerd와 운영 HTTP 각각 **25개 통과**. 진단 배포 운영에서도 25개를 다시 확인했다. HTML·8개 자산 대조, 로그인 숨김, 단일 CSP·noindex·no-store·no-transform, config 200, 세 익명 API 401, 비공개 파일·모르는 API 404, 관리자 별칭·짧은 홍보 링크를 검사했다. 홍보 링크는 HEAD 302만 확인하고 랜딩 HTML을 따라가지 않았다. 기록은 `/private/tmp/blabee-analytics-http-production-diagnostics.json`이다.

### 실제 로그인 후 남은 원인

사용자가 운영 로그인 뒤 Cloudflare 조회 오류를 보고했다. 이어 CUA로 사용자의 기존 Chrome 관리자 탭을 직접 읽어 인증된 메인·실제 Supabase 신청 데이터·같은 오류를 확인했다. 새 진단의 결과는 **연결 설정 조회 단계의 `provider_access_unverified`**다. 계정 토큰 verify와 사용자 토큰 verify 모두 활성 상태 확인에 실패했다는 뜻이며, 토큰이 무효라고 확정하는 근거는 아니다.

같은 Chrome의 기존 Cloudflare 계정 토큰 화면을 읽기 전용으로 확인했다. 표시된 토큰은 Active이며 Account Analytics Read와 Zone Analytics Read를 포함하고, 현재 계정 전체와 그 계정의 모든 Zone 범위다. 사용자는 IP 필터를 넣지 않았다고 확인했고 설정 화면도 빈 필터였다. 설정은 저장·변경하지 않았다. 토큰 값은 읽지 않았다. HTTP 상태·숫자 오류 코드가 아직 일반 안내에 가려져 있으므로 다음 진단으로 원천 거부 사유를 구분한다. 현재 운영 Cloudflare 수치가 표시된다고 보고하지 않는다.

### 실제 오류 코드 확인 — 14:20 UTC

최대 세 요청의 HTTP 상태·숫자 코드만 반환하는 추가 진단을 **`286870ea-211d-43a5-ba14-d56d143bfcf6`**, <https://286870ea.biadone.pages.dev>로 배포했다. Production 성공 시각은 **2026-10-17 14:19:44 UTC**다. 공개 자산은 모두 같고 비공개 `dashboard-server/analytics.mjs`만 변경됐다. 패키지는 `/private/tmp/blabee-analytics-trace-package.json`에 기록했다. 전체 Node·격리 DB·API·패키지 **128/128**, Wrangler Functions 컴파일, 운영 HTTP **25/25**를 통과했다. 기록은 `/private/tmp/blabee-analytics-trace-tests.tap`, `blabee-analytics-http-production-trace.json`이다.

사용자 요청에 따라 CUA로 기존의 실제 로그인 관리자 화면에서 `데이터 새로 조회`를 직접 눌렀다. 운영 응답의 안전한 진단은 다음과 같았다.

| 요청 | HTTP | 숫자 오류 코드 |
|---|---|---|
| GraphQL 연결 설정 조회 | 401 | 10000 |
| 현재 계정의 토큰 verify | 401 | 1000 |
| 사용자 토큰 verify | 401 | 1000 |

이 결과는 운영 서버가 사용하는 토큰이 Cloudflare 인증 단계에서 받아들여지지 않는다는 직접 근거다. UI에 표시된 Active 토큰과 저장된 Secret 값이 일치하는지, 토큰 자체의 최종 원인은 확인하지 못했다. 이 결과로 임의로 권한을 확대하거나 계정 토큰을 사용자 토큰으로 바꾸지 않는다.

Chrome에 현재 Pages 프로젝트의 Production Variables and secrets를 새 탭으로 열고 정확한 `CF_ANALYTICS_API_TOKEN`의 Value 입력칸을 준비했다. 이름·다른 변수·환경은 변경하지 않았고, 토큰 입력·저장도 수행하지 않았다. 인증정보 입력은 사용자에게 맡기고 발급받은 원문 재저장을 요청했다. 사용자 저장 완료 후 새 배포와 같은 실제 로그인 화면 재조회가 남았다. 다른 Chrome 탭과 기존 로컬 로그인 세션은 유지한다.

### Secret 재저장과 새 서버 확인 — 14:30 UTC

사용자가 원문 재저장 완료를 확인했다. 같은 소스의 배포 **`62268f26-f2f9-4143-8f58-7b4a4eb380d0`**가 **14:25:21 UTC** 성공했으며 현재 계정의 `biadone/main`, Production, canonical 배포가 일치했다. 실제 관리자 재조회는 여전히 위와 같은 세 요청의 401이었다. 전파 시간을 둔 재조회도 같았다. 설정 화면에는 미저장 Save 동작이 남아 있지 않았고 Production 선택과 Secret 이름도 일치했다.

저장소와 설치된 Wrangler 4.151.1을 읽기 전용으로 조사했다. 준비/배포 경로는 `.env`·`.dev.vars`·로컬 토큰을 읽거나 Secret을 PATCH하지 않고 공개 vars만 업로드한다. 단순 쿼리나 분석 권한 문제로 단정할 근거는 없고, Active로 표시된 토큰과 런타임 값의 동일성도 아직 증명되지 않았다.

구버전 응답 여부를 분리하려고 실패 응답에 고정 공개 진단 리비전 `cf-auth-check-20261017-1`만 추가했다. 관련 분석 테스트 **31/31** 통과 후 **`05783150-1fd3-4e97-8c04-4c225da1f59c`**, <https://05783150.biadone.pages.dev>로 배포, **14:30:20 UTC** 성공을 확인했다. 패키지 62개 중 서버 분석 한 파일만 다르고 공개 자산은 모두 같다. 기록은 `/private/tmp/blabee-analytics-revision-package.json`, `blabee-analytics-revision-tests.tap`이다. 실제 관리자 재조회에서 새 서버 리비전과 같은 401·숫자 코드를 함께 확인했다.

서버 밖의 공식 토큰 verify를 비교할 일회성 `/private/tmp/blabee-token-check.py`를 준비했다. 토큰은 대화형 터미널의 getpass 숨김 입력으로만 받고 Cloudflare의 고정 HTTPS API에 보내며 리디렉션을 따르지 않는다. 토큰·Token ID·원문 오류·헤더를 출력하거나 저장하지 않는다. 결과 파일에는 상태·숫자 코드·active 여부만 쓴다. Python 구문 검사는 통과했다. Computer Use가 `com.apple.Terminal` 자동 조작을 안전상의 이유로 차단했으므로 다른 앱/도구로 우회하지 않았다. 사용자에게 명령 직접 실행과 숨김 입력을 요청했으며 결과 확인이 남았다. Cloudflare 연결이 해결됐다고 보고하지 않는다.

사용자가 직접 도구를 실행한 결과, Mac에서도 계정·사용자 verify가 각각 **HTTP 401 / 1000 / active:false**였다. 값은 수집하지 않고 안전한 결과 파일만 읽었다. 동일 입력이 운영 밖에서도 거부되므로 대시보드 배포에만 한정된 현상은 아니다. UI에서 Active인 항목과 입력 원문의 동일성은 확인하지 않는다.

새 `Blabee dashboard analytics` 토큰의 검토 화면을 CUA로 준비했다. 초안은 현재 계정의 **Account Analytics Read**와 **biadone.com 하나의 Analytics Read**, 만료 없음, IP 필터 없음이다. 계정 내 다른 Zone에는 도메인 분석 권한을 부여하지 않는다. 최종 **Create token**을 누르지 않았고 기존 토큰·권한을 수정하거나 취소하지 않았다. 실제 발급→Copy token→Production Secret 저장은 사용자에게 맡겼다. 사용자가 다른 Chrome 창으로 전환하자 추가 UI 조작을 중단했다. 새 토큰 저장 뒤 재배포·실제 조회가 남았다.

## 실제 연결 완료 — 2026-10-17 14:42 UTC

사용자의 초기 `새 토큰 저장 완료` 답변을 Secret 저장까지 완료한 것으로 해석해 동일 소스를 **`58cd60c7-2168-43c5-b9a8-7b8f63593170`**, **14:36:44 UTC**에 배포했다. 이후 사용자가 토큰을 어디에 입력할지 질문해, 발급 완료와 Pages Secret 저장 완료가 별개였음을 확인했다. 앞선 두 단계가 모두 끝났다고 확정하지 않는다. 이 배포의 실제 API는 이전과 같은 401이었다.

사용자가 기존 항목을 수정할 수 없어 Add로 새 변수를 만드는 상황이라고 알려왔다. 충돌을 피하도록 정확한 새 이름 **`CF_ANALYTICS_API_TOKEN_V2`**, 타입 **Secret**, 환경 **Production**을 안내했다. 서버는 이 이름이 존재하면 우선하며, 비었거나 거부되더라도 이전 토큰으로 재시도하지 않는다. 새 이름이 전혀 없는 기존 설치에만 원래 이름을 지원한다. 원문이나 해시·길이를 코드·공개 설정에 넣지 않는다.

사용자가 새 항목 저장 완료를 확인한 뒤 메타데이터에서 Production의 새 이름이 `secret_text`임을 확인했다. API 읽기에는 원래 이름이 더 이상 없었으며, 에이전트가 기존 Secret을 삭제하거나 새 값을 입력한 것은 아니다. 새 바인딩 단독 연결·우선순위·사용 불가 시 이전 값으로 우회하지 않음·동일 값으로만 verify·공개 config 비노출을 검사했다. 전체 **131/131 통과**, `/private/tmp/blabee-analytics-v2-tests.tap`.

최종 운영 배포는 **`25405023-f01a-4113-9456-33e9df373109`**, <https://25405023.biadone.pages.dev>이며 **2026-10-17 14:40:55 UTC**에 성공했다. 계정의 `biadone` Production 배포와 새 Secret 바인딩 형식을 확인했다. 62개 파일 패키지에서 이전 서버 버전 대비 분석 서버 한 파일만 다르고 공개 자산은 전부 같다. `/private/tmp/blabee-analytics-v2-package.json`에 기록했다. 새로운 운영 HTTP 25개 검사 결과는 `/private/tmp/blabee-analytics-http-production-v2.json`이다.

이제 **실제 운영 관리자 로그인 세션에서 CUA로 직접 `데이터 새로 조회`를 눌러 Cloudflare 조회 성공을 확인**했다. OAuth·API 모의 응답이나 MCP 조회가 아니라 배포된 서버와 저장된 Secret으로 왕복한 UI 근거다.

- 최근 7개 UTC 날짜 선택: 페이지 조회수 **189**, Visits **161**. 샘플링된 추정치 표시, 시간 추이와 증감률 표시.
- 이후 사용자가 선택한 오늘 UTC 범위: 페이지 조회수 **70**, Visits **62**. 해당 기간의 실제 표시 값을 다시 확인했다.
- 오늘 국가: 대한민국 66·미국 3·독일 1, 합계 **70**.
- 오늘 브라우저: ChromeHeadless 45·알 수 없음 16·Chrome 7·Curl 2, 합계 **70**.
- 오늘 OS: MacOSX 51·알 수 없음 18·Windows 1, 합계 **70**.
- 실제 화면 캡처에서 두 시간 추이·시간대 막대·세 환경 순위와 단순 로그인 이후 메인 화면을 시각적으로 확인했다. 샘플링·자동화 요청 포함·UTC 표시는 유지했다. 신규 베타 신청과 출처 표는 원래 Supabase의 미수집·부분 집계 의미를 유지한다.

위 값은 조회 당시의 집계이며 이후 정상 유입에 따라 변한다. 고유 인원이나 사람만의 접속 수로 해석하지 않는다. 공개 랜딩·UTM·기존 DB·Auth 설정은 이번 연결 보완에서 변경하지 않았다. 커밋·푸시는 수행하지 않았다. 추가 토큰 입력이나 운영 배포 승인 요청은 남아 있지 않다.
