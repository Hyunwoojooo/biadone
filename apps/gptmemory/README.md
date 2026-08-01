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

- 구조화된 노트는 권위 저장소인 Cloudflare D1 `DB` binding에 저장됩니다.
- 계정 없는 MVP에서는 브라우저가 생성한 owner key로 모든 쿼리를 분리합니다.
- 브라우저 저장소에는 owner key 같은 비권위적 장치 설정만 남고 note payload는
  중복 저장하지 않습니다.
- D1에는 편집 가능한 노트, normalized source URL, source title/message count와
  서버 내부 import provenance를 저장합니다. provenance에는 run·workflow·adapter·
  note engine·schema 버전, share ID, canonical conversation SHA-256과 fetch/generation
  시각이 포함되며 public note 응답에는 노출하지 않습니다.
- 가져온 ChatGPT 원본 HTML과 복원된 전체 대화 메시지는 저장하거나 로그로 남기지
  않습니다. 별도 `sourceSnapshot`도 만들지 않습니다.

### 보존과 삭제

- active, archive, trash 상태에서는 노트와 source URL/share ID/digest/generation
  metadata를 함께 보존합니다. 휴지통 이동은 복구 가능한 soft delete입니다.
- 휴지통의 `영구 삭제`는 별도 확인을 거쳐 owner 범위의 D1 row 전체를 즉시
  삭제합니다. 노트와 URL/share ID/digest/generation metadata가 함께 제거되며
  복구할 수 없습니다.
- owner key는 정식 로그인 인증이 아니라 bearer 성격의 장치 키입니다.
  localStorage를 지우면 기존 D1 노트에 접근할 키를 잃을 수 있으므로 현재 버전은
  localhost 또는 private access에서 사용하는 것을 전제로 합니다.

## ChatGPT 공유 링크

`https://chatgpt.com/share/<id>` 형태의 공개 링크만 지원합니다. 서버는 fetch
timeout, response 크기, content type, 최종 redirect URL을 검증합니다.

같은 owner가 동일한 normalized 공유 URL을 다시 입력하면 외부 fetch 전에 기존
노트를 찾습니다. UI는 `기존 노트 열기`, `다시 생성`, `취소`를 제공하며, 다시
생성은 사용자가 확인한 `noteId + updatedAt`이 현재 상태와 일치할 때만 갱신합니다.
가져오기 실패나 stale write에서는 기존 사용자 편집본을 보존합니다.

가져오기 adapter는 사용자에게 보이지 않는 tool call, 검색 JSON, reasoning 및
실행 로그를 노트 입력에서 제외합니다. 실제 생성 결과가 확인된 이미지·파일은
내부 URI나 저장 경로 대신 짧은 이벤트로 남깁니다. 응답의 `diagnostics`에는 정제
전후 메시지 수만 기록하며 원본 tool 내용은 포함하지 않습니다.

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
