# Biadone — Personal Context OS (Company Intro Website)

## 프로젝트 개요

**Biadone**은 대화, 캘린더, 문서, 결정, 워크플로우 전반에 흩어진 맥락(context)을 이어받아 다음 행동을 미리 준비해주는 **Personal Context OS**입니다.

- **브랜드 프로미스**: *Before I Ask, Done.*
- **외부 태그라인**: *Your context, carried forward. Your next action, prepared.*
- **첫 제품**: blabase by Biadone
- **핵심 루프**: Capture → Context → Memory → Recall → Prepare → Confirm → Done

본 웹사이트는 첨부된 빌드 지침서(`biadone_company_intro_page_instructions_en_openclaw_reference.md`)를 기반으로 제작된 **1페이지 영문 회사 소개/제품 랜딩 페이지**입니다. 참고 문서에서 명시한 대로 특정 외부 서비스 명칭이나 마스코트, 브랜드 아이덴티티는 페이지 어디에도 노출하지 않았습니다.

## 저장소 위치

이 사이트는 BiaDone 작업공간 안에서 아래 경로를 운영 원본으로 사용합니다.

```text
~/BiaDone/sites/biadone.com
```

Codex CLI로 이 사이트만 수정할 때는 저장소 루트에서 아래처럼 시작합니다.

```bash
codex --cd sites/biadone.com
```

---

## 완성된 기능

- **Navigation**: 스티키 상단 내비게이션, 부드러운 앵커 스크롤, 반응형 모바일 메뉴(햄버거 토글)
- **Hero Section**: 브랜드 한 줄 정의, 서브헤드라인, 능력 요약 문구, Primary/Secondary CTA, 신뢰 마이크로카피, "Scattered → Context Pack → Decision Log/Action Queue/Brief/Done Signal" 흐름을 보여주는 목업 비주얼
- **Capability Strip**: 8개 핵심 역량을 보여주는 무한 마퀴 칩 애니메이션 (reduced-motion 대응)
- **Problem Section**: Re-explaining / Re-finding / Re-organizing / Re-starting / Re-deciding 5개 문제 카드
- **What Is Biadone?**: Context / Memory / Recall / Prepare / Confirm / Done 6개 정의 카드
- **How It Works**: Context-to-Action Loop 다이어그램(7단계) + 단계별 설명 카드
- **Quick Start with blabase**: Connect → Review → Confirm → Move forward 4단계 온보딩 + 터미널 스타일 세션 콘솔(상태 메시지, 커서 깜빡임)
- **Product Experience Cards**: Context Pack / Decision Log / Action Queue / Brief / Cue / Done Signal — hover/focus 시 뒷면(출처·컨트롤 포인트·상태 메시지) 노출되는 플립 카드
- **Use Cases**: 5개 오디언스 탭(Founders & Operators / Product Managers / Team Leads / Knowledge Workers / AI Power Users)에 따라 JS로 동적으로 바뀌는 유스케이스 카드
- **Trust & Control**: 6개 신뢰 원칙 카드 + Permission Drawer(출처 목록, 토글 스위치, Confirm & Send / Not now 버튼) 인터랙티브 목업
- **Ecosystem / Integrations**: 6개 카테고리 카드(Meetings, Calendar, Documents, Conversations, Tasks, AI Tools) — 과장 없는 "designed to connect" 톤
- **Manifesto**: 회사 존재 이유 및 "Before I Ask, Done." 태그라인 강조
- **Final CTA**: Join the blabase Beta / Request a Demo 버튼 + 클라이언트 사이드 이메일 대기열 폼(제출 시 확인 메시지 표시, 실제 저장은 되지 않음)
- **Footer**: Product / Company / Resources / Connect 4개 컬럼, 카피라이트
- **접근성**: 시맨틱 HTML, aria-label/aria-live, 키보드 포커스 스타일, prefers-reduced-motion 대응, 색상 대비 고려
- **SEO**: title, meta description, Open Graph 태그 포함
- **반응형**: 모바일/태블릿/데스크톱 그리드 대응 (Tailwind 반응형 유틸리티 사용)

---

## 페이지 구조 (앵커 기준)

| 섹션 | 앵커 ID |
|---|---|
| Hero | `#hero-section` |
| Capability Strip | `#capability-strip` |
| Problem | `#problem-section` |
| What Is Biadone? | `#what-is-biadone` |
| How It Works | `#how-it-works` |
| Quick Start with blabase | `#blabase-section` |
| Product Experiences | `#product-experiences` |
| Use Cases | `#use-cases` |
| Trust & Control | `#trust-section` |
| Ecosystem / Integrations | `#ecosystem-section` |
| Manifesto | `#manifesto-section` |
| Final CTA (+ 이메일 폼) | `#final-cta` / `#blabase-form` |
| Footer (Docs 포함) | `#docs` |

메인 회사 소개 페이지는 정적 단일 페이지(`index.html`)로 구성됩니다. 별도의 `/blabee/` 랜딩페이지는 홍보 경로를 구분하는 UTM 쿼리 파라미터를 지원합니다.

---

## 파일 구조

```
index.html          메인 페이지 (모든 섹션 포함)
blabase/index.html      blabase 하위 페이지
blabee/             Blabee 랜딩페이지와 공개 에셋 (시연 영상·자막·정책 초안 포함)
_headers            /blabee/에만 적용되는 보안·캐시·검색 차단 헤더
_redirects          /blabee → /blabee/ 정규화
css/style.css        커스텀 스타일 (디자인 토큰, 카드, 애니메이션, 반응형)
js/main.js           모바일 메뉴, 스크롤 reveal, 오디언스 탭 전환, 폼 처리
reference/           원본 빌드 지침 마크다운 보관용(사이트에 노출되지 않음)
```

### 사용 라이브러리 (CDN)
- Tailwind CSS (유틸리티 클래스)
- Google Fonts (Inter, JetBrains Mono)
- Font Awesome 6 (아이콘)

---

## 데이터 모델 / 저장소

웹페이지는 정적 HTML/CSS/JavaScript로 제공됩니다. Blabee 베타 신청 폼은 기존 Blabee Supabase의 제한된 공개 RPC를 사용해 이메일·최초 신청 시각·선택적 유입 정보를 저장합니다. 유입별 페이지 조회 수는 개인 식별자 없이 날짜별로 집계합니다. 스키마·권한·운영 방법은 [supabase/README.md](supabase/README.md), 레딧·X·인스타그램·유튜브 홍보 링크와 집계 기준은 [TRACKING.md](TRACKING.md)에 정리했습니다.

- **blabase 베타 가입 폼**은 프론트엔드에서만 동작하며, 제출 시 확인 메시지만 표시할 뿐 실제로 이메일이 저장되지 않습니다. (정적 사이트의 한계로, 실제 이메일 수집이 필요하면 Table API 또는 외부 폼 서비스 연동이 필요합니다.)

---

## 아직 구현되지 않은 기능 / 알려진 제한

- 메인 페이지의 blabase 폼은 실제 이메일을 저장하지 않습니다. `/blabee/` 신청 폼은 Supabase에 연결합니다.
- 실제 소셜 증빙(고객 후기, 베타 사용자 수 등) 자료 없음 — 지침서에 따라 확인되지 않은 수치/후기는 넣지 않음
- 실제 인테그레이션 로고/딥링크 없음 — 카테고리 카드로만 안내 (과장 클레임 방지)
- 다국어(예: 한국어 버전) 미구현 — 지침에 따라 전체 카피는 영어로만 작성됨
- Docs/Blog/Changelog 등 하위 페이지는 아직 별도 페이지로 존재하지 않고 앵커로 연결됨

---

## 다음 개발 단계 제안

1. **blabase 리드 수집 연동**: 메인 페이지의 blabase 폼에도 별도 저장 기능 연결
2. **실제 스크린샷/제품 데모 영상** 삽입 (현재는 CSS/SVG 기반 목업)
3. **Docs 하위 페이지** 별도 제작 (현재는 Footer 앵커로만 연결됨)
4. **다국어 버전** (예: 한국어) 필요 시 별도 페이지(`index-ko.html`) 형태로 확장
5. **실서비스 연동 후 Ecosystem 섹션에 실제 로고 및 연동 상태 업데이트**
6. **A/B 테스트용 카피 뱅크(Copy Bank) 적용** — 지침서 24장에 정리된 대체 H1/서브헤드/CTA 문구 활용

---

## Public URL

현재 Cloudflare Pages에 배포되어 있으며, 아래 주소로 공개됩니다.

- Production: `https://biadone.com`
- WWW: `https://www.biadone.com`
- Cloudflare Pages 기본 URL: `https://biadone.pages.dev`
- Cloudflare Pages project: `biadone`

### 배포 방식

이 폴더를 웹사이트의 운영 원본으로 사용합니다. 수정 후 재배포할 때는 아래 명령을 실행합니다.

```bash
./scripts/deploy-cloudflare.sh
```

배포 스크립트는 공개에 필요한 파일만 Cloudflare Pages에 업로드합니다.

```text
index.html
css/
js/
blabase/
blabee/
_headers
_redirects
```

`README.md`, `reference/`, `.wrangler/` 같은 문서/로컬 캐시 파일은 공개 배포 대상에 포함하지 않습니다.

### Blabee 하위 페이지

- 공개 주소: `https://biadone.com/blabee/` (`/blabee`에서도 이동)
- 2026-10-17 유입별 방문·신청 집계 운영 배포: `https://c9e0872f.biadone.pages.dev`. 플랫폼별 링크와 운영자 보고서는 [TRACKING.md](TRACKING.md)를 참고하세요.
- 2026-09-24 이메일 베타 신청 기능 운영 배포: `https://fcfda27f.biadone.pages.dev`. 최초 하위 경로 배포는 2026-09-21에 완료했습니다.
- 원본: [blabee-landing-page 브랜치](https://github.com/Hyunwoojooo/biadone/tree/blabee-landing-page/sites/blabee.com), 커밋 `cafbe8f8b2735b8592018c37ee4b01706134cba9`
- 원본 `npm run build:public` 결과 중 HTML/CSS/JS/에셋/정책만 `blabee/`에 복사했습니다. 이 폴더는 공개 파일 전용이며 이후 갱신에도 내부 문서·스크립트·캐시를 넣지 않습니다.
- 모든 사이트 내부 절대 경로와 canonical·OG URL을 `/blabee/` 기준으로 변경했습니다. 영문·한국어 정책 페이지와 `/blabee/liquid-glass/light/` 호환 경로를 포함합니다.
- 베타 신청 폼은 이메일만 입력받습니다. Supabase의 `blabee_marketing.beta_requests`에 이메일·최초 신청 시각·선택적 유입 정보를 저장하며, 같은 이메일은 한 건만 유지합니다. 다른 신청자의 이메일은 공개 API로 조회할 수 없습니다. 계정 생성이나 안내 메일 자동 발송은 하지 않습니다.
- 추적 링크의 UTM과 외부 참조 호스트로 경로별 페이지 조회 수·신규 베타 신청 수를 집계합니다. 방문 수는 고유 인원이 아니며, 기존 신청의 과거 유입은 알 수 없습니다. GPC/DNT 사용 시 유입 집계를 생략합니다. 운영자 조회 SQL과 플랫폼별 공유 링크는 [TRACKING.md](TRACKING.md)를 참고하세요.
- 홍보에는 `/blabee/reddit`, `/blabee/x`, `/blabee/instagram`, `/blabee/youtube` 짧은 주소를 사용할 수 있습니다. 이동 후 유입 정보를 읽고 주소창의 UTM을 정리합니다.
- 정책 초안 표시와 `noindex` 설정은 유지합니다. 신청 API/마이그레이션과 검증 방법은 [supabase/README.md](supabase/README.md)를 참고하세요.
- 랜딩페이지에 삽입된 36초 시연 MP4·영문 VTT 자막·포스터를 포함합니다. 원본 `media/promos/2026-09-21/`의 한·영 15초 홍보 MP4·SRT는 원본 공개 빌드와 동일하게 배포 대상에서 제외합니다.
- GSAP Core / ScrollTrigger 3.15.0은 원본의 자체 호스팅 파일과 라이선스 배너를 유지합니다. [GSAP Standard License](https://gsap.com/standard-license/)가 적용됩니다.

로컬에서는 별도 설치나 빌드 없이 사이트 루트에서 실행합니다.

```bash
python3 -m http.server 8000
# http://localhost:8000/blabee/
```

실제 배포 파일만 먼저 준비하려면 아래 명령을 사용합니다. 네트워크 업로드 없이 임시 폴더 경로를 출력하며, 검토 후 해당 폴더는 직접 정리합니다.

```bash
./scripts/deploy-cloudflare.sh --prepare-only
```

단순 Python 서버는 Cloudflare `_headers`/`_redirects` 및 영상 byte-range 처리를 재현하지 않습니다. 실제 배포 후 `/blabee` 이동, 헤더, 영상 재생·탐색을 확인해야 합니다. 배포는 사용자 명시 승인 후 기존 배포 명령으로 실행합니다.

### DNS 설정

Cloudflare DNS 레코드는 아래 상태를 유지합니다.

```text
CNAME  biadone.com      biadone.pages.dev  Proxied
CNAME  www.biadone.com  biadone.pages.dev  Proxied
```

---

## QA 체크리스트 (지침서 27장 기준 반영 현황)

- [x] 전체 페이지 영어로 작성
- [x] Hero에서 10–15초 내 핵심 메시지 전달
- [x] Personal Context OS로 명확히 포지셔닝
- [x] blabase를 첫 제품으로 명시
- [x] "시간 회복" 관점 강조 (re-finding/re-explaining/re-starting)
- [x] 챗봇/미팅노트 앱처럼 들리지 않도록 카피 작성
- [x] 사용자 승인/확인(permission & confirmation) 시각적으로 노출
- [x] Context-to-Action Loop 다이어그램 포함
- [x] 제품 용어(Context Pack, Decision Log 등) 일관되게 사용
- [x] 외부 참고 서비스명 미노출
- [x] 과장된 연동 클레임 없음
- [x] 상단/하단 CTA 반복 배치
- [x] 모바일 반응형 레이아웃
- [x] 접근성 기본 요건 충족 (시맨틱 태그, aria, 키보드 포커스, reduced-motion)
- [x] SEO 메타데이터 포함
