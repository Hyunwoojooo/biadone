# blabase.com

Cloudflare Pages 프로젝트 `blabase`에 남겨 둔 정적 롤백 사이트입니다.
2026-07-20부터 `blabase.com`과 `www.blabase.com`의 실제 요청은 제품 앱 Worker
`blabase-app`의 Route가 먼저 처리합니다. 이 디렉터리를 배포해도 운영 화면은
바뀌지 않습니다.

## 로컬 확인

```bash
cd sites/blabase.com
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 엽니다.

## 롤백 원본 배포

Cloudflare Wrangler 인증이 완료된 환경에서 실행합니다.

```bash
cd sites/blabase.com
./scripts/deploy-cloudflare.sh
```

배포 스크립트는 공개 파일만 임시 폴더에 복사한 뒤 Pages에 업로드합니다.

```text
index.html
_headers
css/
```

## Cloudflare Pages 롤백 설정

- Project: `blabase`
- Production branch: `main`
- Pages URL: `https://blabase.pages.dev`
- Origin custom domains: `blabase.com`, `www.blabase.com`
- Active Worker routes: `blabase.com/*`, `www.blabase.com/*`

Worker Route를 제거하면 같은 DNS와 Pages custom domain을 통해 이 정적 사이트가
다시 노출됩니다. 운영 배포와 롤백은
[`../../ops/cloudflare/blabase.com.md`](../../ops/cloudflare/blabase.com.md)를
따릅니다.

Git 연동으로 전환할 경우 저장소는 모노레포이므로 Root directory를
`sites/blabase.com`으로 지정하고 Build command는 비워 둡니다. Build output
directory는 `.`을 사용합니다.

## DNS 운영 상태

2026-07-20 기준 `blabase.com`은 Cloudflare authoritative DNS를 사용합니다.

```text
NS  stan.ns.cloudflare.com
NS  suzanne.ns.cloudflare.com
```

Cloudflare DNS 대시보드의 기준 레코드:

```text
Type   Name              Target              Proxy
CNAME  blabase.com       blabase.pages.dev   Proxied
CNAME  www.blabase.com   blabase.pages.dev   Proxied
```

프록시된 CNAME은 공개 DNS 조회 시 Cloudflare edge A 레코드로 보일 수 있습니다.
두 호스트의 Worker Route가 활성화되어 있으며 Pages는 origin/롤백 대상으로
유지합니다. 공개 DNS 조회 결과만으로 Worker Route 유무를 판별할 수 없으므로
응답의 Next.js 본문과 API 동작을 함께 확인합니다.

## 전환 기록

2026-07-20에 아래 작업을 수행했습니다.

1. Cloudflare Pages 프로젝트 `blabase`를 만들고 정적 사이트를 배포했습니다.
2. `blabase.com` zone을 Cloudflare에 추가했습니다.
3. 등록기관의 기존 `hosting.co.kr` 네임서버 네 개를 Cloudflare 네임서버 두 개로
   교체했습니다.
4. 기존 주차용 A 레코드를 Pages용 CNAME 레코드로 교체했습니다.
5. Next.js 제품 앱을 OpenNext Worker `blabase-app`으로 배포했습니다.
6. `blabase.com/*`, `www.blabase.com/*` Route를 Worker에 연결하고 Pages 랜딩은
   롤백 원본으로 전환했습니다.

전환 전 공개 DNS에는 MX, TXT, CAA, AAAA 레코드가 없었습니다. 향후 도메인
이메일을 사용할 경우 메일 제공자의 MX, SPF, DKIM, DMARC 레코드를 별도로
추가해야 합니다.
