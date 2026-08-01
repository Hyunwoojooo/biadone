# GPTMemory

GPTMemory는 공개 ChatGPT 공유 링크를 가져와 질문, 답변, 조건 수정, 맥락
전환의 순서를 보존한 편집 가능한 개인 노트로 바꾸는 앱입니다.

엔티티 그래프나 지식 그래프를 만들지 않으며, 첫 버전은 OpenAI API 또는 외부
LLM을 호출하지 않습니다. 결정적 규칙 기반 엔진이 사용자 발화와 이어지는
assistant 응답을 시간순 section으로 묶습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

주요 검증 명령:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## 데이터

- 구조화된 노트는 Cloudflare D1 `DB` binding에 저장됩니다.
- 계정 없는 MVP에서는 브라우저가 생성한 owner key로 모든 쿼리를 분리합니다.
- 브라우저 저장소에는 owner key 같은 장치 설정만 남습니다.
- 가져온 ChatGPT 원본 HTML은 저장하거나 로그로 남기지 않습니다.
- 노트 삭제는 휴지통으로 이동하는 soft delete입니다.

## ChatGPT 공유 링크

`https://chatgpt.com/share/<id>` 형태의 공개 링크만 지원합니다. 서버는 fetch
timeout, response 크기, content type, 최종 redirect URL을 검증합니다.

Cloudflare에서 ChatGPT 직접 fetch가 차단되는 환경에서는 선택적으로 아래
환경변수를 사용해 기존 fetcher를 연결할 수 있습니다.

```text
CHATGPT_SHARE_FETCHER_URL
CHATGPT_SHARE_FETCHER_SECRET
```

자세한 제품·구현 결정은 [implementation_plan.md](./implementation_plan.md)에
기록합니다.

## 평가 데이터

강한 모델의 Teacher draft, 입력 cutoff, 사람 검수 상태는
[`evals/golden-notes/`](./evals/golden-notes/)에서 관리합니다. Teacher 요청과
답변은 저비용 모델의 평가 입력에서 항상 제외합니다.
