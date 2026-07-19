# blabase.com

`blabase.com`의 정적 공개 사이트입니다. Cloudflare Pages 프로젝트 `blabase`에
배포합니다.

## 로컬 확인

```bash
cd sites/blabase.com
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 엽니다.

## 배포

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

## Cloudflare Pages 설정

- Project: `blabase`
- Production branch: `main`
- Pages URL: `https://blabase.pages.dev`
- Custom domains: `blabase.com`, `www.blabase.com`

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
Pages custom domain은 `blabase.com`이 활성화되었고 `www.blabase.com`은 인증 전파
중입니다. 두 도메인이 모두 활성화된 뒤 HTTPS 응답을 확인하고 Cloudflare
DNSSEC를 설정합니다.

## 전환 기록

2026-07-20에 아래 작업을 수행했습니다.

1. Cloudflare Pages 프로젝트 `blabase`를 만들고 정적 사이트를 배포했습니다.
2. `blabase.com` zone을 Cloudflare에 추가했습니다.
3. 등록기관의 기존 `hosting.co.kr` 네임서버 네 개를 Cloudflare 네임서버 두 개로
   교체했습니다.
4. 기존 주차용 A 레코드를 Pages용 CNAME 레코드로 교체했습니다.

전환 전 공개 DNS에는 MX, TXT, CAA, AAAA 레코드가 없었습니다. 향후 도메인
이메일을 사용할 경우 메일 제공자의 MX, SPF, DKIM, DMARC 레코드를 별도로
추가해야 합니다.
