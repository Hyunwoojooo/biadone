# blabase Design Mockups

이 폴더는 blabase의 제품·UI 방향을 비교하기 위한 디자인 목업 전용 공간입니다.
`src/` 아래의 실제 애플리케이션 코드와 분리해서 관리합니다.

## 원칙

- 실제 분석 API, LLM, 데이터베이스와 연결하지 않습니다.
- 합성된 mock data만 사용합니다.
- 각 목업은 독립된 하위 폴더에 저장합니다.
- 목업에서 사용하는 코드와 asset은 해당 하위 폴더 안에 둡니다.
- 실제 제품에 반영하기 전에는 `src/`로 코드를 옮기지 않습니다.
- API 키, 실제 대화, 사용자 데이터는 저장하지 않습니다.

## 권장 구조

```text
design-mockups/
├─ README.md
└─ <mockup-name>/
   ├─ README.md
   ├─ index.html
   ├─ styles.css
   ├─ script.js
   ├─ assets/
   └─ screenshots/
```

React/Next.js 기반 목업이 필요한 경우에도 먼저 해당 목업 폴더에 설계와 mock
data를 보관하고, 실제 앱 라우트 연결은 별도 작업으로 분리합니다.
