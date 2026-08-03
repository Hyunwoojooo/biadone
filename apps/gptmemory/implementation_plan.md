# GPTMemory 구현 계획

> 상태: Implemented v0.3 compressed summary v2
> 작성일: 2026-07-29
> 현재 구현 기준일: 2026-08-02 (Gemini structured summary v2 전환)
> 대상 경로: `apps/gptmemory/`

## 0.0 v2 압축 요약 전환 (현재 우선 계약)

기존 시간순 v1 노트는 과거 노트 호환과 `대화 흐름 상세 보기`를 위해 유지하되,
신규 import의 기본 결과는 다음 `gptmemory.summary.v2` 압축 요약으로 전환한다.

- `title`, 120자 이하 `oneLineSummary`, 핵심 3~7개, 결과, 명시된 할 일,
  필요한 맥락 1~5개를 제공한다.
- 결과는 `conclusion`, `decision`, `proposal`, `unresolved`를 구분한다.
- 모든 공개 항목은 실제 정제 입력의 `sourceMessageIds`를 가진다.
- 서버가 완전한 문장·불릿 단위의 evidence catalog와 요청 전용 숫자 인덱스를 만들고,
  Gemini Structured Output은 허용 범위의 인덱스만 선택한다. 서버가 이를 실제
  메시지 ID와 정확한 조항으로 복원해 역할, 길이와 개수를 결정적으로 검증한다.
  `decision`과 action은 모델의
  재서술 대신 검증된 사용자 조항을 공개 텍스트로 사용하며, assistant 제안만으로
  `decision`을 만들거나 사용자에게 명시되지 않은 action을 만들 수 없다.
- 대화 텍스트는 신뢰할 수 없는 데이터이며 내부 지시로 system instruction을
  변경할 수 없다.
- 정제된 대화는 요약 생성을 위해 Google Gemini API로 전송된다. API key와
  모델 설정은 서버에서만 접근하고, 원본 HTML·복원된 전체 메시지 배열·provider
  원문 응답은 영구 저장하거나 로그에 남기지 않는다.
- D1에는 nullable `summary_schema_version`, `summary_json`을 추가하고 기존
  `overview`, `sections_json`은 그대로 유지한다. v1 노트는 자동 변환하지 않으며,
  사용자가 `새 요약으로 재생성`을 선택할 때만 조건부 원자 갱신한다.
- provider·timeout·rate limit·구조·evidence 검증 실패와 stale write에서는 기존
  row를 변경하지 않는다.

아래 v1 설명은 legacy 구현 기록이다. v2 계약과 충돌하는 경우 이 절과 실제 코드가
우선한다.

## 0. 구현 시 확정된 변경

2026-07-29 구현을 시작하며 다음 결정을 확정했고, 2026-08-02 현재 구현을
기준으로 보존·삭제 계약을 보완했다. 아래에 남아 있는 초기 LLM·IndexedDB
설계는 향후 선택지를 설명하는 기록일 뿐이며, 현재 제품 계약과 충돌할 때는
이 절과 실제 코드가 우선한다.

- OpenAI API와 외부 LLM을 첫 버전에서 제외했다. 이 항목은 v1의 역사적 결정이며,
  현재 v2는 위 계약에 따라 Gemini를 사용한다.
- 노트 엔진은 대화 순서, 사용자 요청, 조건 수정, 맥락 전환, 이어진 응답을
  결정적 규칙으로 묶는다.
- 엔티티, 관계, 결정, 액션, 감정, 숨은 의도는 추출하지 않는다.
- 노트는 Sites의 Cloudflare D1에 저장한다.
- 계정 없는 MVP에서는 브라우저가 만든 충분히 긴 owner key로 모든 D1 쿼리를
  분리한다. 이는 정식 인증을 대체하지 않으므로 배포는 private access를 기본으로
  한다.
- 브라우저 저장소는 owner key 같은 비권위적 장치 설정에만 사용한다.
- D1에는 구조화된 노트와 normalized source URL, source title/message count를
  저장한다. 원본 HTML과 복원된 전체 대화 메시지 배열은 저장하지 않는다.
- import provenance는 workflow·adapter·note engine·note schema 버전, run ID,
  share ID, canonical conversation SHA-256, fetch/generation 시각을 서버 내부
  `generation_metadata_json`에 저장한다. 이 값은 public note 응답에 포함하지 않는다.
- active, archived, trash 상태에서는 source URL, share ID, digest와 generation
  metadata를 노트와 함께 보존한다. 휴지통 이동은 soft delete이므로 보존이
  계속된다.
- 휴지통에서 명시적으로 확인한 hard delete는 owner 범위와 `deleted_at IS NOT
  NULL` 조건을 모두 만족하는 D1 note row 전체를 삭제한다. 이때 source URL,
  share ID, digest와 generation metadata도 함께 제거되며 복구할 수 없다. 별도
  `sourceSnapshot`은 존재하지 않는다.
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
- 긴 대화도 user turn과 이어지는 assistant 응답을 시간순 section으로 묶는다.
- 각 구간의 질문, 답변, 수정, 전환을 서술형 문단으로 정리한다.
- section과 마지막 상태를 하나의 구조화된 노트로 만든다.
- 생성된 제목과 본문을 사용자가 직접 편집할 수 있게 한다.
- 노트를 D1에 영구 저장하고 목록, 검색, 태그, 즐겨찾기, 보관,
  휴지통을 제공한다.
- 현재는 normalized source URL로 원문 전체를 새 창에서 열 수 있다. section별 원문
  범위 drawer는 원문 비저장 정책을 유지하는 방식이 정해진 뒤 구현한다.

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
- 현재 `원문` 동작은 저장된 normalized source URL을 새 창에서 연다. section별
  원문 범위 표시는 아직 구현되지 않았다.
- 모바일에서는 `탐색 → 목록 → 상세` 순서의 단일 패널 내비게이션으로 바꾼다.

### 3.2 주요 사용자 흐름

#### 첫 노트 가져오기

```text
빈 화면
→ URL 가져오기
→ 링크 검증
→ 대화 복원
→ 노트 작성
→ D1 저장
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
- 기존 노트를 보여주고 `기존 노트 열기`, `다시 생성`, `취소`를 선택하게 한다.
- 다시 생성에 실패해도 기존 사용자 편집본을 보존한다.
- 다시 생성은 사용자가 확인한 `noteId + updatedAt`과 현재 D1 상태가 일치할
  때만 조건부 갱신한다.

### 3.3 Safe reimport 검증 상태

- [x] normalized URL 중복 조회가 외부 fetch보다 먼저 실행된다.
- [x] owner header가 없거나 다른 owner인 요청은 기존 노트 정보를 노출하지 않는다.
- [x] 동시 신규 생성에서 unique constraint가 중복 row를 막는다.
- [x] stale `expectedUpdatedAt` 교체 요청은 기존 노트를 변경하지 않는다.
- [ ] 브라우저에서 중복 카드와 `기존 노트 열기`를 확인한다.
- [ ] 브라우저에서 `취소`가 아무 변경 없이 dialog를 닫는지 확인한다.
- [ ] 브라우저에서 성공한 `다시 생성`이 favorite/archive/trash 상태를 보존하는지
  확인한다.
- [ ] 브라우저에서 import 실패와 stale 409가 기존 사용자 편집본을 보존하고
  재시도 가능한 오류를 보여주는지 확인한다.

위 네 항목은 자동 API 검증과 별개인 실제 UI 수동 검증이다. 현재 인앱 브라우저가
연결되지 않아 실행하지 못했으며, 기능 실패로 판정한 상태는 아니다.

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
- 긴 입력을 나누고 병렬 처리하는 기본 아이디어(후속 LLM 도입 시 참고)
- Golden baseline의 segment/reduce 세션 요약 방식(후속 LLM 도입 시 참고)
- 외부 LLM 응답을 schema로 검증하는 방식(후속 LLM 도입 시 참고)

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

첫 MVP에는 LLM provider를 두지 않는다. 향후 외부 모델을 다시 검토할 때도 기존
provider 코드를 그대로 복사하지 않고, 현재 note schema와 개인정보 정책에 맞는
작은 인터페이스로 별도 설계한다.

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

아래 트리는 구현 착수 전의 구조 기록이다. 실제 구현은 루트의 `app/`,
`components/`, `lib/`, `db/`를 사용하며 IndexedDB와 LLM provider 경로는 채택하지
않았다.

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

결정적 note engine은 Markdown 한 덩어리 대신 구조화된 plain-text note draft를
반환한다.

```ts
type ConversationNoteDraft = {
  schemaVersion: "gptmemory.note-draft.v1";
  format: "plain_text";
  title: string;
  overview: string;
  sections: Array<{
    id: string;
    heading: string;
    body: string;
    sourceMessageIds: string[];
    flowKind: "opening" | "follow_up" | "correction" | "transition" | "opening_context";
  }>;
  closingState: string;
  tags: string[];
  source: {
    type: "chatgpt_share_link" | "conversation";
    conversationTitle: string | null;
    originalUrl: string | null;
    normalizedUrl: string | null;
    shareId: string | null;
    messageCount: number;
    userTurnCount: number;
    messageIds: string[];
    startedAt: string | null;
    endedAt: string | null;
  };
};
```

필드 의미:

- `title`: 대화 전체를 나타내는 짧고 구체적인 제목
- `overview`: 이 대화가 무엇을 다뤘고 어디까지 갔는지 설명하는 짧은 도입
- `sections`: 시간순으로 읽히는 대화 구간
- `heading`: 해당 구간의 맥락을 나타내는 제목
- `body`: 질문, 답변, 수정, 전환을 시간순으로 연결한 plain text
- `closingState`: 마지막 시점에 확인 가능한 현재 상태
- `tags`: 첫 엔진에서는 자동 추출하지 않아 빈 배열이며 사용자가 편집할 수 있음
- `source`: 생성 시점의 대화 식별·개수·시간 범위를 나타내는 draft 내부 요약

각 section은 `sourceMessageIds`를 보존하지만 원문 메시지 본문 자체는 D1에
저장하지 않는다.

### 6.2 저장 레코드

```ts
type PublicNote = {
  id: string;
  title: string;
  overview: string;
  sections: Array<Record<string, unknown>>;
  tags: string[];
  sourceUrl?: string;
  sourceTitle?: string;
  sourceMessageCount?: number;
  favorite: boolean;
  archived: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

Public 응답에는 generation metadata와 digest를 포함하지 않는다. D1 내부에는
`owner_key`, public note 필드, normalized `source_url`, 그리고 nullable
`generation_metadata_json`을 저장한다. 원본 HTML, 전체 message snapshot,
provider prompt/response는 저장하지 않는다.

초기 IndexedDB `sourceSnapshot` 설계는 채택하지 않았다. 원문 범위 기능은 raw
message를 새로 영구 저장하지 않는 방식으로 별도 결정한다.

### 6.3 저장소 인터페이스

UI는 D1에 직접 접근하지 않고 owner-scoped Notes API와 repository를 거친다.

```ts
interface NoteRepository {
  list(ownerKey: string, filter: NoteFilter): Promise<PublicNote[]>;
  get(ownerKey: string, id: string): Promise<PublicNote | null>;
  findBySourceUrl(ownerKey: string, normalizedUrl: string): Promise<PublicNote | null>;
  createImportedNote(ownerKey: string, note: ImportedNoteWrite): Promise<CreateResult>;
  replaceImportedNote(input: ConditionalReplacement): Promise<PublicNote | null>;
  patch(ownerKey: string, id: string, patch: NotePatch): Promise<PublicNote | null>;
  softDelete(ownerKey: string, id: string): Promise<PublicNote | null>;
  hardDelete(ownerKey: string, id: string): Promise<boolean>;
}
```

모든 경로는 D1 prepared statement와 owner scope를 사용한다. `hardDelete`는
휴지통에 있는 행만 삭제하며, bare `DELETE`는 기존 soft delete 의미를 유지한다.
영구 삭제는 `DELETE /api/notes/:id?permanent=true`로 명시해야 한다.

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

### 7.3 구간 분할 — 초기 후속 설계 기록

이 절부터 7.6까지는 외부 LLM을 사용하던 초기 설계 기록이며 첫 MVP에 구현되지
않았다. 현재 엔진은 user turn과 이어지는 assistant 응답을 한 section으로 묶는다.
향후 압축 품질을 위해 segment/reduce를 다시 검토할 때 아래 기준을 참고한다.

후속 segmenter를 도입한다면 설정값을 절대 상한으로 지킨다.

초기 기준:

- 구간당 최대 24,000~28,000자
- 구간당 최대 40개 메시지
- user 메시지 직전 또는 완결된 assistant 답변 뒤를 우선 경계로 사용
- 구간 사이에는 직전 핵심 assistant 답변을 context-only로 최대 1개 겹친다.
- 하나의 매우 긴 메시지는 별도의 oversized segment로 표시한다.
- 최대 구간 수를 넘었다고 마지막 구간에 무제한으로 합치지 않는다.

구간 번호와 원본 message index는 항상 시간순으로 유지한다.

### 7.4 구간 노트 생성 — 초기 후속 설계 기록

외부 LLM을 도입하는 후속안에서는 각 구간 요청이 다음 계약을 생성하도록
검토했었다. 현재 deterministic engine의 계약은 6.1을 따른다.

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

### 7.5 최종 병합 — 초기 후속 설계 기록

아래 reducer는 현재 구현이 아니라 긴 대화 압축을 위한 후속 설계 기록이다.
구간이 하나면 바로 최종 노트로 projection하고 둘 이상이면 시간순 구간 노트를
reduce하는 안을 검토했다.

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

현재 출력은 순수 TypeScript deterministic engine이 만들고, API 저장 전 입력
크기·section JSON·tag·URL 계약을 검증한다. 아래 범위/index 검증 목록은 후속
압축 엔진에서 유지할 초기 설계 원칙이다.

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
- visible user message가 없거나 note/write 계약을 통과하지 못하면 저장하지 않는다.
- D1 쓰기가 실패하면 완료 응답을 반환하지 않는다.
- 재생성 실패: 기존 노트와 사용자 편집 내용을 그대로 보존한다.
- 확인 후 노트가 바뀌면 stale 409를 반환하고 기존 노트를 변경하지 않는다.
- 과거 LLM segment retry/reduce 실패 정책은 외부 LLM 도입 전까지 적용되지 않는다.

## 8. API 계약

### 8.1 노트 가져오기

```text
POST /api/notes/import
Content-Type: application/json
X-GPTMemory-Owner: <browser owner key>

{
  "shareUrl": "https://chatgpt.com/share/..."
}
```

확인된 다시 생성 요청:

```json
{
  "shareUrl": "https://chatgpt.com/share/...",
  "replace": {
    "noteId": "existing note UUID",
    "expectedUpdatedAt": "confirmed ISO timestamp"
  }
}
```

`replace`는 사용자가 중복 안내에서 `다시 생성`을 명시적으로 선택한 요청에만
포함한다.

서버 책임:

1. 외부 fetch보다 먼저 owner header와 요청 크기를 검증한다.
2. 공유 URL을 정규화하고 owner 범위에서 기존 노트를 조회한다.
3. 중복이면 외부 fetch나 쓰기 없이 최소 기존 노트 요약을 반환한다.
4. 신규 요청이면 공유 대화를 복원하고 결정적 노트 엔진 결과를 D1에 저장한다.
5. 확인된 다시 생성이면 새 결과를 메모리에서 완성한 뒤 `noteId`, owner,
   normalized URL, `expectedUpdatedAt`이 모두 일치하는 행만 한 번 갱신한다.
6. 응답에는 저장된 노트만 반환하고 복원된 원문 대화나 중간 draft를 반환하지
   않는다.

응답 계약:

```ts
type ImportNoteResponse =
  | { status: "created"; note: PublicNote } // HTTP 201
  | { status: "replaced"; note: PublicNote } // HTTP 200
  | {
      status: "already_exists";
      existing: {
        id: string;
        title: string;
        updatedAt: string;
        archived: boolean;
        deletedAt: string | null;
        sourceMessageCount: number | null;
      };
    }; // HTTP 409
```

확인 뒤 노트가 바뀌었거나 조건부 갱신 경쟁에서 진 경우에는 HTTP 409와
`NOTE_CHANGED_SINCE_CONFIRMATION`을 반환하고 기존 노트를 변경하지 않는다.
생성 provenance는 원문 본문 대신 workflow·adapter·note engine·schema 버전,
share ID, canonical source SHA-256, fetch/generation 시각만 저장한다.

### 8.2 오류 코드

초기 오류 코드는 사용자 조치 가능성을 기준으로 구분한다.

```text
OWNER_KEY_REQUIRED
INVALID_OWNER_KEY
INVALID_REQUEST
INVALID_SHARE_URL
SHARE_LINK_NOT_ACCESSIBLE
SHARE_LINK_DELETED
CHATGPT_PAYLOAD_CHANGED
CONVERSATION_NOT_FOUND
NO_VISIBLE_MESSAGES
NOTE_CHANGED_SINCE_CONFIRMATION
IMPORTED_SOURCE_MISMATCH
RATE_LIMITED
IMPORT_FAILED
```

외부 Fetcher 설정 실패, upstream fetch 장애와 D1 장애를 모두 HTTP 400으로
감추지 않는다. 입력 오류, upstream 오류, 서버 설정 오류를 적절한 4xx/5xx로
분리한다.

### 8.3 동기 실행 범위

MVP는 하나의 요청에서 가져오기와 노트 생성을 완료한다. 다음 조건이 실제 운영에서
문제가 되면 async job으로 전환한다.

- 긴 대화에서 반복적으로 요청 제한 시간을 넘김
- upstream fetch 때문에 사용자가 지나치게 오래 기다림
- 브라우저가 요청을 중단한 뒤 결과를 복구해야 함

async 전환 전까지 UI는 `대화 가져오기 → 맥락 정리 → 노트 작성` 상태를
순차적으로 보여주되, 실제 완료되지 않은 단계를 완료됐다고 표시하지 않는다.

## 9. D1 저장과 편집

### 9.1 D1 NoteStore

MVP의 권위 저장소는 Cloudflare D1이다.

- 모든 query는 브라우저가 생성한 owner key로 범위를 제한한다.
- `(owner_key, source_url)` partial unique index로 같은 normalized 공유 URL의 중복
  row를 막는다.
- title, overview, sections, tags와 favorite/archive/trash 상태를 D1에 저장한다.
- normalized source URL, source title/message count, 내부 generation metadata를
  note row와 함께 저장한다.
- 브라우저 저장소에는 owner key만 두고 note payload를 중복 저장하지 않는다.
- 휴지통 이동은 `deleted_at`을 설정하는 soft delete다. 이 상태에서는 note와
  source/provenance metadata가 계속 보존된다.
- 휴지통 UI에서 2단계 확인을 거친 hard delete는 owner-scoped이면서 이미
  trash 상태인 row 전체를 삭제한다. URL, share ID, digest, generation metadata도
  같은 row와 함께 즉시 제거되며 복구할 수 없다.
- 원본 HTML과 복원된 전체 message snapshot은 D1이나 브라우저에 저장하지 않는다.

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

D1 query가 title, overview, sections, tags와 source title을 검색한다. 노트 수가
커져 성능 문제가 측정되면 FTS 또는 별도 search index를 도입한다.

## 10. 개인정보와 보안

ChatGPT 공유 링크는 공개 URL이어도 개인적이거나 민감한 대화를 포함할 수 있다.

필수 원칙:

- 첫 MVP는 OpenAI/Gemini 등 외부 LLM provider로 대화를 보내지 않는다.
- Fetcher secret을 브라우저에 노출하지 않는다.
- 서버 로그에 공유 URL, 대화 원문, 생성된 노트 본문을 남기지 않는다.
- 원본 HTML과 복원된 전체 대화 메시지는 영구 저장하지 않는다.
- 편집 가능한 구조화 note는 제품 기능을 위해 D1에 영구 저장한다.
- 모든 share fetch 요청에 timeout과 response-size 제한을 적용한다.
- redirect 후 최종 URL의 protocol과 hostname을 다시 확인한다.
- Fetcher 응답에도 앱 측 body-size 제한을 다시 적용한다.
- debug fetch/payload route는 production에 노출하지 않는다.
- 공개 배포 전 인증 또는 접근 제한과 rate limit을 적용한다.
- soft delete 동안에는 note, URL, share ID, digest, generation metadata를 보존한다.
- 휴지통 이동과 영구 삭제를 UI와 API에서 구분한다. bare `DELETE`는 soft delete,
  명시적인 `permanent=true`는 trash 상태인 owner-scoped D1 row 전체 삭제다.
- generation metadata와 canonical source SHA-256은 서버 내부 provenance이며 public
  note 응답으로 보내지 않는다.
- 사용자 대화를 Golden Dataset이나 모델 개선 자료로 자동 수집하지 않는다.

owner key는 정식 인증이 아니라 D1 query를 분리하는 bearer 성격의 장치 키다.
브라우저 localStorage를 지우면 기존 D1 note에 접근할 키를 잃을 수 있고, 같은
브라우저 프로필에 접근 가능한 사람은 앱을 열 수 있다. 따라서 localhost 개인
테스트를 벗어나기 전에는 private access와 owner key 복구 또는 정식 인증을
별도로 마련한다.

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
- 시간순 user-turn section 생성
- 연속 assistant 응답 묶기와 응답 없는 마지막 요청 처리
- section source message ID 검증
- final note output shape와 저장 크기 제한
- 수정/철회 흐름 보존
- 사용자 결정과 assistant 제안의 혼동 방지
- 원문에 없는 추천을 만들지 않는 deterministic fixture

hard character/message segmenter, overlap, reducer 테스트는 외부 LLM 압축 엔진을
채택할 때 추가한다.

### 11.3 API 통합 테스트

외부 fetch와 repository side effect를 주입하거나 mock한다.

- URL → D1 note 생성 성공
- parser 실패
- visible message 없음
- timeout
- 서버 로그와 응답에 secret이 포함되지 않음
- malformed JSON과 body-size 오류
- normalized URL 중복 short circuit과 insert race
- stale conditional replacement와 실패 시 기존 노트 보존

### 11.4 저장소 테스트

- create/get/update/list
- owner + normalized source URL 중복 탐지
- favorite/archive/trash 필터
- soft delete/restore
- hard delete는 owner scope와 trash 상태를 모두 요구함
- hard delete 뒤 note row와 URL/share ID/digest/generation metadata가 함께 사라짐
- schema migration
- reload 후 노트 복구

### 11.5 UI 검증

- 빈 상태
- URL import 진행 및 오류
- 3단 레이아웃
- 목록 선택
- 제목/본문 편집과 자동 저장
- 검색과 태그 필터
- favorite/archive/trash
- 휴지통에서 영구 삭제 확인 dialog, 취소, 진행 중 중복 요청 차단
- 외부 원문 링크
- 키보드 탐색과 focus 상태
- 390px 모바일 레이아웃
- 1440px 데스크톱 레이아웃
- [ ] 중복 카드에서 `기존 노트 열기`, `취소`, `다시 생성` 확인
- [ ] active/archive/trash 기존 노트 열기와 성공 교체 후 올바른 view 확인
- [ ] import 실패와 stale 409에서 기존 사용자 편집본 보존 확인
- [ ] section별 source conversation drawer 정책 결정 및 구현

필요성이 확인되면 후속 단계에서 Playwright를 추가한다. 추가할 경우 브라우저
reload, D1 persistence, import/reimport mock flow를 E2E로 검증하기 위한 의존성임을
기록한다.

## 12. 구현 단계

### Phase 0. 프로젝트 골격과 계약

작업:

- Next.js/TypeScript와 Node 기본 테스트 러너 구성
- lint, typecheck, test, build 명령 구성
- 기본 App Shell과 design tokens 구성
- `ConversationNoteDraft`, `PublicNote`, API 입력 계약 작성
- D1 repository interface 작성
- 환경변수 예제와 개인정보 안내 초안 작성

완료 기준:

- 빈 앱 build, typecheck, lint, test 통과
- API와 note 저장 입력이 runtime validation을 통과함
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
- user turn과 이어진 assistant 응답을 시간순 section으로 묶기
- correction/transition/opening 흐름 분류
- plain-text title, overview, sections, closing state 작성
- deterministic output validation
- `POST /api/notes/import`

완료 기준:

- 짧은 대화는 하나의 간결한 노트로 생성
- 긴 대화는 시간순 section으로 생성
- 조건 추가, 수정, 방향 전환이 흐름으로 보존
- 대화에 없는 추천을 추가하지 않음
- 유효한 section을 만들지 못한 입력을 저장 완료로 반환하지 않음

초기 문서의 LLM segment prompt, 병렬 generation, hierarchical reducer와 Markdown
projection은 현재 MVP에 채택하지 않았다. 외부 LLM 압축이 실제로 필요해질 때
별도 개인정보·비용·품질 결정으로 다시 검토한다.

### Phase 3. D1 NoteStore

작업:

- owner-scoped D1 repository와 runtime schema bootstrap
- CRUD와 `(owner_key, source_url)` unique constraint
- normalized source URL과 import provenance metadata 저장
- favorites, archive, trash
- D1 search
- 휴지통에서만 허용하는 명시적 hard delete

완료 기준:

- 브라우저 reload 후 D1 노트 유지
- 같은 링크 중복 저장 방지
- soft delete 동안 note와 URL/share ID/digest/generation metadata 보존
- hard delete 뒤 note row와 해당 provenance metadata 전체 제거
- 원본 HTML, 전체 복원 메시지, 별도 `sourceSnapshot`을 저장하지 않음
- 저장소 구현을 UI가 직접 참조하지 않음

### Phase 4. 3단 노트 UI

작업:

- Sidebar
- NoteList
- NoteDetail
- NoteEditor
- ImportDialog
- normalized source URL을 여는 원문 링크
- empty/loading/error 상태
- responsive mobile navigation
- 키보드 및 접근성 상태
- 휴지통 전용 영구 삭제 확인 dialog

완료 기준:

- 참고 이미지와 같은 탐색/목록/본문 정보 구조
- Entity Graph 또는 분석 Monitor가 노출되지 않음
- 생성 직후 새 노트가 선택되어 표시됨
- 제목과 본문 편집 및 자동 저장
- 검색, 태그, 즐겨찾기, 보관, 휴지통 동작
- 휴지통에서만 영구 삭제할 수 있고 취소·실패·진행 상태가 구분됨

section별 `SourceConversationDrawer`는 원문 비저장 정책과 양립하는 방식이 정해진
뒤 추가하는 후속 기능이다.

### Phase 5. 품질·보안·배포 준비

작업:

- 대표 대화 fixture와 수동 note quality checklist
- parser live contract check 절차
- workflow/adapter/note engine/note schema version과 run ID 기록
- fetch/generation 시각과 canonical source digest 기록
- rate limit 또는 private access gate
- production debug route 제거 확인
- 개인정보, soft delete/hard delete, 외부 LLM 미사용 안내
- Cloudflare 배포 설정

완료 기준:

- 관련 unit/integration 테스트 통과
- build, typecheck, lint 통과
- 서버가 원본 HTML과 복원된 전체 대화 메시지를 영구 저장하지 않음
- 편집 가능한 구조화 노트는 D1에 저장되고 hard delete로 전체 row를 제거할 수 있음
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
workflowVersion
noteEngineVersion
noteSchemaVersion
runId
sourceShareId
sourceContentSha256
sourceFetchedAt
generatedAt
```

현재 MVP에는 외부 LLM provider와 segment/reduce prompt 버전이 없다. 향후 외부
모델을 도입한다면 provider/model과 prompt 버전을 기존 provenance에 추가한다.

다음 변경은 note engine 동작 변경으로 본다.

- 입력 메시지 필터 변경
- user-turn section 경계 또는 flow 분류 변경
- note field 의미 변경
- source message 연결 규칙 변경
- 향후 LLM을 도입할 경우 prompt, provider/model, reducer 규칙 변경

동작 변경에는 관련 fixture, 테스트, before/after 예시와 개인정보 영향을
기록한다. 실제 사용자 대화를 테스트 fixture로 Git에 추가하지 않는다.

## 15. 주요 위험과 대응

| 위험 | 대응 |
|---|---|
| ChatGPT 내부 HTML 구조 변경 | adapter fixture, 명확한 오류 코드, contract check |
| 긴 대화의 요청 시간 초과 | fetch timeout과 입력 크기 제한, 필요 시 async job 전환 |
| 규칙 엔진이 복잡한 흐름을 놓침 | 시간순 section 계약, 수정/전환 fixture, Golden 수동 평가 |
| 원문에 없는 추천 생성 | 결정적 원문 projection, 명시적 비목표, 수동 fixture 평가 |
| 사용자 편집본 덮어쓰기 | 재생성 시 기존 note 보존, 명시적 적용 |
| owner key 유실로 D1 노트 접근 불가 | localStorage 한계 고지, 향후 복구·export·정식 인증 |
| 공유 기기의 개인정보 노출 | owner key의 bearer 성격 고지, private access, 향후 잠금 기능 |
| 휴지통 데이터를 영구 삭제로 오인 | soft delete와 2단계 hard delete를 UI에서 구분 |
| 공개 API 비용 남용 | private beta gate, rate limit, 요청 크기 제한 |
| 향후 외부 LLM 데이터 전송 | 도입 전 별도 동의·data minimization·보존 정책 결정 |

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
10. normalized source URL로 원문 전체를 필요할 때만 열 수 있다. section별 범위
    drawer는 후속 기능이다.
11. 휴지통 이동은 note와 provenance를 보존하고, 확인된 hard delete는 D1 row와
    source URL/share ID/digest/generation metadata를 함께 제거한다.
12. 서버는 원본 HTML과 복원된 전체 대화 메시지를 영구 저장하지 않는다.
    편집 가능한 구조화 노트는 제품 기능을 위해 D1에 저장한다.
13. 관련 테스트, typecheck, lint, build가 통과한다.

현재 기능 계약에서 남은 수동 확인은 인앱 브라우저 미연결로 실행하지 못한 safe
reimport UI 흐름이다. section별 source drawer, 정식 인증과 공개 배포 정책은 MVP
후속 작업이다.

## 17. 구현 이력과 다음 작업

초기 계획의 `Vitest + external LLM segment/reduce + IndexedDB` 조합은 실제 구현에
채택하지 않았다. 현재 구현은 다음 순서로 진행됐다.

1. `apps/gptmemory` Next.js 프로젝트 골격과 Node 기본 테스트 러너 구성
2. Note schema와 owner-scoped D1 repository 작성
3. blabase ChatGPT adapter와 fixture 포팅
4. clean message filter와 deterministic user-turn note engine 구현
5. `/api/notes/import`와 duplicate-safe conditional reimport 구현
6. 3단 UI, 편집, 검색, favorites/archive/trash 연결
7. 휴지통 전용 owner-scoped hard delete와 2단계 확인 UI 구현

현재 다음 작업은 다음처럼 구분한다.

- 자동 검증 완료: safe reimport API 계약, stale/동시성 보존, hard delete
  API·UI 계약과 production SQL의 in-memory 실행. hard delete는 localhost D1에서 신규 노트 생성,
  active 상태 차단, 다른 owner 차단, soft delete, row 전체 삭제, 삭제 후 404와
  반복 삭제 404까지 확인했다. 현재 전체 자동 테스트는 `53 passed / 0 failed`다.
- 사용자 브라우저 수동 검증 대기: 중복 카드의 열기·취소·다시 생성, active/archive/
  trash 화면 전환, import 실패와 stale 오류에서 편집본 보존. 인앱 브라우저가
  연결되지 않아 아직 실행하지 못했다.
- 후속 제품 결정: section별 원문 범위 drawer, owner key 복구 또는 정식 인증,
  공개 전 rate limit/private access, 재생성 전 revision/history 정책.

Note schema와 시간순 맥락 보존 규칙이 엔진 계약의 기준이며, UI는 그 결과를 읽고
편집하는 역할을 담당한다.
