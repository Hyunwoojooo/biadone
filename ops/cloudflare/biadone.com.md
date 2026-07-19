# biadone.com Cloudflare Pages

Last reviewed: 2026-07-06

## Summary

`biadone.com`은 Cloudflare Pages로 배포되는 정적 웹사이트다.

- Production: `https://biadone.com`
- WWW: `https://www.biadone.com`
- Cloudflare Pages URL: `https://biadone.pages.dev`
- Cloudflare Pages project: `biadone`
- Source directory: `sites/biadone.com/`
- Deploy script: `sites/biadone.com/scripts/deploy-cloudflare.sh`

## Source

운영 원본은 저장소의 아래 경로다.

```text
sites/biadone.com/
```

사이트는 정적 HTML/CSS/JavaScript로 구성되어 있으며, 루트 기준 빌드 단계는 없다.

주요 공개 파일:

```text
index.html
css/
js/
blabase/
```

공개 배포 대상에서 제외해야 하는 파일과 디렉터리:

```text
README.md
reference/
.wrangler/
local caches
environment files
```

## Deployment

배포는 `wrangler pages deploy`를 감싼 스크립트로 수행한다.

```bash
cd sites/biadone.com
./scripts/deploy-cloudflare.sh
```

스크립트 동작:

1. 임시 업로드 디렉터리를 만든다.
2. 공개에 필요한 파일만 `rsync`로 복사한다.
3. Cloudflare Pages project `biadone`에 `main` 브랜치 배포로 업로드한다.
4. 종료 시 임시 업로드 디렉터리를 삭제한다.

현재 스크립트의 업로드 allowlist:

```text
index.html
css/
js/
blabase/
```

현재 스크립트의 핵심 배포 명령:

```bash
npx -y wrangler@latest pages deploy "$UPLOAD_DIR" \
  --project-name biadone \
  --branch main
```

## Domains

Cloudflare Pages custom domain은 아래 호스트를 서비스한다.

```text
biadone.com
www.biadone.com
```

DNS 기준 상태는 [dns.md](./dns.md)를 따른다.

## Verification

배포 후 아래 항목을 확인한다.

```bash
curl -sSI https://biadone.com
curl -sSI https://www.biadone.com
curl -sSI https://biadone.pages.dev
```

기대 상태:

- HTTP `200` 응답
- `server: cloudflare`
- 주요 정적 자산 CSS/JS 로드 정상
- `https://biadone.com`와 `https://www.biadone.com` 모두 접속 가능

## Known Constraints

- 루트에는 공통 install/build/test 명령이 없다.
- 사이트는 정적 페이지라서 배포 전 별도 빌드 산출물이 생성되지 않는다.
- 베타 가입 폼은 현재 클라이언트 사이드 확인 메시지만 표시하며, 실제 이메일 저장 기능은 없다.
- Cloudflare 계정 ID, zone ID, API 토큰 같은 민감 정보는 이 문서에 기록하지 않는다.
