# Cloudflare DNS

Last reviewed: 2026-07-06

## 기준 상태

`biadone.com`은 Cloudflare DNS에서 Cloudflare Pages 프로젝트 `biadone`으로 연결한다.

```text
Type   Name             Target              Proxy
CNAME  biadone.com      biadone.pages.dev   Proxied
CNAME  www.biadone.com  biadone.pages.dev   Proxied
```

## 변경 이력

| Date | Record | Change | Reason | Verification |
|---|---|---|---|---|
| 2026-07-06 | `biadone.com`, `www.biadone.com` | 기준 상태 문서화: both CNAME to `biadone.pages.dev`, proxied | Cloudflare Pages custom domain 운영 기록 정리 | Existing site README 기준 |

## 변경 기록 규칙

DNS 레코드를 변경할 때는 아래 정보를 남긴다.

- 변경 날짜
- 변경자
- 변경 전 레코드
- 변경 후 레코드
- 변경 이유
- 검증 명령과 결과
- 롤백 방법

## 확인 명령

Cloudflare 프록시가 켜진 CNAME은 public DNS 조회 시 Cloudflare edge IP로 보일 수 있다. 레코드의 의도된 대상은 Cloudflare 대시보드와 이 문서의 기준 상태로 관리한다.

```bash
dig @1.1.1.1 +short biadone.com
dig @1.1.1.1 +short www.biadone.com
curl -sSI https://biadone.com
curl -sSI https://www.biadone.com
```

## 주의사항

- Apex 도메인 `biadone.com`은 Cloudflare Pages custom domain 연결을 유지한다.
- `www.biadone.com`도 동일한 Pages 프로젝트를 바라본다.
- DNS-only 전환, target 변경, 레코드 삭제는 사이트 접속에 직접 영향을 준다.
- MX, TXT, SPF, DKIM, DMARC 같은 메일 관련 레코드는 이 문서에 별도로 확인된 뒤 추가한다.
