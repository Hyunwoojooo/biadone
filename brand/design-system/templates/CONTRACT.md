# 기본 제작 키트 v0.1 계약

공통 방향은 A 정돈된 구조이며, 내용은 유연하게 담고 브랜드 특징은 여백·경계에서 드러낸다. 제목은 SUITE 700, 본문·표·조작 요소는 Pretendard, 로고 이름은 Pretendard 600이다. 색상·심벌·B 균형형 로고 원본은 이미 확정되었다. 일반 세로선 강조·색상 박스·괄호를 브랜드 고유의 그래픽으로 재제안하지 않는다. 기본 정보 구조의 가독성과 내용 완전성이 우선이다.

루트 작업자는 design-system/biadone.css, components.css, components.tokens.json/css와 안내 페이지·문서를 담당한다. 템플릿 작업자는 자신에게 배정된 하위 폴더만 수정한다. 서로의 변경을 되돌리지 않는다.

## 공통 엔트리

각 템플릿에서 ../../biadone.css를 로드한다. 이 파일이 폰트, 기초 토큰, 화면 구조 토큰, 로고, 컴포넌트를 모두 로드한다. body에 biadone-theme를 지정한다. 색상·서체·로고 비율을 하위 템플릿에서 재정의하지 않는다.

로고 구조:

```html
<span class="biadone-logo" role="img" aria-label="Biadone">
  <span class="biadone-logo__symbol"><img src="../../assets/logo/biadone-symbol.svg" width="64" height="64" alt=""></span>
  <span class="biadone-logo__name" aria-hidden="true">Biadone</span>
</span>
```

접합 표시 구조:

```html
<span class="biadone-signature" aria-hidden="true"><span></span><span></span></span>
```

## 공통 클래스

- .biadone-page: 최대1280px, 데스크톱 좌우48px / 모바일24px의 영역.
- .biadone-site-header: 회사 메뉴용 헤더(112px 시작), 로고와 nav. .biadone-nav: 메뉴 묶음.
- .biadone-header: 문서/슬라이드 머리말. 로고·매체 이름·접합 표시를 배치.
- .biadone-title: SUITE 700 웹 큰 제목(48–84px, 좁은 화면32–48px), 줄간격1.19 / 자간-0.052em.
- .biadone-section-title: 구획 제목(28–36px).
- .biadone-subtitle: 프로젝트·하위 구획 제목(데스크톱28px / 모바일25px).
- .biadone-body: 웹 본문18px / 모바일16px, 줄간격1.8.
- .biadone-lead: 도입 본문20px / 모바일17px.
- .biadone-message: 핵심 문장, 장식 틀 없이 조판 위계로 강조.
- .biadone-button: 기본 행동. .biadone-link: 보조 행동.
- .biadone-section: 구획의 세로 여백.
- .biadone-table-scroll + table.biadone-table: 웹 표. 4열 기준으로720px 아래에서는 표 영역만 가로 스크롤. 스크롤 영역에 tabindex=0, role=region, aria-label을 붙인다.
- ol.biadone-steps > li: .biadone-step-number와 div(h3+p) 구조. 웹2열 / 모바일1열.
- ol.biadone-flow > li: .biadone-flow-marker[aria-hidden=true] + p. 짧은 흐름은 웹3열 / 모바일1열, 작은 정사각형과 얇은 선으로 연결한다.
- .biadone-source: 출처·주석. 없거나 확인하지 않은 근거를 꾸며 넣지 않는다.
- .biadone-slide: 1600×900 고정 아트보드, padding72px, header / .biadone-slide-content / footer 구조. 내용 영역은 clipping하지 않는다.
- 슬라이드 안의 h1.biadone-title은64px / 1.2, 본문은26px / 1.6, 표는24px. 글자를 줄이지 말고 실제 크기를 측정해 페이지를 나눈다.
- .biadone-slide .biadone-steps는3열, 번호24px, 제목32px, 본문24px. 각 페이지의 실제 내용에 따라 더 적은 항목으로 나눌 수 있다.

이 목록과 실제 CSS가 충돌하면 루트에게 알려 조율한다. 네이밍을 임의로 대체하지 않는다.

## 내용과 상태

샘플 교육 문구는 content.json으로 관리하고 예시임을 밝힌다. 회사 사이트는 현재 사실(Blabee 첫 프로젝트, Edu 준비 중, 장기 비전)을 따른다. 가짜 지표·후기·파트너 로고·사용 중이라고 확인되지 않은 기능을 넣지 않는다. 실제 연락처나 신청 흐름을 새로 만들지 않는다.

새 npm 의존성·폰트 설치·Git 커밋·배포는 하지 않는다. 루트가 전체 브라우저 검토를 수행한다.
