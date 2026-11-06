# Biadone 기본 제작 키트 v0.1

[키트 보기](index.html) · [회사 홈페이지 원본](templates/company/index.html) · [Edu 원본](templates/edu/index.html)

상태: 2026-10-27. 확정한 브랜드 방향을 HTML/CSS에서 반복 제작할 수 있도록 만든 첫 적용본이다. 색상·서체·심벌·로고 조합과 A 화면 방향은 사용자 선택이며, 아래 매체별 세부값은 실제 콘텐츠를 넣으며 다듬는 시작값이다.

## 불러오기

```html
<link rel="stylesheet" href="design-system/biadone.css">
<body class="biadone-theme">
  <main class="biadone-page">…</main>
</body>
```

`biadone.css`는 로컬 폰트 → 색상·로고 토큰 → 화면 구조 토큰 → 컴포넌트 토큰 → 로고 → 컴포넌트를 불러온다. 템플릿 CSS는 페이지 구성과 반응형 배치만 담당한다. 상대 경로는 사용 위치에 맞춘다. JSON을 불러오는 Edu 템플릿은 로컬 HTTP 서버에서 열어야 한다.

제목·소제목·핵심 문장·흐름과 단계 제목은 **SUITE 700**, 본문·표·조작 요소는 **Pretendard**, 로고는 **Pretendard 600**을 사용한다. 제목의 `--heading-font-family`와 본문의 `--font-primary`, 로고의 `--logo-font-family`를 구분해 적용한다.

## 반복 요소

| 요소 | 클래스 | 기본 사용 | 내용이 늘어나면 |
| --- | --- | --- | --- |
| 큰 제목 | `.biadone-title` | SUITE 700 / 웹 48–84px, 모바일 32–48px | 자연스럽게 줄바꿈. 장문을 억지로 한 줄에 넣지 않음 |
| 구획·소제목 | `.biadone-section-title`, `.biadone-subtitle` | SUITE 700 / 28–36px, 28px | 문장 길이에 따라 높이 확장 |
| 본문·도입 | `.biadone-body`, `.biadone-lead` | 18px / 20px, 모바일 16px / 17px | 문단 단위로 늘어남 |
| 핵심 문장 | `.biadone-message` | 굵기·크기·여백으로 강조 | 한 화면의 중심 문장 하나. 세로선·장식 상자 추가 없이 사용 |
| 비교표 | `.biadone-table-scroll`, `.biadone-table` | 의미 있는 열 제목과 같은 비교 기준 | 웹 표 영역만 가로 스크롤. 고정 슬라이드는 행 단위로 분할 |
| 짧은 흐름 | `.biadone-flow` | 정사각형 시작점과 선 / 웹 3열 | 작은 화면은 세로. 항목을 잘라내지 않음 |
| 설명이 있는 단계 | `.biadone-steps` | 번호·단계 제목·설명 / 웹 2열 | 웹 세로 확장. 슬라이드는 실제 높이를 측정해 분할 |
| 출처·주석 | `.biadone-source` | 웹 14px / 슬라이드 18px | 출처를 읽을 수 있게 줄바꿈. 자료명·기관·시점·원문 연결 |
| 주요·보조 행동 | `.biadone-button`, `.biadone-link` | 최소 높이 48px, 포커스 표시 | 실제 이동은 링크, 동작은 button. 없는 흐름을 만들지 않음 |

웹 표의 스크롤 래퍼에는 `tabindex="0"`, `role="region"`, 내용을 설명하는 `aria-label`을 붙인다. 표는 `thead`와 `scope`를 사용한다. 상호작용의 상태는 기본·hover·focus-visible·active·disabled를 포함한다. `aria-disabled`는 표현만 제공하므로 링크를 비활성화할 때의 동작 처리는 적용 서비스가 맡는다.

```html
<ol class="biadone-steps">
  <li>
    <span class="biadone-step-number">01</span>
    <div><h3>목적 정리</h3><p>원하는 결과와 필수 항목을 정합니다.</p></div>
  </li>
</ol>
```

## 브랜드 조형과 내용의 관계

공식 심벌은 [원본 SVG](assets/logo/biadone-symbol.svg)를 비율 그대로 사용한다. 머리말의 접합 표시는 심벌에서 가져온 별도의 모티프다. 공식 심벌을 가로로 늘인 파일로 교체하지 않는다.

`.biadone-signature`의 초기 크기는 96×32px다. 내용 밖에 자리를 예약하고 `aria-hidden="true"`를 지정한다. 두 개의 빈 span이 면을 그린다. 표시를 생략할 때 `data-visible="false"`로 투명하게 만들면 내용 배치가 변하지 않는다. 모티프로 텍스트를 감싸거나 정보를 자르지 않는다. 크기·위치는 매체에 따라 다듬을 수 있다.

## 매체별 구성

회사 템플릿은 선택한 A의 제목·소개·행동·3단계 흐름·프로젝트 구성을 유지한다. 전체가 내용에 따라 세로로 확장한다. 운영 사이트 배포나 신청·문의 흐름은 포함하지 않는다.

Edu는 1600×900 고정 캔버스, 바깥 여백 72px를 사용한다. 제목 64px, 본문 26px, 표와 단계 설명 24px, 단계 제목 32px다. 6차의 단일 슬라이드 제목 80px와 별도로, 긴 내용의 여러 장 구성을 위한 기본값이다. 긴 내용을 넣었다고 글자를 축소하지 않는다. 뷰어 화면에 맞추는 확대·축소는 캔버스 전체의 표시 배율이다.

Edu 원본은 JSON의 내용과 HTML/CSS 표현을 분리한다. 실제 제목·본문 서체가 모두 준비된 뒤 내용 높이를 측정해 본문·표·과정을 나눈다. 표 제목과 열 제목을 반복하고 단계 번호를 이어간다. 하나의 항목도 담을 수 없으면 오류를 표시한다. 표지·요약·주석도 캔버스를 넘기는지 확인해야 한다. 자세한 편집 항목과 상태 확인은 [Edu 안내](templates/edu/README.md)를 따른다.

## 원본 수정과 확장

| 바꿀 내용 | 원본 |
| --- | --- |
| 공통 색상·서체·로고 비율 | `tokens.json` |
| 공통 여백·모서리·캔버스 | `screen-style.tokens.json` |
| 반복 요소의 조판·제어·모티프 기본값 | `components.tokens.json` |
| 컴포넌트 구조와 상태 | `components.css` |
| 매체별 배치 | `templates/` 아래의 CSS |
| 실제 문장·표·단계 | 홈페이지 HTML 또는 Edu `content.json` |

토큰은 원시값 → 의미 → 컴포넌트의 세 층으로 연결한다. 분리된 토큰 파일에서 기존 브랜드 값을 참조할 때는 CSS 변수로 연결한다. 생성 CSS를 직접 수정하지 않는다.

```sh
node /Users/joo/.agents/skills/design-system/scripts/generate-tokens.cjs --config design-system/components.tokens.json -o design-system/components.tokens.css
```

현재 범위는 공통 기초와 홈페이지·Edu HTML/CSS 기본형이다. 실제 교육 과정, 영상·SNS 템플릿, 제품 입력·오류·로딩 등 서비스 상호작용 규격과 제품별 변주는 후속 적용에서 정한다. 새 요소를 추가할 때는 내용 손실, 긴 한글·영문, 휴대폰, 키보드와 출처를 실제 예시로 확인한다.

## v0.1 확인 결과

로컬 Chromium에서 키트 안내·회사 홈페이지는 320–1600px의 6개 너비에서 페이지 넘침 없이 표시됐다. 로컬 Pretendard, 확정된 로고 비율, 목차·페이지 내 링크, 모바일 표의 키보드 스크롤과 접합 표시 생략 시 배치 유지도 확인했다.

Edu 샘플은 표지 1장·본문 2장·표 2장·과정 1장·요약 1장, 총 7장이다. 1600×900 각 장의 내용 경계를 확인했고, 본문 6문단·표 7행×4열·단계 6개가 원문과 일치했다. 본문 10배·표 28행·단계 18개로 늘린 검증에서도 내용을 보존하며 각각 해당 구획이 10장·6장·3장으로 증가했다. 분할할 수 없는 긴 단일 문장은 원문과 편집 필요 표시를 유지한다. 보기 도구의 배율·전체 보기·키보드 이동도 확인했다.

확인 범위는 로컬 HTML/CSS 렌더링이다. 다른 브라우저와 실제 원고를 적용할 때는 다시 확인한다. PowerPoint·Keynote·인쇄 출력은 이번 키트의 검증 범위에 포함하지 않는다.

SUITE 제목 채택 후 키트·홈페이지의 6개 화면 폭과 Edu를 재확인했다. 제목의 SUITE 700·본문과 로고의 Pretendard가 실제 표시되는 것을 확인했으며, Edu 예시는 7장으로 원문을 보존했다. 폰트 요청을 지연해 제목 서체를 기다리는 동작, 실패 시 대체 측정 안내, 긴 제목과 20행 표의 분할, 동시 재렌더의 마지막 요청 보존도 확인했다.
