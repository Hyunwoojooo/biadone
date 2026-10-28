# Biadone 공통 기초 v0.1

사용자가 선택한 **A 맑은 블루, SUITE 제목·Pretendard 본문과 로고, B 맞물린 두 면 심벌, B 균형형 로고 조합, A 정돈된 구조의 화면 스타일**을 공통 기초로 관리한다. 심벌은 2026-10-27 간격 약 2.83 버전으로 확정했다. 정보는 내용량에 따라 유연하게 담고 브랜드 표현은 여백과 경계에서 드러내는 방향도 확정했다.

## 선택된 팔레트

| 역할 | 값 | 토큰 |
| --- | --- | --- |
| 대표 블루 | #2858F0 | color.brand |
| 블루 위의 글자 | #FFFFFF | color.on-brand |
| 기본 바탕 | #FFFFFF | color.background |
| 밝은 블루 바탕 | #EEF5FF | color.background-tint |
| 기본 글자 | #23314D | color.text-primary |

이는 concepts/round-03의 A 팔레트다. 앞선 홈페이지 시안의 A 레이아웃이나 I 로고가 선택되었다는 의미는 아니다.

## 선택된 서체

2026-10-27 사용자가 [제목 서체 5종 비교](../concepts/round-11/index.html)의 **A · SUITE**를 선택했다. 비교에서 제시한 제목·본문 조합을 공통 기준으로 사용한다.

| 역할 | 서체·굵기 | 적용 |
| --- | --- | --- |
| 제목 | SUITE 700 | 큰 제목·구획 제목·소제목·핵심 문장·흐름과 단계 제목 |
| 본문·정보 | Pretendard 400, 강조 600 | 본문·도입·표·출처·메뉴·버튼 등 조작 요소 |
| 로고 이름 | Pretendard 600 | 확정된 B 균형형 로고 |

SUITE Variable 2.040과 Pretendard Variable의 원본 WOFF2·라이선스는 assets/fonts/에 보존했다. 제목은 `font.heading` → `heading.font-family`, 본문은 `font.primary`, 로고는 `font.logo` → `logo.font-family`로 구분한다. SUITE에 포함되지 않은 문자는 Pretendard로 보완한다.

앞선 [10차 고딕 비교](../concepts/round-10/index.html)는 검토 기록으로 보존한다. 매체별 크기와 줄 간격은 [기본 제작 키트](COMPONENTS.md)에 정리했다. 실제 콘텐츠에서 읽힘과 정보 위계를 확인하며 다듬는다.

## 공통 사용 방향

- 대표 블루는 핵심 행동과 브랜드를 식별하는 면에 사용한다.
- 밝은 바탕의 기본 글자는 ink를 사용한다.
- 넓은 블루 면에는 흰 글자를 사용한다.
- 전체 색상 사용 비중은 홈페이지, 강의자료와 콘텐츠 예시로 추가 검토한다.
- 서비스별 고유 색상과 공통 브랜드의 관계는 별도로 정한다.

## 확정된 심벌

- 형태: B 맞물린 두 면의 2차 수정안.
- SVG 캔버스: 64 × 64.
- 실제 도형의 외곽: x8–56, y8–56의 48 × 48 정사각형.
- 두 사선의 수직 간격: 2√2, 약 2.83 SVG 내부 좌표. 사용 크기에 따라 심벌과 함께 비례 확대·축소한다.
- 확정일: 2026-10-27, 사용자 선택.

기준 원본은 [블루 SVG](assets/logo/biadone-symbol.svg), [흰색 SVG](assets/logo/biadone-symbol-white.svg), [단색 SVG](assets/logo/biadone-symbol-ink.svg)다. 이 세 파일을 이후 매체와 서비스의 공통 심벌 자산으로 사용한다.

## 재사용 파일

- tokens.json: 원시값 → 용도 → 컴포넌트의 세 층을 참조로 연결한 원본.
- tokens.css: 설치된 design-system 스크립트가 원본에서 생성한 CSS 변수.
- fonts.css: 선택한 로컬 SUITE·Pretendard의 웹폰트 선언.
- assets/fonts/: 원본 글꼴과 라이선스.
- assets/logo/: 확정된 간격 2.83 심벌의 블루·흰색·단색 SVG 원본.
- logo.css: 확정된 B 균형형의 크기·간격·이름 조판을 재현하는 컴포넌트.
- SCREEN_STYLE.md: 확정된 A 화면 스타일의 정렬·여백·위계·흐름 기준.
- screen-style.tokens.json / screen-style.tokens.css: 선택한 예시에서 추출한 핵심 구조값과 생성 변수.
- biadone.css: 폰트·기초·구조·로고·반복 요소를 함께 불러오는 공통 엔트리.
- components.tokens.json / components.tokens.css / components.css: 반복 요소의 세 층 토큰·생성 변수·공통 구현.
- [기본 제작 키트](index.html), [사용 가이드](COMPONENTS.md), templates/: 편집 가능한 홈페이지와 Edu HTML/CSS 원본.

```css
@import "./biadone.css";

.brand-action {
  background: var(--button-bg);
  color: var(--button-fg);
  font-family: var(--button-font-family);
}
```

기본 버튼은 4px 모서리, 최소 높이 48px, 기본·hover·focus-visible·active·disabled 상태를 사용한다. 제품의 입력·오류·로딩 등 전체 상호작용 규격은 별도 적용 단계에서 추가한다.

## 확정된 기본 로고 조합

2026-10-27 사용자가 5차 비교의 **B 균형형**을 선택했다.

- 이름: Biadone, Pretendard 600, 자간 -0.04em.
- 심벌 외곽 높이: 글자 크기의 11/12.
- 심벌과 글자 상자 사이 거리: 글자 크기의 1/3.
- 글자 크기 48px 예시: 심벌 44px, 간격 16px.
- 작은 예시의 글자 크기 20px: 심벌 약 18.33px, 간격 약 6.67px.
- 큰 크기와 작은 크기에서 같은 비율을 유지한다. 심벌 내부 간격의 원본 좌표 2.83은 그대로다.

아래 구조에 fonts.css, tokens.css, logo.css를 함께 적용한다. `--biadone-logo-size`는 이름의 글자 크기이며 사용 매체에 맞춰 설정한다.

```html
<a class="biadone-logo" href="/" aria-label="Biadone">
  <span class="biadone-logo__symbol">
    <img src="design-system/assets/logo/biadone-symbol.svg" width="64" height="64" alt="">
  </span>
  <span class="biadone-logo__name" aria-hidden="true">Biadone</span>
</a>
```

블루 바탕에서는 흰색 심벌 파일과 `biadone-logo--inverse`를 함께 사용한다. 단색 표시에는 ink 심벌 파일을 사용한다.

재사용 컴포넌트는 글자 크기 48px와 20px에서 선택된 B 시안과 렌더링 이미지가 동일한 것을 확인했다. 토큰 사용 검사도 통과했다.

## 갱신

```sh
node /Users/joo/.agents/skills/design-system/scripts/generate-tokens.cjs --config /Users/joo/BiaDone/brand/design-system/tokens.json -o /Users/joo/BiaDone/brand/design-system/tokens.css
```

## 다음 결정

전체 화면 스타일은 **A 정돈된 구조**, 정보와 브랜드 표현은 **가변 정보 영역·여백과 경계의 모티프** 방향으로 확정했다. [공통 화면 기준](SCREEN_STYLE.md)에 반영했다. 제목·본문·비교표·과정·출처와 홈페이지·Edu HTML/CSS 기본형은 [제작 키트 v0.1](index.html)에 구현했다. 다음은 실제 원고 적용, 로고 보호 여백·최소 크기, 영상·SNS와 제품별 변주 규칙을 구체화한다.

