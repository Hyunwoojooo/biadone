# 회사 홈페이지 템플릿

승인된 ‘A 정돈된 구조’를 바탕으로 만든 정적 HTML/CSS 편집용 예시입니다. 실제 사이트 배포본이 아니며, 연락·가격·신청 기능을 포함하지 않습니다.

## 구성과 편집

- `index.html`: 회사 비전, 소개 문장, 세 단계 흐름, 프로젝트 소개와 상태를 직접 편집합니다. JavaScript 없이 내용과 메뉴가 표시됩니다.
- `style.css`: 회사 홈페이지의 구획 간격, 설명·행동 링크의 배치, 프로젝트 행과 반응형 구성을 담당합니다.
- `company.tokens.json`: 승인안의 회사 홈페이지 전용 간격·설명 너비를 원시값 → 의미 → 컴포넌트 세 층으로 관리합니다. 반복 간격은 공통 토큰을 사용합니다.
- `company.tokens.css`: 위 원본에서 생성한 파일입니다. 직접 편집하지 않습니다. `style.css`가 불러옵니다.
- `../../biadone.css`: 공통 폰트·토큰·B 균형형 로고·조판·버튼·흐름 컴포넌트를 불러옵니다. 이 템플릿에서 공통 색상·서체·로고 비율을 재정의하지 않습니다.

헤더 메뉴와 행동 링크는 `#vision`, `#projects`, `#edu`로 이동합니다. 구획의 `id`를 바꾸면 해당 `href`도 함께 바꿉니다. 제목의 `<br>`은 승인안의 첫 화면 줄 구성을 유지합니다. 문구가 길어지면 임의로 글자를 줄이기보다 문장과 줄바꿈을 먼저 정리합니다.

초기 문구는 `concepts/round-06/shared/content.json`의 회사 소개를 가져왔습니다. Blabee는 ‘나와 함께 일하는 AI를 향한 첫 번째 프로젝트’, Biadone Edu는 ‘준비 중’으로 표시합니다. 새 프로젝트를 추가할 때는 `article.company-project`를 복제하고 실제 소개와 상태를 작성합니다. 공개 여부가 확인된 실제 이동 목적지가 생기면 링크를 추가할 수 있습니다.

페이지 아래의 접합 표시는 본문과 분리된 여백에 놓여 있습니다. 이 표시를 제거해도 정보의 위치와 읽는 순서는 유지됩니다.

회사 전용 구성값을 바꾼 뒤 프로젝트 루트에서 다음 명령으로 CSS를 다시 생성합니다.

```sh
node /Users/joo/.agents/skills/design-system/scripts/generate-tokens.cjs --config design-system/templates/company/company.tokens.json -o design-system/templates/company/company.tokens.css
```

## 로컬 확인

프로젝트 루트(`/Users/joo/BiaDone/brand`)에서 정적 서버를 실행한 뒤 `/design-system/templates/company/`를 엽니다. `design-system` 전체를 함께 제공해야 공통 CSS와 로컬 SUITE·Pretendard·로고 파일의 상대 경로가 유지됩니다. 제목은 SUITE 700, 본문·메뉴·버튼은 Pretendard, 로고 이름은 Pretendard 600입니다. 별도 설치·빌드·외부 CDN은 필요하지 않습니다.

```sh
python3 -m http.server 8040 --bind 127.0.0.1
```

배포나 운영 연결은 이 템플릿의 범위에 포함하지 않습니다.
