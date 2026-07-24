# Action Home Mockup

blabase의 Action-first 사용자 경험을 같은 합성 시나리오로 비교하는 독립형
HTML/CSS/JavaScript 목업입니다.

Strut 레퍼런스의 따뜻한 작업 캔버스, 얇은 구조선, 문서·보드 중심의 정보
위계를 blabase의 한 번 실행 경험에 맞게 재해석했습니다.

## 단일 HTML 레퍼런스

`strut-reference-ui.html`은 첨부된 Strut 화면 구성을 SABER 합성 데이터로
치환한 self-contained 목업입니다. 별도 서버 없이 파일을 브라우저로 직접
열어 확인할 수 있습니다.

## 열기

`apps/blabase`에서 아래처럼 정적 서버를 실행합니다.

```bash
python3 -m http.server 4173 --directory design-mockups/action-home
```

그다음 아래 주소를 엽니다.

- `http://127.0.0.1:4173/prototype/action-home/`
- `http://127.0.0.1:4173/prototype/action-home/?variant=focus`
- `http://127.0.0.1:4173/prototype/action-home/?variant=board`
- `http://127.0.0.1:4173/prototype/action-home/?variant=concierge`

## 비교 방향

- **Focus** — 추천 하나와 Primary CTA를 가장 크게 보여주는 방향
- **Action Board** — Topic 맥락은 남기되 Action을 우선하는 방향
- **AI Concierge** — 분석을 마친 AI 비서가 결론과 실행을 안내하는 방향

상단의 상태 메뉴에서 Recommendation, Running, Completed, Clarification,
Empty/Error를 직접 확인할 수 있습니다.

## 안전 범위

- 모든 콘텐츠는 `mock-data.js`의 합성 데이터만 사용합니다.
- API 요청, LLM 호출, 데이터베이스, 브라우저 저장소를 사용하지 않습니다.
- 복사 기능 외의 상호작용은 현재 페이지의 메모리 안에서만 동작합니다.
- `src/`, 기존 API, 분석 엔진, production 라우팅과 연결되지 않습니다.

## 파일

```text
action-home/
├─ README.md
├─ index.html
├─ mock-data.js
├─ script.js
├─ strut-reference-ui.html
├─ strut-refresh.css
├─ styles.css
├─ prototype/action-home/index.html
└─ screenshots/
```
