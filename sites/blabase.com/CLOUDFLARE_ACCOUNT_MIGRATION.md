# Cloudflare 계정 이전 체크리스트

`blabase.com`을 기존 Cloudflare 계정에서 새 계정으로 옮길 때 사용한다.
이 문서에는 secret 값이나 API token을 기록하지 않는다.

## 이전 기준 상태

- 기존 계정 이메일: `hyunwoojoo.33@gmail.com`
- 기존 계정 ID: `94217884f3a123f7d12341dbc556751c`
- 새 계정 이메일: `biadone.official@gmail.com`
- 새 계정 ID: `210a22672538579a7236dc379b00649c`
- Zone: `blabase.com`
- 기존 nameservers:
  - `stan.ns.cloudflare.com`
  - `suzanne.ns.cloudflare.com`
- 새 nameservers:
  - `chase.ns.cloudflare.com`
  - `marge.ns.cloudflare.com`
- 기존 Pages project: `blabase`
- 기존 Pages domains:
  - `blabase.pages.dev`
  - `blabase.com`
  - `www.blabase.com`
- 새 Pages project: `blabase-landing`
- 새 Pages domain: `blabase-landing.pages.dev`
- Worker: `blabase-app`
- Worker routes:
  - `blabase.com/*`
  - `www.blabase.com/*`
- Worker secrets:
  - `CHATGPT_SHARE_FETCHER_URL`
  - `CHATGPT_SHARE_FETCHER_SECRET`

## 1. 기존 계정 백업

- [ ] Cloudflare Dashboard에서 DNS records를 BIND 파일로 export
- [x] DNSSEC 활성 여부와 등록기관 DS record 확인 (공개 DS record 없음, 2026-07-25)
- [ ] SSL/TLS encryption mode 기록
- [ ] Edge Certificates 상태 기록
- [ ] Redirect Rules, WAF, Cache Rules, Transform Rules 기록
- [x] Worker secret의 원래 값을 안전한 secret 저장소에서 확인
- [x] 현재 운영 응답 확인

Secret 값은 Cloudflare에서 다시 읽을 수 없으므로 원본을 찾지 못하면 새 값을
발급한다.

## 2. 새 계정 사전 준비

- [x] 새 Cloudflare 계정을 생성하고 이메일 확인
- [x] `blabase.com` Zone 추가
- [x] DNS records 구성 (`@`, `www` → `blabase-landing.pages.dev`)
- [x] 새 계정 ID 기록
- [x] 새 계정이 배정한 nameservers 기록
- [x] Pages 롤백 프로젝트 생성 및 배포
- [x] `blabase-app` Worker를 custom route 없이 먼저 배포
- [x] Worker secrets 두 개 입력
- [x] 새 `workers.dev` 주소에서 페이지 검증

기존 `blabase.pages.dev` 이름을 새 계정에서 사용할 수 없으면 새 Pages project
이름을 사용한다. 예:

```bash
BLABASE_CF_PAGES_PROJECT=blabase-landing ./scripts/deploy-cloudflare.sh
```

새 Zone이 활성화되기 전 Worker 사전 배포에는 운영 routes가 없는 이전용 config를
사용한다.

```bash
cd sites/blabase.com
npx wrangler deploy --config migration/wrangler.blabase-app.jsonc
```

배포 전에는 반드시 새 계정으로 로그인됐는지 확인한다.

```bash
npx wrangler logout
npx wrangler login
npx wrangler whoami
```

## 3. 도메인 전환

- [x] DNSSEC가 켜져 있으면 기존 DS record 제거 후 충분히 대기 (DS record 없음)
- [x] 새 Zone의 DNS records를 최종 검토
- [x] 등록기관에서 nameservers를 새 계정 값으로 변경
- [x] 새 Zone 상태가 `Active`가 될 때까지 대기
- [x] Universal SSL Edge Certificate가 `Active`인지 확인
- [x] Pages custom domains 연결 (`blabase.com`, `www.blabase.com`)
- [x] Worker routes 두 개를 추가하고 Worker 재배포
- [x] 필요한 DNS records를 `Proxied`로 전환

새 Zone이 `Pending`인 동안에는 기존 Cloudflare 설정을 삭제하지 않는다.

## 4. 운영 검증

```bash
dig +short NS blabase.com
curl -sSI https://blabase.com
curl -sSI https://www.blabase.com
curl -sS https://blabase.com
```

- [x] 두 호스트가 HTTP 200 반환
- [x] Next.js 운영 화면 표시
- [x] HTTPS 인증서 정상
- [x] 필수 보안 헤더 존재
- [ ] 실제 ChatGPT 공유 URL 분석 성공
- [ ] Worker logs와 Observability에 새 오류 없음
- [ ] Worker route 제거 시 Pages 롤백 정상

## 5. 기존 계정 정리

새 계정에서 정상 동작을 충분히 확인하기 전에는 기존 Worker와 Pages project를
삭제하지 않는다. 기존 계정의 Zone이 `Moved Away`로 바뀌는 것은 정상이다.

- [ ] 이전 후 며칠간 운영 모니터링
- [ ] 기존 계정의 유료 구독 및 결제 항목 확인
- [ ] 더 이상 필요 없는 API token과 배포 자격 증명 폐기
- [x] 로컬 Wrangler를 새 계정으로 로그인
- [ ] 운영 문서의 account ID, Pages URL, workers.dev URL 업데이트
