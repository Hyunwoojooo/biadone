# Cloudflare Ops

Cloudflare 관련 운영 문서를 이 디렉터리에서 관리한다.

## 문서 구조

- [biadone.com.md](./biadone.com.md): `biadone.com` Cloudflare Pages 프로젝트, 커스텀 도메인, 배포 방식
- [dns.md](./dns.md): DNS 레코드 기준 상태와 변경 이력
- [runbook.md](./runbook.md): 장애 대응, 롤백, 재배포 절차

## 현재 관리 대상

- Public site: `https://biadone.com`
- WWW: `https://www.biadone.com`
- Pages URL: `https://biadone.pages.dev`
- Cloudflare Pages project: `biadone`
- Source: `sites/biadone.com/`
- Deploy command: `cd sites/biadone.com && ./scripts/deploy-cloudflare.sh`

## 운영 원칙

- 실제 배포 대상 파일은 배포 스크립트의 allowlist로 제한한다.
- DNS 레코드 변경은 [dns.md](./dns.md)에 날짜, 목적, 변경 전후를 남긴다.
- 장애나 롤백 작업은 [runbook.md](./runbook.md)의 절차를 우선 따른다.
- Cloudflare 대시보드에서만 확인 가능한 값은 추정해서 적지 않고, 확인 후 문서화한다.
