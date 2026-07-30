# GPTMemory 구현 계획

> 상태: Implementing v0.2
> 작성일: 2026-07-29
> 대상 경로: `apps/gptmemory/`

## 0. 구현 시 확정된 변경

2026-07-29 구현을 시작하며 다음 결정을 확정했다. 아래 초안에 남아 있는
LLM·IndexedDB 관련 설명보다 이 절이 우선한다.

- OpenAI API와 외부 LLM을 첫 버전에서 제외한다.
- 노트 엔진은 대화 순서, 사용자 요청, 조건 수정, 맥락 전환, 이어진 응답을
  결정적 규칙으로 묶는다.
- 엔티티, 관계, 결정, 액션, 감정, 숨은 의도는 추출하지 않는다.
- 노트는 Sites의 Cloudflare D1에 저장한다.
- 계정 없는 MVP에서는 브라우저가 만든 충분히 긴 owner key로 모든 D1 쿼리를
  분리한다. 이는 정식 인증을 대체하지 않으므로 배포는 private access를 기본으로
  한다.
- 브라우저 저장소는 owner key 같은 비권위적 장치 설정에만 사용한다.
- 별도 요약 라이브러리 없이 Node 기본 테스트 러너와 순수 TypeScript를 사용한다.
- 실제 구현 디렉터리는 starter 구조에 맞춰 `app/`, `components/`, `lib/`,
  `db/`를 사용한다.

## 1. 제품 정의

GPTMemory는 ChatGPT 공유 링크의 대화를 가져와, 대화의 시간적 흐름과
맥락 변화를 읽기 좋은 하나의 노트로 정리하는 개인 노트 앱이다.

이 제품의 분석 단위는 Entity, Relation, Decision Graph가 아니다. 핵심 질문은
다음과 같다.

1. 대화가 무엇에서 시작됐는가?
2. 어떤 질문과 답변이 이어졌는가?
3. 사용자가 언제 조건을 추가하거나 방향을 수정했는가?
4. 각 맥락이 다음 맥락으로 왜 넘어갔는가?
5. 대화는 마지막에 어떤 상태에 도달했는가?

최종 결과는 분석 콘솔이나 그래프가 아니라, 사용자가 다시 읽고 직접 수정할 수
있는 서술형 노트여야 한다.

### 제품 한 문장

> ChatGPT 대화를 시간순 맥락이 보존된 편집 가능한 노트로 바꾼다.

## 2. 목표와 비목표

### 2.1 MVP 목표

- 공개 ChatGPT 공유 URL을 입력받는다.
- 공유 페이지에서 사용자에게 보인 대화를 복원한다.
- tool, system, reasoning, 내부 메시지를 노트 입력에서 제외한다.
- 긴 대화를 시간순 구간으로 나눈다.
- 각 구간의 질문, 답변, 수정, 전환을 서술형 문단으로 정리한다.
- 구간 노트를 하나의 일관된 최종 노트로 합친다.
- 생성된 제목과 본문을 사용자가 직접 편집할 수 있게 한다.
- 노트를 D1에 영구 저장하고 목록, 검색, 태그, 즐겨찾기, 보관,
  휴지통을 제공한다.
- 노트에서 원문 대화 범위를 필요할 때만 확인할 수 있게 한다.

### 2.2 명시적 비목표

- Entity Graph 또는 Knowledge Graph 생성
- Entity와 Relation 추출
- Rule/LLM 결과 비교 콘솔
- Review Queue와 Extraction Diagnostics UI
- 사용자의 숨은 의도, 성향, 감정 추론
- 대화에 없는 다음 행동이나 추천 생성
- 여러 대화 사이의 자동 연결 및 지식 병합
- 실시간 ChatGPT 계정 연동
- 비공개 `chatgpt.com/c/...` 대화 가져오기
- 첫 MVP에서의 계정, 팀 공유, 여러 기기 동기화
- 첫 MVP에서의 완전한 리치 텍스트 편집기

대화 안에 실제로 결정, 변경, 열린 질문이 존재하는 경우에는 노트의 자연스러운
문맥으로 보존할 수 있다. 그러나 이를 독립적인 분석 보드나 추천 항목으로
재구성하지 않는다.

## 3. 사용자 경험

### 3.1 기본 화면

참고 이미지처럼 데스크톱에서는 3단 레이아웃을 사용한다.

```text
┌──────────────┬──────────────────────┬─────────────────────────────┐
│ 탐색 사이드바 │ 노트 목록             │ 선택한 노트                  │
│              │                      │                             │
│ All Notes    │ 제목                 │ 제목                         │
│ Favorites    │ 한 줄 미리보기        │ 본문                         │
│ Archive      │ 수정 시각 · 태그       │                             │
│ Trash        │                      │ 원문 보기 · 편집              │
│ Tags         │                      │                             │
└──────────────┴──────────────────────┴─────────────────────────────┘
```

- 좌측 상단의 `+` 버튼은 ChatGPT URL 가져오기 창을 연다.
- 가운데 목록은 기본적으로 `updatedAt` 내림차순으로 정렬한다.
- 우측은 읽기 모드가 기본이며 `Edit`으로 제목과 본문을 수정한다.
- 원문은 기본 화면에 노출하지 않고 `원문 대화 보기`에서만 연다.
- 모바일에서는 `탐색 → 목록 → 상세` 순서의 단일 패널 내비게이션으로 바꾼다.

### 3.2 주요 사용자 흐름

#### 첫 노트 가져오기

```text
빈 화면
→ URL 가져오기
→ 링크 검증
→ 대화 복원
→ 노트 작성
→ IndexedDB 저장
→ 생성된 노트 상세 화면
```

#### 기존 노트 열기

```text
All Notes
→ 검색 또는 목록 선택
→ 노트 읽기
→ 필요 시 편집
→ 자동 저장
```

#### 같은 공유 링크 다시 가져오기

- 정규화된 공유 URL 또는 share ID로 기존 노트를 찾는다.
- 조용히 중복 노트를 만들지 않는다.
- 기존 노트를 보여주고 `다시 생성` 또는 `취소`를 선택하게 한다.
- 다시 생성에 실패해도 기존 사용자 편집본을 보존한다.

## 4. blabase 재사용 경계

### 4.1 재사용할 부분

다음 코드는 기능과 테스트를 유지하면서 GPTMemory로 옮기거나 향후 공통
패키지로 분리한다.

- `apps/blabase/src/core/adapters/chatgpt-share/`
  - URL 검증과 정규화
  - 직접 fetch 및 인증된 외부 Fetcher
  - `streamController.enqueue` payload 추출
  - React Flight row/table 복원
  - 참조 해제
  - `linear_conversation` 메시지 복원
- `CanonicalConversation`과 `CanonicalMessage`의 핵심 계약
- clean/context/internal 메시지 분류 로직
- ChatGPT Fetcher의 Bearer 인증 방식과 body-size 제한
- 긴 입력을 나누고 병렬 처리하는 기본 아이디어
- Golden baseline의 segment/reduce 세션 요약 방식
- 외부 LLM 응답을 Zod와 JSON Schema로 검증하는 방식

참고 원본:

- `apps/blabase/src/core/adapters/chatgpt-share/index.ts`
- `apps/blabase/src/core/types/conversation.ts`
- `apps/blabase/src/core/golden-baseline/prompts.ts`
- `apps/blabase/tools/run-golden-baseline.ts`

### 4.2 재사용하지 않을 부분

- `mockStructureExtractor.ts`
- `ruleSemanticAdapter.ts`
- 기존 12-Type `SemanticItem` 계약
- `llmShadowPrompt.ts`
- `EvidenceVerifier`의 타입별 의미 검증
- Entity Graph와 Hybrid Structure
- Extraction Monitor와 Review Queue
- Golden Sheet 등록 UI
- 서버 전역 `MemoryAnalysisStore`
- 전체 분석 결과를 `sessionStorage`에 전달하는 Monitor payload

기존 LLM provider 코드는 그대로 복사하지 않고, 특정 Semantic Item Schema에
결합된 부분을 제거한 범용 Structured Output 인터페이스로 작게 다시 만든다.

### 4.3 공유 코드 전략

MVP에서는 blabase의 동작을 깨뜨리지 않기 위해 GPTMemory 내부에 필요한
어댑터를 독립적으로 포팅한다. 포팅 시 원본 테스트 fixture와 adapter version을
함께 가져온다.

두 앱에서 실제 변경이 반복되기 시작하면 별도 작업으로
`packages/chatgpt-share/`를 만들고 양쪽 앱이 같은 패키지를 사용하도록 전환한다.
첫 구현부터 blabase import 경로를 직접 참조하지 않는다.

## 5. 제안 기술 구조

### 5.1 애플리케이션

- Next.js App Router
- React
- TypeScript
- Cloudflare D1
- Node 기본 테스트 러너
- 전역 design token CSS

초기 버전은 blabase와 호환되는 Next.js, React, TypeScript 버전을 사용해
저장소 내 운영 편차를 줄인다. 루트에는 package manager가 없으므로
`apps/gptmemory/package.json`이 독립적으로 명령을 제공한다.

예상 명령:

```text
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

새 의존성은 다음 원칙으로 제한한다.

- 아이콘은 새 의존성 없이 텍스트와 CSS로 구성한다.
- D1 접근은 준비된 쿼리와 owner scope를 강제하는 작은 repository 뒤에 둔다.
- 본문은 구조화된 plain-text section으로 저장하고 단순 편집 모드를 사용한다.
- 리치 텍스트와 Markdown renderer는 실제 필요가 확인된 뒤
  별도 근거와 함께 추가한다.

### 5.2 디렉터리 초안

```text
apps/gptmemory/
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  └─ notes/
│  │  │     └─ import/
│  │  │        └─ route.ts
│  │  ├─ global.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  ├─ components/
│  │  ├─ AppShell.tsx
│  │  ├─ Sidebar.tsx
│  │  ├─ NoteList.tsx
│  │  ├─ NoteDetail.tsx
│  │  ├─ NoteEditor.tsx
│  │  ├─ ImportDialog.tsx
│  │  └─ SourceConversationDrawer.tsx
│  ├─ core/
│  │  ├─ adapters/
│  │  │  └─ chatgpt-share/
│  │  ├─ notes/
│  │  │  ├─ schemas.ts
│  │  │  ├─ filterConversation.ts
│  │  │  ├─ segmentConversation.ts
│  │  │  ├─ prompts.ts
│  │  │  ├─ generateSegmentNotes.ts
│  │  │  ├─ reduceConversationNote.ts
│  │  │  ├─ renderNoteMarkdown.ts
│  │  │  └─ generateConversationNote.ts
│  │  ├─ providers/
│  │  │  └─ structuredLlmProvider.ts
│  │  └─ storage/
│  │     ├─ noteRepository.ts
│  │     └─ indexedDbNoteRepository.ts
│  └─ hooks/
│     └─ useNotes.ts
├─ tests/
│  ├─ fixtures/
│  ├─ integration/
│  └─ unit/
├─ implementation_plan.md
├─ package.json
├─ tsconfig.json
└─ vitest.config.ts
```

## 6. 핵심 데이터 계약

### 6.1 생성 결과

LLM의 최종 출력은 Markdown 한 덩어리만 받지 않고 구조화된 노트로 받는다.
화면 표시와 사용자 편집을 위해 Markdown으로 projection할 수 있다.

```ts
type ConversationNoteDraft = {
  title: string;
  overview: string;
  sections: Array<{
    heading: string;
    narrative: string;
    startMessageIndex: number;
    endMessageIndex: number;
    sourceMessageIndexes: number[];
  }>;
  closingState: string;
  suggestedTags: string[];
};
```

필드 의미:

- `title`: 대화 전체를 나타내는 짧고 구체적인 제목
- `overview`: 이 대화가 무엇을 다뤘고 어디까지 갔는지 설명하는 짧은 도입
- `sections`: 시간순으로 읽히는 대화 구간
- `heading`: 해당 구간의 맥락을 나타내는 제목
- `narrative`: 질문, 답변, 수정, 전환을 자연스럽게 연결한 서술
- `closingState`: 마지막 시점에 확인 가능한 현재 상태
- `suggestedTags`: 노트 탐색용 최소 태그이며 Entity 추출 결과가 아님

각 section은 원문 message index를 보존하지만, 일반 읽기 화면에는 번호를
노출하지 않는다.

### 6.2 저장 레코드

```ts
type NoteRecordV1 = {
  schemaVersion: "gptmemory-note.v1";
  id: string;
  title: string;
  overview: string;
  bodyMarkdown: string;
  sections: Array<{
    id: string;
    heading: string;
    narrative: string;
    startMessageIndex: number;
    endMessageIndex: number;
    sourceMessageIndexes: number[];
  }>;
  closingState: string;
  tags: string[];
  favorite: boolean;
  status: "active" | "archived" | "deleted";
  source: {
    type: "chatgpt_share_link";
    originalUrl: string;
    normalizedUrl: string;
    shareId: string;
    importedAt: string;
    adapterVersion: string;
  };
  sourceSnapshot: {
    messages: Array<{
      id: string;
      index: number;
      role: "user" | "assistant";
      createdAt: string | null;
      text: string;
    }>;
  };
  generation: {
    provider: string;
    model: string;
    promptVersion: string;
    generatedAt: string;
    status: "completed";
  };
  createdAt: string;
  updatedAt: string;
};
```

`sourceSnapshot`은 원문 보기와 재생성을 위해 브라우저 IndexedDB에만 저장한다.
서버에는 영구 저장하지 않는다.

향후 원문을 저장하지 않는 privacy mode가 필요하면 `sourceSnapshot`을 optional로
변경하고 삭제 시 파생 데이터와 함께 제거한다.

### 6.3 저장소 인터페이스

UI는 IndexedDB 구현에 직접 결합하지 않는다.

```ts
interface NoteRepository {
  list(filter?: NoteFilter): Promise<NoteRecordV1[]>;
  get(id: string): Promise<NoteRecordV1 | null>;
  findByShareId(shareId: string): Promise<NoteRecordV1 | null>;
  create(note: NoteRecordV1): Promise<void>;
  update(id: string, patch: NotePatch): Promise<NoteRecordV1>;
  moveToTrash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  deletePermanently(id: string): Promise<void>;
}
```

이를 통해 나중에 IndexedDB를 D1 또는 다른 서버 저장소로 교체하더라도 화면 계약을
유지한다.

## 7. 대화에서 노트로 변환하는 파이프라인

### 7.1 전체 흐름

```text
shareUrl
→ validateShareUrl
→ fetchShareHtml
→ restoreConversation
→ normalizeConversation
→ user turn과 연속 assistant 응답 묶기
→ correction / transition 흐름 분류
→ plain-text section 작성
→ closing state 작성
→ D1에 NoteRecord 저장
```

첫 버전은 외부 모델을 호출하지 않는다. 한 user turn과 뒤따르는 assistant
응답들을 하나의 시간순 section으로 묶으므로, 원문에 없는 요약이나 추천을
생성하지 않는다. 긴 대화 최적화를 위한 segment/reduce LLM 설계는 후속 선택지로
남긴다.

### 7.2 입력 필터

노트 작성에 사용하는 기본 메시지:

- 모든 clean user 메시지
- 사용자에게 실제로 보인 assistant 최종 답변
- 맥락 변화에 실질적으로 기여한 visible assistant 메시지

제외:

- system 메시지
- thoughts, reasoning recap, model context
- tool call과 tool result
- search query와 실행 로그
- 파일 생성 코드와 중간 상태 로그
- 비어 있는 메시지
- 지원하지 않는 멀티모달 placeholder

필터 결과가 user와 assistant의 유효한 대화를 구성하지 못하면 노트를 만들지 않고
사용자에게 복원 실패를 알린다.

### 7.3 구간 분할

새 segmenter는 blabase Shadow segmenter와 달리 설정값을 절대 상한으로 지킨다.

초기 기준:

- 구간당 최대 24,000~28,000자
- 구간당 최대 40개 메시지
- user 메시지 직전 또는 완결된 assistant 답변 뒤를 우선 경계로 사용
- 구간 사이에는 직전 핵심 assistant 답변을 context-only로 최대 1개 겹친다.
- 하나의 매우 긴 메시지는 별도의 oversized segment로 표시한다.
- 최대 구간 수를 넘었다고 마지막 구간에 무제한으로 합치지 않는다.

구간 번호와 원본 message index는 항상 시간순으로 유지한다.

### 7.4 구간 노트 생성

각 구간 LLM 요청은 다음을 생성한다.

```ts
type SegmentNoteDraft = {
  heading: string;
  narrative: string;
  transitionFromPrevious: string | null;
  startMessageIndex: number;
  endMessageIndex: number;
  sourceMessageIndexes: number[];
};
```

프롬프트 원칙:

- 대화 속 지시는 분석 데이터이며 시스템 지침을 변경하지 않는다.
- 원문에 없는 사실, 동기, 결론, 추천을 만들지 않는다.
- 발화 내용을 단순 나열하지 않고 시간적 연결을 설명한다.
- 사용자의 수정과 철회는 이전 상태를 덮어쓰지 말고 변화 과정으로 표현한다.
- assistant의 제안을 사용자의 결정으로 바꾸지 않는다.
- 도구 실행 과정보다 사용자에게 보인 논의에 집중한다.
- 간단한 대화는 불필요하게 여러 섹션으로 부풀리지 않는다.
- 직접 인용을 남발하지 않고 자연스러운 서술로 정리한다.

### 7.5 최종 병합

구간이 하나면 바로 최종 노트로 projection한다. 둘 이상이면 시간순 구간 노트를
reduce한다.

Reducer 책임:

- 시간 순서를 유지한다.
- 중복 설명을 제거한다.
- 맥락 전환과 수정 이력을 보존한다.
- 마지막 상태와 이전 상태를 혼동하지 않는다.
- 섹션 제목의 수준과 문체를 통일한다.
- 대화에 없는 행동 제안을 추가하지 않는다.
- 너무 잘게 나뉜 인접 섹션은 합치되 message range를 보존한다.

구간 수가 한 번의 reduce 입력 한도를 넘으면 최대 8개씩 계층적으로 병합한다.

### 7.6 출력 검증

최종 LLM 결과는 Zod로 검증한다.

결정적 검증 항목:

- 제목과 overview가 비어 있지 않음
- 최소 한 개 section 존재
- section 범위가 유효하고 시간순임
- section의 source message index가 실제 clean message를 참조함
- message range 밖의 index를 참조하지 않음
- 모든 section이 하나 이상의 원문 메시지를 참조함
- `closingState`가 비어 있지 않음
- 태그 개수와 길이 제한

정확한 인용문 span을 강제하지 않는다. 이 제품은 Evidence 심사 UI가 아니라
서술형 노트가 목적이기 때문이다. 대신 section 단위의 원문 범위 연결만
결정적으로 확인한다.

### 7.7 실패 정책

- URL/fetch/parse 실패: 노트를 저장하지 않는다.
- segment 요청 실패: timeout 후 제한된 횟수만 재시도한다.
- 재시도 후 segment 누락: 불완전한 노트를 조용히 저장하지 않는다.
- reduce/schema 실패: 노트를 저장하지 않고 다시 시도할 수 있게 한다.
- 재생성 실패: 기존 노트와 사용자 편집 내용을 그대로 보존한다.
- LLM 응답 일부가 유효하더라도 최종 계약을 통과하지 않으면 completed로 처리하지
  않는다.

## 8. API 계약

### 8.1 노트 가져오기

```text
POST /api/notes/import
Content-Type: application/json

{
  "shareUrl": "https://chatgpt.com/share/..."
}
```

서버 책임:

1. 요청 크기와 URL을 검증한다.
2. 공유 대화를 가져와 복원한다.
3. 노트용 메시지를 선별한다.
4. 구간 요약과 최종 reduce를 실행한다.
5. 구조화된 note draft와 source snapshot을 반환한다.
6. 대화 또는 노트를 서버에 영구 저장하지 않는다.

성공 응답:

```ts
type ImportNoteResponse = {
  status: "completed";
  draft: ConversationNoteDraft;
  source: NoteRecordV1["source"];
  sourceSnapshot: NoteRecordV1["sourceSnapshot"];
  generation: NoteRecordV1["generation"];
  warnings: Array<{
    code: string;
    message: string;
  }>;
};
```

클라이언트가 응답을 `NoteRecordV1`로 완성하고 IndexedDB에 저장한다.

### 8.2 오류 코드

초기 오류 코드는 사용자 조치 가능성을 기준으로 구분한다.

```text
INVALID_REQUEST
INVALID_SHARE_URL
SHARE_LINK_NOT_ACCESSIBLE
SHARE_LINK_DELETED
CHATGPT_PAYLOAD_CHANGED
CONVERSATION_NOT_FOUND
NO_VISIBLE_MESSAGES
NOTE_GENERATION_TIMEOUT
NOTE_GENERATION_FAILED
NOTE_OUTPUT_INVALID
RATE_LIMITED
```

외부 Fetcher 설정 실패나 LLM provider 장애를 모두 HTTP 400으로 감추지 않는다.
입력 오류, upstream 오류, 서버 설정 오류를 적절한 4xx/5xx로 분리한다.

### 8.3 동기 실행 범위

MVP는 하나의 요청에서 가져오기와 노트 생성을 완료한다. 다음 조건이 실제 운영에서
문제가 되면 async job으로 전환한다.

- 긴 대화에서 반복적으로 요청 제한 시간을 넘김
- 재시도 때문에 사용자가 지나치게 오래 기다림
- 브라우저가 요청을 중단한 뒤 결과를 복구해야 함

async 전환 전까지 UI는 `대화 가져오기 → 맥락 정리 → 노트 작성` 상태를
순차적으로 보여주되, 실제 완료되지 않은 단계를 완료됐다고 표시하지 않는다.

## 9. 로컬 저장과 편집

### 9.1 IndexedDB

MVP 기본안은 브라우저 local-first다.

- 노트와 source snapshot은 IndexedDB에 저장한다.
- 전체 payload를 `sessionStorage`에 중복 저장하지 않는다.
- 스키마 버전을 저장하고 migration 함수를 둔다.
- share ID에 인덱스를 두어 중복 import를 감지한다.
- title, overview, body, tags의 정규화된 검색 문자열을 함께 관리한다.
- 휴지통은 soft delete이며 영구 삭제 시 source snapshot도 함께 제거한다.

### 9.2 편집

- 제목, overview, 본문, 태그를 편집할 수 있다.
- 일정 debounce 후 자동 저장한다.
- 저장 중, 저장 완료, 저장 실패 상태를 표시한다.
- 생성된 구조와 사용자가 편집한 본문을 구분할 수 있게 `updatedAt`을 갱신한다.
- 재생성은 사용자 편집을 조용히 덮어쓰지 않는다.
- 재생성 시 새 draft를 비교하거나 별도 revision으로 저장하는 기능은 후속 단계로
  둔다.

### 9.3 검색과 필터

MVP 검색 대상:

- 제목
- overview
- 본문
- 태그

필터:

- All Notes
- Favorites
- Archive
- Trash
- Tag

초기에는 IndexedDB 전체 목록을 읽어 정규화된 문자열로 검색한다. 노트 수가
커져 성능 문제가 측정되면 별도 search index를 도입한다.

## 10. 개인정보와 보안

ChatGPT 공유 링크는 공개 URL이어도 개인적이거나 민감한 대화를 포함할 수 있다.

필수 원칙:

- 가져오기 전에 clean conversation이 선택한 LLM provider로 전송됨을 알린다.
- API key와 Fetcher secret을 브라우저에 노출하지 않는다.
- 서버 로그에 공유 URL, 대화 원문, 생성된 노트 본문을 남기지 않는다.
- 서버는 원문과 노트를 영구 저장하지 않는다.
- OpenAI/Gemini 등 provider가 지원하는 경우 `store: false`를 사용한다.
- 모든 provider 요청에 timeout을 적용한다.
- redirect 후 최종 URL의 protocol과 hostname을 다시 확인한다.
- Fetcher 응답에도 앱 측 body-size 제한을 다시 적용한다.
- debug fetch/payload route는 production에 노출하지 않는다.
- 공개 배포 전 인증 또는 접근 제한과 rate limit을 적용한다.
- 삭제 시 로컬 note, source snapshot, 파생 검색 데이터를 함께 제거한다.
- 사용자 대화를 Golden Dataset이나 모델 개선 자료로 자동 수집하지 않는다.

local-first는 서버 저장을 줄이지만 브라우저 IndexedDB에는 평문 데이터가
남는다. 공유 기기 사용자는 브라우저 프로필에 접근 가능한 다른 사람에게 노트가
보일 수 있음을 개인정보 안내에 명시한다.

## 11. 테스트 전략

### 11.1 어댑터 단위 테스트

blabase fixture와 테스트를 포팅하고 다음을 보강한다.

- 정상 공유 URL과 query 제거
- 비공개 대화 URL 및 다른 hostname 거부
- direct fetch timeout, 404, 403, non-HTML, body limit
- external Fetcher 성공, 인증 실패, malformed response, timeout
- React Flight row와 flat table
- 복수 `linear_conversation` 후보
- empty-after-normalize
- unsupported multimodal 경고
- redirect 최종 hostname 검증

실제 최신 ChatGPT 공유 HTML의 변경을 확인할 수 있는 수동 또는 제한된 contract
check를 별도로 두되, 일반 unit test가 네트워크에 의존하지 않게 한다.

### 11.2 노트 엔진 단위 테스트

- clean user/assistant 필터
- tool/internal/system 제외
- hard character/message cap
- 시간순 segment 생성
- oversized 단일 메시지 처리
- context overlap
- section 범위 및 source index 검증
- segment output schema
- final note output schema
- reducer의 중복 제거
- 수정/철회 흐름 보존
- 사용자 결정과 assistant 제안의 혼동 방지
- 원문에 없는 추천을 만들지 않는 prompt fixture

### 11.3 API 통합 테스트

외부 fetch와 LLM을 mock한다.

- URL → note draft 성공
- parser 실패
- visible message 없음
- 일부 segment 재시도 성공
- segment 영구 실패 시 저장 가능한 결과를 반환하지 않음
- invalid structured output
- timeout
- 서버 로그와 응답에 secret이 포함되지 않음
- malformed JSON과 body-size 오류

### 11.4 저장소 테스트

- create/get/update/list
- share ID 중복 탐지
- favorite/archive/trash 필터
- soft delete/restore/permanent delete
- schema migration
- source snapshot 동반 삭제
- reload 후 노트 복구

### 11.5 UI 검증

- 빈 상태
- URL import 진행 및 오류
- 3단 레이아웃
- 목록 선택
- 제목/본문 편집과 자동 저장
- 검색과 태그 필터
- favorite/archive/trash
- source conversation drawer
- 키보드 탐색과 focus 상태
- 390px 모바일 레이아웃
- 1440px 데스크톱 레이아웃

필요성이 확인되면 후속 단계에서 Playwright를 추가한다. 추가할 경우 브라우저
reload, IndexedDB persistence, import mock flow를 E2E로 검증하기 위한 의존성임을
기록한다.

## 12. 구현 단계

### Phase 0. 프로젝트 골격과 계약

작업:

- Next.js/TypeScript/Vitest 프로젝트 구성
- lint, typecheck, test, build 명령 구성
- 기본 App Shell과 design tokens 구성
- `ConversationNoteDraft`, `NoteRecordV1`, API schema 작성
- provider와 repository interface 작성
- 환경변수 예제와 개인정보 안내 초안 작성

완료 기준:

- 빈 앱 build, typecheck, lint, test 통과
- 모든 데이터 계약이 Zod로 검증됨
- Entity/Relation/Graph 타입이 제품 계약에 없음

### Phase 1. ChatGPT 공유 대화 복원

작업:

- chatgpt-share adapter 포팅
- CanonicalConversation 최소 타입 포팅
- 외부 Fetcher 경로 연결
- title/language가 없더라도 note pipeline이 동작하도록 처리
- 관련 fixture와 테스트 포팅
- 에러 코드 정리와 HTTP status 분리

완료 기준:

- fixture 공유 HTML에서 시간순 user/assistant 메시지 복원
- tool/internal 메시지 분류
- invalid/deleted/inaccessible 링크가 구분된 오류를 반환
- 원본 HTML을 저장하지 않음

### Phase 2. Conversation Note 엔진

작업:

- note message filter
- hard-limit segmenter
- segment prompt와 schema
- structured LLM provider
- timeout/retry
- 병렬 segment generation
- hierarchical reducer
- deterministic output validation
- Markdown projection
- `POST /api/notes/import`

완료 기준:

- 짧은 대화는 하나의 간결한 노트로 생성
- 긴 대화는 시간순 section으로 생성
- 조건 추가, 수정, 방향 전환이 흐름으로 보존
- 대화에 없는 추천을 추가하지 않음
- 실패 segment가 있는 incomplete note를 completed로 반환하지 않음

### Phase 3. 로컬 NoteStore

작업:

- IndexedDB repository
- schema version과 migration
- CRUD
- 중복 share ID 처리
- favorites, archive, trash
- local search
- source snapshot 보관과 삭제

완료 기준:

- 브라우저 reload 후 노트 유지
- 같은 링크 중복 저장 방지
- 영구 삭제 후 note와 source snapshot 모두 제거
- 저장소 구현을 UI가 직접 참조하지 않음

### Phase 4. 3단 노트 UI

작업:

- Sidebar
- NoteList
- NoteDetail
- NoteEditor
- ImportDialog
- SourceConversationDrawer
- empty/loading/error 상태
- responsive mobile navigation
- 키보드 및 접근성 상태

완료 기준:

- 참고 이미지와 같은 탐색/목록/본문 정보 구조
- Entity Graph 또는 분석 Monitor가 노출되지 않음
- 생성 직후 새 노트가 선택되어 표시됨
- 제목과 본문 편집 및 자동 저장
- 검색, 태그, 즐겨찾기, 보관, 휴지통 동작

### Phase 5. 품질·보안·배포 준비

작업:

- 대표 대화 fixture와 수동 note quality checklist
- parser live contract check 절차
- prompt/schema/version 기록
- latency와 token usage 메타데이터
- rate limit 또는 private access gate
- production debug route 제거 확인
- 개인정보, 삭제, provider 전송 안내
- Cloudflare 배포 설정

완료 기준:

- 관련 unit/integration 테스트 통과
- build, typecheck, lint 통과
- 서버가 대화 원문을 영구 저장하지 않음
- 공개 endpoint에 접근 제한 또는 rate limit 적용
- 수동 검수에서 대화 흐름, 수정, 최종 상태가 원문과 일치

## 13. 품질 평가 기준

노트 품질은 Entity 추출 개수나 Graph coverage로 평가하지 않는다.

핵심 지표:

| 항목 | 확인 질문 |
|---|---|
| 흐름 보존 | 대화가 어떤 순서로 전개됐는가가 보이는가? |
| 맥락 전환 | 주제나 조건이 바뀐 이유가 드러나는가? |
| 수정 보존 | 이전 방향과 이후 수정이 혼동되지 않는가? |
| 최종 상태 | 대화 마지막에 어디까지 왔는가가 정확한가? |
| 근거성 | 원문에 없는 사실이나 추천이 추가되지 않았는가? |
| 가독성 | 원문 전체를 읽는 것보다 빠르게 이해되는가? |
| 압축 품질 | 중요한 흐름을 잃지 않으면서 반복이 제거됐는가? |
| 편집 가능성 | 사용자가 제목과 본문을 자연스럽게 고칠 수 있는가? |

초기 수동 평가에서는 각 항목을 `통과 / 부분 통과 / 실패`로 기록한다.

대표 fixture에는 다음 유형을 포함한다.

- 짧은 질의응답
- 긴 기획 대화
- 중간에 요구가 여러 번 바뀐 대화
- assistant 제안을 사용자가 거절한 대화
- 주제가 두세 번 전환된 대화
- 코드와 tool log가 많은 대화
- 결론 없이 끝난 대화
- 한국어와 영어가 섞인 대화

## 14. 버전과 기록

다음 버전은 독립적으로 기록한다.

```text
adapterVersion
noteSchemaVersion
segmentPromptVersion
reducePromptVersion
provider/model
generationRunId
```

다음 변경은 note engine 동작 변경으로 본다.

- 입력 메시지 필터 변경
- segment 경계 또는 overlap 변경
- prompt 변경
- note field 의미 변경
- reducer의 병합 규칙 변경
- source message 연결 규칙 변경

동작 변경에는 관련 fixture, 테스트, before/after 예시와 개인정보 영향을
기록한다. 실제 사용자 대화를 테스트 fixture로 Git에 추가하지 않는다.

## 15. 주요 위험과 대응

| 위험 | 대응 |
|---|---|
| ChatGPT 내부 HTML 구조 변경 | adapter fixture, 명확한 오류 코드, contract check |
| 긴 대화의 요청 시간 초과 | hard segment cap, timeout/retry, 필요 시 async job 전환 |
| LLM이 흐름을 평탄화 | 시간순 section schema와 수정/철회 보존 prompt |
| 원문에 없는 추천 생성 | 명시적 비목표, prompt guardrail, 수동 fixture 평가 |
| 사용자 편집본 덮어쓰기 | 재생성 시 기존 note 보존, 명시적 적용 |
| 브라우저 데이터 유실 | IndexedDB 오류 처리와 향후 export/backup |
| 공유 기기의 개인정보 노출 | local storage 안내, 완전 삭제, 향후 잠금 기능 |
| 공개 API 비용 남용 | private beta gate, rate limit, 요청 크기 제한 |
| 외부 provider 데이터 전송 | 명확한 고지, data minimization, store=false, no raw logs |

## 16. MVP 완료 정의

다음 조건을 모두 만족하면 첫 MVP가 완료된 것으로 본다.

1. 사용자가 공개 ChatGPT URL을 입력할 수 있다.
2. 사용자에게 보인 대화만 복원된다.
3. 짧거나 긴 대화가 시간순 맥락 노트로 생성된다.
4. 생성 결과에 Entity Graph와 분석 Monitor가 없다.
5. 방향 전환, 조건 추가, 수정, 마지막 상태가 노트에서 보인다.
6. 원문에 없는 추천이나 결론을 추가하지 않는다.
7. 노트 제목과 본문을 편집할 수 있다.
8. 노트가 브라우저 reload 후에도 유지된다.
9. 목록, 검색, 태그, 즐겨찾기, 보관, 휴지통이 동작한다.
10. 원문 범위를 필요할 때만 확인할 수 있다.
11. 삭제 시 저장된 note와 source snapshot이 함께 제거된다.
12. 서버가 원문과 노트를 영구 저장하지 않는다.
13. 관련 테스트, typecheck, lint, build가 통과한다.

## 17. 구현 시작 시 첫 작업 묶음

첫 구현은 다음 순서로 진행한다.

1. `apps/gptmemory` Next.js 프로젝트 골격 생성
2. Note schema와 repository/provider interface 먼저 작성
3. blabase ChatGPT adapter와 fixture를 포팅
4. fixture 대화를 화면에 원문으로 표시해 복원 단계 검증
5. note filter와 hard-limit segmenter 구현
6. segment/reduce prompt 및 structured output 구현
7. `/api/notes/import` 통합 테스트 작성
8. IndexedDB NoteStore 연결
9. 3단 UI 연결
10. 대표 대화로 흐름 보존 수동 검수

이 순서에서는 UI를 먼저 완성한 뒤 엔진 계약을 끼워 맞추지 않는다. Note schema와
시간순 맥락 보존 규칙을 먼저 고정하고, UI는 그 결과를 읽고 편집하는 역할만
담당한다.
