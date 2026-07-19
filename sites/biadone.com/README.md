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

이 사이트는 정적 단일 페이지(`index.html`)로 구성되어 있으며 별도의 쿼리 파라미터나 라우팅은 없습니다.

---

## 파일 구조

```
index.html          메인 페이지 (모든 섹션 포함)
blabase/index.html      blabase 하위 페이지
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

현재 이 프로젝트는 **정적 콘텐츠 전용**이며 백엔드 데이터베이스나 Table API를 사용하지 않습니다.

- **blabase 베타 가입 폼**은 프론트엔드에서만 동작하며, 제출 시 확인 메시지만 표시할 뿐 실제로 이메일이 저장되지 않습니다. (정적 사이트의 한계로, 실제 이메일 수집이 필요하면 Table API 또는 외부 폼 서비스 연동이 필요합니다.)

---

## 아직 구현되지 않은 기능 / 알려진 제한

- 실제 이메일 수집·저장 기능 없음 (원할 경우 RESTful Table API로 `leads` 테이블을 만들어 연동 가능)
- 실제 소셜 증빙(고객 후기, 베타 사용자 수 등) 자료 없음 — 지침서에 따라 확인되지 않은 수치/후기는 넣지 않음
- 실제 인테그레이션 로고/딥링크 없음 — 카테고리 카드로만 안내 (과장 클레임 방지)
- 다국어(예: 한국어 버전) 미구현 — 지침에 따라 전체 카피는 영어로만 작성됨
- Docs/Blog/Changelog 등 하위 페이지는 아직 별도 페이지로 존재하지 않고 앵커로 연결됨

---

## 다음 개발 단계 제안

1. **리드 수집 연동**: `leads` 테이블 스키마(email, source, created_at)를 정의하고 Table API로 실제 베타 가입자 저장
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
```

`README.md`, `reference/`, `.wrangler/` 같은 문서/로컬 캐시 파일은 공개 배포 대상에 포함하지 않습니다.

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
