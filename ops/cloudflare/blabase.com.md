# blabase.com Cloudflare Workers

## 현재 구조

2026-07-20 기준 `blabase.com`은 Next.js 제품 앱을 서비스한다.

- Worker: `blabase-app`
- Source: `apps/blabase/`
- Runtime adapter: `@opennextjs/cloudflare`
- Worker URL: `https://blabase-app.hyunwoojoo-33.workers.dev`
- Routes: `blabase.com/*`, `www.blabase.com/*`
- Rollback origin: Cloudflare Pages project `blabase`
- Pages URL: `https://blabase.pages.dev`

DNS와 Pages custom domain은 유지하고 Worker Route가 요청을 먼저 처리한다. 따라서
Pages 프로젝트를 삭제하지 않고도 Route 제거만으로 정적 롤백 사이트로 돌아갈 수
있다.

## 배포

```bash
cd apps/blabase
npm install
npm test
npm run typecheck
npm run lint
npm run preview
npm run deploy
```

`npm run deploy`는 Next.js 빌드, OpenNext 번들 생성, Wrangler 배포를 순서대로
실행한다. `wrangler.jsonc`가 두 운영 Route를 함께 관리한다.

운영 Worker에는 아래 secret 이름이 필요하다. 값은 문서, Git, Wrangler 설정에
기록하지 않는다.

```text
CHATGPT_SHARE_FETCHER_URL
CHATGPT_SHARE_FETCHER_SECRET
```

## 배포 확인

```bash
curl -sSI https://blabase.com
curl -sSI https://www.blabase.com
curl -sS https://blabase.com
```

확인 기준:

- 두 호스트가 HTTP `200`을 반환한다.
- 보안 헤더 `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Frame-Options`가 있다.
- root HTML에 `ChatGPT 공유 링크` 입력 폼이 있고 이전 랜딩 문구가 없다.
- `POST /api/analyses`가 실제 공유 URL에 대해 `completed`와 `monitorData`를
  반환한다.

## 롤백

1. `apps/blabase/wrangler.jsonc`에서 `routes` 두 항목을 제거한다.
2. 검증된 기존 Worker 번들을 다시 배포한다.
3. `https://blabase.com`과 `https://www.blabase.com`이 Pages 정적 사이트를
   반환하는지 확인한다.

Pages project나 custom domain을 삭제할 필요는 없다. Worker 자체를 삭제하거나
Pages 프로젝트를 재배포하는 방식보다 Route 제거가 복구 범위가 작다.

## 현재 MVP 제약

- 분석 기록은 영구 DB에 저장하지 않는다.
- POST 결과는 같은 브라우저의 메모리와 `sessionStorage`로 결과 화면에 전달한다.
- 새 브라우저, 다른 기기, 공유 가능한 영구 분석 URL은 지원하지 않는다.
- Cloudflare Worker에서 ChatGPT를 직접 가져오면 차단될 수 있어 별도 fetcher를
  사용한다.
