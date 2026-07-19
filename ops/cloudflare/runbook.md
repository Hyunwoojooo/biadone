# Cloudflare Runbook

Last reviewed: 2026-07-06

## 재배포

`biadone.com` 정적 사이트를 다시 배포할 때 사용한다.

```bash
cd sites/biadone.com
./scripts/deploy-cloudflare.sh
```

배포 후 확인:

```bash
curl -sSI https://biadone.com
curl -sSI https://www.biadone.com
curl -sSI https://biadone.pages.dev
```

브라우저에서 확인:

- `https://biadone.com`
- `https://www.biadone.com`
- 주요 앵커 이동
- CSS/JS 로딩
- `blabase/` 하위 페이지

## 장애 대응

### 1. 사이트가 열리지 않음

확인 순서:

1. `curl -sSI https://biadone.com`으로 HTTP 상태를 확인한다.
2. `curl -sSI https://biadone.pages.dev`로 Pages 기본 URL이 정상인지 확인한다.
3. Pages 기본 URL은 정상이고 커스텀 도메인만 실패하면 DNS/custom domain 문제로 본다.
4. 둘 다 실패하면 최근 Pages 배포 상태를 Cloudflare 대시보드에서 확인한다.

대응:

- 최근 코드 변경이 원인으로 보이면 이전 정상 버전으로 되돌린 뒤 재배포한다.
- DNS 변경 직후라면 [dns.md](./dns.md)의 기준 상태와 Cloudflare 대시보드를 비교한다.
- Cloudflare 장애 가능성이 있으면 Cloudflare status page를 확인한다.

### 2. 정적 자산이 깨짐

확인 순서:

1. 브라우저 개발자 도구 Network 탭에서 실패한 CSS/JS 경로를 확인한다.
2. `sites/biadone.com/scripts/deploy-cloudflare.sh`의 업로드 allowlist에 해당 파일 또는 디렉터리가 포함되어 있는지 확인한다.
3. 로컬에서 `sites/biadone.com/`를 정적 서버로 열어 같은 문제가 재현되는지 확인한다.

로컬 확인 예:

```bash
cd sites/biadone.com
python3 -m http.server 8000
```

대응:

- 새 공개 자산 디렉터리를 추가했다면 배포 스크립트 allowlist에도 추가한다.
- 내부 문서, reference, 환경 파일은 allowlist에 추가하지 않는다.

### 3. 커스텀 도메인만 실패

확인 순서:

```bash
dig @1.1.1.1 +short biadone.com
dig @1.1.1.1 +short www.biadone.com
curl -sSI https://biadone.com
curl -sSI https://www.biadone.com
curl -sSI https://biadone.pages.dev
```

대응:

- `biadone.pages.dev`가 정상이라면 Cloudflare DNS와 Pages custom domain 설정을 확인한다.
- [dns.md](./dns.md)의 기준 상태와 다른 레코드가 있으면 변경 이력을 확인하고 롤백 여부를 결정한다.

## 롤백

우선순위:

1. Cloudflare Pages 대시보드에서 이전 정상 deployment로 rollback한다.
2. 대시보드 롤백이 어렵거나 코드 변경을 되돌려야 하면 Git에서 이전 정상 상태로 복구한 뒤 재배포한다.

주의:

- Git 히스토리 재작성, branch 삭제, force push는 별도 승인 없이 하지 않는다.
- 운영 장애 중에도 DNS 레코드 삭제나 proxy 해제는 영향 범위가 크므로 변경 전 기록과 롤백 계획을 남긴다.

## 배포 전 체크리스트

- 공개해야 하는 파일이 배포 스크립트 allowlist에 포함되어 있다.
- 공개하면 안 되는 문서, reference, cache, env 파일은 allowlist에 없다.
- 로컬에서 주요 페이지와 링크를 확인했다.
- 변경이 DNS에 영향을 주는 경우 [dns.md](./dns.md)에 변경 계획을 먼저 적었다.

## 배포 후 체크리스트

- `https://biadone.com` HTTP `200`
- `https://www.biadone.com` HTTP `200`
- `https://biadone.pages.dev` HTTP `200`
- CSS/JS 정상 로드
- 주요 CTA와 앵커 링크 정상 동작
- 문제가 있으면 이 문서의 롤백 절차를 따른다.
