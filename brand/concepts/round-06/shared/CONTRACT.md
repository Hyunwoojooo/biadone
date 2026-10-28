# 화면 스타일 비교의 공통 계약

각 후보는 index.html(회사 첫 화면과 프로젝트 소개)과 slide.html(1600×900 Edu 슬라이드 한 장)이다. 제작자는 자신의 후보 폴더 안의 HTML/CSS/토큰만 수정한다.

공통 자산은 shared/common.css를 가장 먼저 로드한다. 이 파일이 확정된 로컬 Pretendard, 색상 토큰, B 균형형 로고를 로드한다. 로고의 비율·서체·간격을 재정의하지 않는다. 기본 로고 크기는 세 웹 화면에서 24px이며, 강의자료에서도 같은 값으로 통일한다.

각 문구를 담는 요소에는 `data-copy="web.title"`처럼 content.json의 경로를 지정한다. 예시 문구를 임의로 더하거나 지우지 않는다. 줄바꿈은 공통 데이터의 개행으로 제공한다. 페이지 마지막에 `<script src="../shared/content.js" defer></script>`를 둔다. 준비 완료는 html의 data-content-ready="true"로 표시된다.

로고는 `<a href="#vision" data-brand-logo></a>` 또는 `<span data-brand-logo></span>`로 넣는다. 블루 바탕의 흰색은 `data-brand-logo="inverse"`다. 공통 스크립트가 확정된 원본을 삽입한다.

## 웹 필수 내용

- header: 로고, nav.vision / nav.projects / nav.edu. 링크는 #vision / #projects / #edu로 연결한다.
- #vision: h1 web.title, web.description, web.primary(#projects), web.secondary(#edu).
- 같은 메시지의 브랜드 도식: concept.understand / concept.act / concept.finish. 배열·도형·선·면으로 표현하되 실제 기능 화면처럼 꾸미지 않는다.
- #projects: web.projectsTitle, web.blabeeTitle + web.blabeeDescription, #edu의 web.eduTitle + web.eduDescription + web.eduStatus.
- footer의 회사 이름은 Biadone. 실제 문의 폼이나 신청 링크, 없는 기능은 넣지 않는다.

## Edu 필수 내용

- 로고와 edu.label.
- h1 edu.title, edu.description.
- edu.oneTitle + edu.oneDescription, edu.twoTitle + edu.twoDescription, edu.threeTitle + edu.threeDescription.
- edu.footer.
- 캔버스 1600×900, 모든 내용이 한 장에 보여야 한다. 여백·위계·도형 표현에 후보 스타일을 반영한다. 스타일 비교용 개념 슬라이드이며 정식 수업 자료가 아니다.

## 제작 제약

컬러는 기존의 #2858F0, #EEF5FF, #23314D, #FFFFFF만 사용한다. 투명도는 기존 색의 파생으로 사용할 수 있다. 칙칙한 배경이나 새 폰트를 도입하지 않는다. 제목은 Pretendard, 굵기·크기·여백으로만 인상을 다르게 만든다. 기존 심벌을 새로 그리거나 변형하지 않는다. 그림자·그라데이션·과장된 숫자·후기·고객 로고·가짜 대시보드·불필요한 상단 배지를 넣지 않는다.

작은 후보별 tokens.json에서 원시값→의미→컴포넌트를 연결하고, 설치된 design-system 스크립트로 tokens.css를 생성해 사용한다. 색상과 서체는 공통 토큰을 그대로 참조한다. 예를 들어 radius primitive→surface semantic→panel component처럼 구성한다. 파일은 각 후보 폴더 안에서만 생성한다. 공통 토큰과 이름 충돌이 없도록 후보 전용 이름을 사용한다.

웹은 320–1600px에서 읽히고 링크가 작동해야 한다. Edu는 고정된 1600×900 아트보드이며 검토 화면에서 비례 축소한다. UI 텍스트를 그림으로 만들지 않는다.
