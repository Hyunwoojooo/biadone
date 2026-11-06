# Blabee 접속 대시보드

정적 HTML·CSS·JavaScript와 Cloudflare Pages Functions로 제공하는 관리자 화면입니다. 운영 주소는 [biadone.com/blabee/admin/](https://biadone.com/blabee/admin/)입니다. `/blabee/관리자`는 같은 주소로 이동합니다. 별도 프레임워크나 프로덕션 의존성은 없습니다.

Google 로그인 화면은 `Blabee`와 `Google로 로그인` 버튼만 표시합니다. 관리자 확인 전에는 메인 화면을 숨깁니다. 허용 계정은 `biadone.official@gmail.com`, `hyunwoojoo.33@gmail.com`, `hn7742@gmail.com`입니다. API의 Supabase Auth·UID 확인과 DB 허용 목록을 모두 통과해야 데이터를 조회할 수 있습니다.

## 화면과 지표

게시물 관리와 기존 홍보 제목·소개·새 게시물 버튼·녹색 배너를 제거합니다. 기간 필터 아래에 페이지 조회수, Visits, 신규 베타 신청, 시간 추이, 시간대별 분포, 국가·브라우저·OS 순위를 배치합니다. 기존 베타 신청의 날짜·유입 채널 집계는 별도 보조 섹션으로 유지합니다.

| 지표 | 원천과 범위 |
|---|---|
| 페이지 조회수 | Cloudflare `httpRequestsAdaptiveGroups`. `biadone.com`의 정확한 `/blabee`, `/blabee/` 경로에 대한 성공한 HTML GET 요청. 관리자·정책·자산·다른 제품·다른 호스트 제외 |
| Visits | 같은 범위의 Cloudflare `sum.visits`. 외부 사이트 또는 직접 링크에서 시작한 방문이며, 고유 인원이나 쿠키 기반 세션 수가 아님 |
| 시간 추이·접속 시간대 | 같은 선택 기간의 Cloudflare 집계. UTC 시간과 날짜를 명시하며 개별 방문 기록을 저장하지 않음 |
| 국가·브라우저·OS | 같은 Cloudflare 페이지 조회수의 차원별 집계. 국가 추정과 브라우저·OS 분류는 Cloudflare 기준이며 알 수 없는 값도 보존 |
| 신규 베타 신청 | Supabase의 최초 이메일 등록 시각 기준. 같은 이메일의 재신청은 중복 집계하지 않음 |
| 유입 채널·캠페인 | 기존 Supabase 추적 집계. 기본·호환 Blabee 랜딩 합산 범위이며 Cloudflare 조회수와 합산하지 않음 |

Cloudflare Edge 통계는 브라우저 beacon 통계와 다릅니다. 봇·ChromeHeadless 같은 자동화 요청이 포함되며 적응형 표본 집계일 수 있습니다. GraphQL의 집계값에는 가중치가 이미 반영되므로 `sampleInterval`을 다시 곱하지 않습니다. 페이지 조회수·Visits·베타 신청은 서로 다른 지표이고 이들로 고유 방문자 전환율을 만들지 않습니다.

UTC 달력 기준 1일·7일·30일·직접 선택을 제공합니다. 현재 UTC 날짜의 종료는 조회 시각으로 자릅니다. 증감률은 동일한 경과 시간의 이전 기간과 비교하며 이전 값이 0이거나 조회할 수 없으면 백분율을 표시하지 않습니다. 실제 Cloudflare 설정에서 확인한 범위는 최대 30일 조회·31일 보존입니다. 이전 비교 기간만 보존 범위를 벗어나면 현재 수치는 유지하고 비교만 미제공으로 표시합니다. 시작일이 너무 오래됐거나 요청 범위가 제공자 제한을 초과하면 값을 추정하거나 잘라서 전체 기간처럼 표시하지 않습니다.

미연결·권한 부족·제한 초과·조회 실패·빈 결과·실제 0을 구분합니다. Cloudflare만 실패하면 승인된 베타 신청은 계속 표시하고, 인증이 실패하면 전체 데이터를 지웁니다. 채널·캠페인 필터는 Supabase 보조 섹션에만 적용되며 Cloudflare와 상단 기간 합계를 바꾸지 않습니다.

## 실행

Node.js 22 이상, 의존성 설치 불필요:

```sh
npm run dev
# 다른 포트
node scripts/dev.mjs --port 8818
```

기본 주소는 `http://127.0.0.1:8814/`, 하위 경로는 `/blabee/admin/`입니다. `?demo=1`은 명시적인 합성 데이터 확인 모드이며 실제 성과가 아닙니다. 샘플 값은 브라우저 테스트에서만 사용합니다.

## API와 인증

- `GET /blabee/admin/api/config`: 공개 Supabase URL·publishable key·설정 여부만 반환.
- `GET /blabee/admin/api/admin/overview?start=YYYY-MM-DD&end=YYYY-MM-DD`: 기존 Supabase 일별 집계. 종료일 제외, 최대 90일.
- `GET /blabee/admin/api/admin/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD`: Cloudflare 고정 호스트·정확한 두 경로의 집계. 임의 GraphQL, URL, 호스트, 경로, 채널 필터를 받지 않음.

기존 게시물 RPC·비공개 테이블·API는 보존하지만 화면에서 요청하거나 변경하지 않습니다. 이미 적용한 대시보드·UTM 마이그레이션을 재실행하지 마세요. 설치 이력과 이전 검증은 [CONNECTION.md](../../reference/blabee-dashboard/CONNECTION.md)에 있습니다. 새 API 계약과 범위는 [ANALYTICS.md](../../reference/blabee-dashboard/ANALYTICS.md)에 있습니다.

소유자 토큰은 Supabase 서버에서 실제 검증하고, 전달받은 사용자 JWT로 DB의 허용 목록도 확인합니다. Supabase service-role key는 사용하지 않습니다. 여러 UID의 설정 오류는 기존 이메일 허용으로 우회하지 않고 닫힌 상태로 실패합니다. 응답은 `private, no-store`입니다. 외부 HTTP는 `redirect: manual`과 명시적 3xx 거부, 제한 시간을 사용합니다. Cloudflare 원문 오류·토큰은 클라이언트나 로그로 출력하지 않습니다.

하위 경로 모드에서 로그아웃·만료·401·403·페이지 이탈·BFCache 복귀는 수치·차트·동적 필터·세션을 지웁니다. 늦게 도착한 응답은 복원하지 않습니다. 새로고침 후 다시 로그인해야 하며 진행 중인 Google PKCE verifier는 보존합니다. 같은 origin의 다른 사이트 코드와 완전한 보안 격리를 제공하지는 않습니다.

## Cloudflare 연결

Production의 `CF_ANALYTICS_API_TOKEN_V2` **Secret**을 서버에서만 사용합니다. 사용자가 Cloudflare에 직접 저장했으며 저장 여부와 `secret_text` 형식만 확인했습니다. 새 이름이 있으면 우선하고 값이 비었거나 거부돼도 이전 토큰으로 재시도하지 않습니다. 새 이름이 전혀 없는 기존 설치만 `CF_ANALYTICS_API_TOKEN`을 사용합니다. 토큰 값을 읽거나 소스·Wrangler vars·공개 설정에 복사하지 않습니다. 기존 MCP OAuth 자격증명과 별개입니다.

Cloudflare 안내: [GraphQL 읽기 전용 토큰](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/), [Pages Secret 설정](https://developers.cloudflare.com/pages/functions/bindings/#secrets), [샘플링](https://developers.cloudflare.com/analytics/graphql-api/sampling/).

인증 거부 시 고정된 계정·사용자 토큰 verify 경로로 활성 상태를 확인합니다. 확인 실패만으로 토큰 무효를 단정하지 않습니다. 관리자에게만 실패 단계와 HTTP 상태·숫자 오류 코드·network/timeout을 최대 세 요청까지 표시합니다. 원문 오류·토큰·Token ID·인증 헤더는 표시하거나 로그에 남기지 않습니다.

공개 랜딩의 CSP·UTM 처리·베타 신청 RPC·추적 테이블은 변경하지 않습니다. 브라우저 beacon이 막혀 있는 현재 CSP에서도 Edge 데이터를 조회합니다. 수집 누락을 과거로 소급 복원하지 않습니다.

## 배포

사이트 루트에서 기존 승인된 배포 경로를 사용합니다.

```sh
./scripts/deploy-cloudflare.sh --prepare-only
# 명시적인 운영 배포 승인 범위에서 실행
./scripts/deploy-cloudflare.sh
```

공개 사이트 허용 목록과 관리자 자산 9개만 임시 `public/`에 복사합니다. 서버 코드·Functions·Wrangler 설정은 공개 폴더 밖에 두며 SQL·테스트·내부 문서·캐시·환경 파일·실제 집계 내보내기는 공개하지 않습니다. Functions는 관리자 경로에만 실행됩니다. 관리자 응답은 단일 CSP와 `no-store, no-transform`을 사용해 자동 beacon 삽입을 막습니다. 기존 랜딩과 홍보 리디렉션을 유지합니다.

## 검사

```sh
npm test
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js npm run test:all
BASE_URL=http://127.0.0.1:8818/ node tests/browser.cjs \
  --playwright-module /absolute/path/to/playwright --executable /absolute/path/to/chromium
BASE_URL=http://127.0.0.1:8818/blabee/admin/ node tests/login-gate.browser.cjs \
  --playwright-module /absolute/path/to/playwright --executable /absolute/path/to/chromium
BASE_URL=http://127.0.0.1:8818/blabee/admin/ node tests/subpath.browser.cjs \
  --playwright-module /absolute/path/to/playwright --executable /absolute/path/to/chromium
```

브라우저 검사는 외부 요청을 차단하고 OAuth·관리자 API를 모의 처리합니다. 운영 조회수·신청을 생성하지 않습니다. Browser plugin이 없어 기존 Playwright·Chromium을 사용합니다. 실제 Cloudflare 읽기, 격리 DB·API 검사, 배포 자산 검사, 모의 로그인 검사, 실제 운영 사용자 로그인은 각각 별도의 검증 근거로 기록합니다. 이번 변경의 최종 실행 결과와 배포 ID는 CONNECTION.md에 추가합니다.
