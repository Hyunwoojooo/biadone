# CODEX IMPLEMENTATION PLAN

## JARVIS Context Mapper v0.1

문서 상태: Draft v0.1 (Sprint 4.5 Audit 개정)
문서 목적: Codex 또는 개발 에이전트가 바로 구현을 시작할 수 있도록, 개발 순서·모듈 책임·완료 기준·금지 범위를 명확히 정의한다.  
기준 문서:

1. `JARVIS_Context_Mapper_기획안.md`
2. `JARVIS_Context_Mapper_기술명세서.md`
3. `CODEX_IMPLEMENTATION_PLAN.md`

> 충돌이 있을 경우 우선순위는 `CODEX_IMPLEMENTATION_PLAN.md` → `JARVIS_Context_Mapper_기술명세서.md` → `JARVIS_Context_Mapper_기획안.md` 순서다.

---

## 0. 가장 중요한 구현 원칙

v0.1은 **PDF 업로드 서비스가 아니다.**  
v0.1은 **ChatGPT 공유 링크에서 대화 구조를 복원하고, 그 대화를 구조화하는 웹 서비스**다.

따라서 Codex는 다음 방향을 반드시 따른다.

```text
ChatGPT Share URL
→ ChatGPTShareAdapter
→ CanonicalConversation
→ Segmenter
├─ RuleExtractor
└─ LLMExtractor (Shadow Mode)
→ Evidence Verifier
→ Conflict Resolver
→ Structure Builder
→ Main Board / Review Queue / Export
```

v0.1에서 가장 중요한 성공 조건은 다음이다.

> **ChatGPT 공유 링크 하나를 입력했을 때, 전체 user/assistant 메시지를 순서대로 복원해 CanonicalConversation JSON으로 만들 수 있어야 한다.**

구조화 UI, Entity Graph, Export는 그 다음이다.  
대화 복원이 불안정하면 제품 전체가 성립하지 않는다.

---

## 1. v0.1 구현 범위

### 1.1 반드시 구현할 것

```text
1. ChatGPT 공유 링크 입력
2. Share URL 검증
3. 공유 페이지 HTML fetch
4. window.__reactRouterContext.streamController.enqueue(...) payload 추출
5. enqueue 문자열 decode
6. 참조 테이블 dereference
7. linear_conversation 복원
8. user / assistant 메시지 정규화
9. CanonicalConversation JSON 생성
10. 원문 메시지 Viewer
11. Conversation Segment 생성
12. Rule 기반 Guardrail Extraction
13. LLM 기반 Context Extraction (Shadow Mode)
14. Evidence / Semantic / Conflict Validation
15. Overview 생성
16. Topic Map 생성
17. Thought Flow 생성
18. Decision / Pending / Action Board 생성
19. Main Board / Review Queue 분리
20. Entity Graph 데이터 생성
21. Source Evidence 연결
22. Markdown Export
23. JSON Export
```

### 1.2 v0.1에서 절대 구현하지 말 것

Codex는 아래 기능을 구현하지 않는다.

```text
1. PDF 업로드
2. Chrome Extension
3. Ask Memory
4. RAG 검색
5. 구조화된 대화에 다시 질문하기
6. ChatGPT 로그인 세션 또는 쿠키 수집
7. 사용자의 비공개 ChatGPT 대화 URL 접근
8. 여러 대화 자동 병합
9. 장기기억 자동 업데이트
10. Neo4j 등 Graph DB 도입
11. 실시간 대화 캡처
12. 사용자 계정/결제/권한 시스템
13. 협업 기능
14. Notion Export
```

위 기능이 필요해 보이더라도 TODO로만 남기고 구현하지 않는다.

---

## 2. 권장 개발 스택

프로젝트가 아직 없다면 다음 스택으로 시작한다.

```text
Frontend / Backend:
- Next.js
- TypeScript
- React
- Tailwind CSS

Runtime / Validation:
- Zod
- Node.js fetch API

Testing:
- Vitest
- Playwright는 v0.1 후반부에서 선택

Storage:
- v0.1 초기: local JSON file 또는 SQLite
- v0.1 후반: PostgreSQL로 확장 가능

LLM:
- OpenAI API 또는 호환 가능한 Structured Output 지원 LLM
- API key가 없을 경우 MockExtractor로 동작 가능해야 함
```

이미 저장소가 존재한다면 기존 스택을 우선한다.  
단, TypeScript 타입과 테스트는 반드시 유지한다.

---

## 3. 추천 폴더 구조

새 프로젝트 기준 폴더 구조는 다음을 따른다.

```text
src/
  app/
    page.tsx
    analyses/
      [analysisId]/
        page.tsx
    api/
      analyses/
        route.ts
        [analysisId]/
          route.ts
          result/
            route.ts
          messages/
            route.ts
          exports/
            route.ts

  components/
    UrlInputForm.tsx
    AnalysisProgress.tsx
    MessageViewer.tsx
    OverviewPanel.tsx
    TopicMapView.tsx
    ThoughtFlowView.tsx
    BoardView.tsx
    EntityGraphView.tsx
    EvidencePanel.tsx
    ExportPanel.tsx

  core/
    types/
      conversation.ts
      analysis.ts
      extraction.ts
      structures.ts
      errors.ts
    adapters/
      chatgpt-share/
        index.ts
        validateShareUrl.ts
        fetchShareHtml.ts
        extractEnqueuePayloads.ts
        decodePayloads.ts
        dereference.ts
        restoreConversation.ts
        normalizeConversation.ts
        errors.ts
    segmenter/
      segmentConversation.ts
    extraction/
      mockExtractor.ts
      llmExtractor.ts
      schemas.ts
      prompts.ts
    validation/
      validateExtraction.ts
      validateGraph.ts
      validateEvidence.ts
    builders/
      buildOverview.ts
      buildTopicMap.ts
      buildThoughtFlow.ts
      buildBoard.ts
      buildEntityGraph.ts
    export/
      markdownExport.ts
      jsonExport.ts
    storage/
      analysisStore.ts
      fileStore.ts
      memoryStore.ts
    jobs/
      runAnalysisJob.ts
      stages.ts

  tests/
    fixtures/
      chatgpt-share/
        README.md
    unit/
      validateShareUrl.test.ts
      extractEnqueuePayloads.test.ts
      dereference.test.ts
      normalizeConversation.test.ts
      validateExtraction.test.ts
    integration/
      chatgptShareAdapter.test.ts
      runAnalysisJob.test.ts
```

v0.1에서는 복잡한 모노레포 구조를 만들지 않는다.  
먼저 단일 Next.js 앱 안에서 명확한 모듈 경계를 만든다.

---

## 4. 핵심 타입 계약

Codex는 먼저 타입부터 만든다.  
타입이 없으면 이후 LLM 출력, UI, Export가 흔들린다.

### 4.1 CanonicalConversation

```ts
export type CanonicalConversation = {
  id: string;
  source: ConversationSource;
  title: string | null;
  language: string | null;
  importedAt: string;
  messages: CanonicalMessage[];
  stats: ConversationStats;
  warnings: ImportWarning[];
};

export type ConversationSource = {
  type: "chatgpt_share_link";
  originalUrl: string;
  normalizedUrl: string;
  shareId: string;
  adapterName: "ChatGPTShareAdapter";
  adapterVersion: string;
  fetchedAt: string;
};

export type CanonicalMessage = {
  id: string;
  index: number;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  blocks: ContentBlock[];
  sourceRef: SourceRef;
  metadata: {
    rawMessageId?: string;
    modelSlug?: string | null;
    hasUnsupportedContent?: boolean;
  };
};

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string | null; text: string }
  | { type: "quote"; text: string }
  | { type: "table_markdown"; text: string }
  | { type: "unsupported"; label: string; text: string };

export type SourceRef = {
  type: "chatgpt_share_payload";
  messageId: string | null;
  messageIndex: number;
  role: string;
};

export type ConversationStats = {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  unsupportedMessages: number;
  totalChars: number;
};

export type ImportWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};
```

### 4.2 AnalysisResult

```ts
export type AnalysisResult = {
  analysisId: string;
  conversation: CanonicalConversation;
  segments: ConversationSegment[];
  evidence: EvidenceAnchor[];
  overview: Overview;
  topicMap: TopicNode;
  thoughtFlow: ThoughtFlowStep[];
  board: Board;
  entityGraph: EntityGraph;
};
```

### 4.3 EvidenceAnchor

```ts
export type EvidenceAnchor = {
  id: string;
  conversationId: string;
  messageId: string;
  messageIndex: number;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  textSpan: {
    startChar: number;
    endChar: number;
  } | null;
  quote: string;
  evidenceType: "direct_quote" | "paraphrase" | "inferred_from_context";
  confidence:
    | "explicit_user_statement"
    | "explicit_assistant_statement"
    | "agreed_conclusion"
    | "model_inference"
    | "weak_inference";
};
```

### 4.4 EntityGraph

```ts
export type EntityGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphNode = {
  id: string;
  label: string;
  type:
    | "product"
    | "feature"
    | "technology"
    | "problem"
    | "goal"
    | "document"
    | "person"
    | "organization"
    | "concept"
    | "data_source";
  description: string;
  evidenceIds: string[];
};

export type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType:
    | "HAS_PROBLEM"
    | "HAS_GOAL"
    | "REQUIRES"
    | "LACKS"
    | "USES"
    | "EXCLUDES"
    | "REPLACES"
    | "ALTERNATIVE_TO"
    | "CAUSES"
    | "SOLVES"
    | "PART_OF"
    | "MENTIONS"
    | "SUPPORTED_BY"
    | "NEXT";
  description: string;
  evidenceIds: string[];
};
```

---

## 5. Sprint 0 — 프로젝트 부트스트랩

### 목표

개발 가능한 기본 프로젝트와 테스트 환경을 만든다.

### 작업

```text
1. Next.js + TypeScript 프로젝트 생성
2. ESLint / Prettier / TypeScript strict mode 설정
3. Vitest 설정
4. 기본 페이지 생성
5. src/core/types 하위 타입 파일 생성
6. npm scripts 정리
```

### package scripts 예시

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 완료 기준

```text
- npm run dev 실행 가능
- npm run typecheck 통과
- npm run test 통과
- 첫 화면에서 Share URL 입력 form이 보임
```

---

## 6. Sprint 1 — ChatGPTShareAdapter 구현

### 목표

ChatGPT 공유 링크를 입력받아 `CanonicalConversation` JSON으로 변환한다.

이 Sprint가 v0.1의 최우선 핵심이다.

### 6.1 구현 파일

```text
src/core/adapters/chatgpt-share/
  index.ts
  validateShareUrl.ts
  fetchShareHtml.ts
  extractEnqueuePayloads.ts
  decodePayloads.ts
  dereference.ts
  restoreConversation.ts
  normalizeConversation.ts
  errors.ts
```

### 6.2 Adapter public API

```ts
export type ChatGPTShareAdapterInput = {
  url: string;
  fetchHtml?: (url: string) => Promise<string>;
};

export type ChatGPTShareAdapterOutput = {
  conversation: CanonicalConversation;
  raw?: {
    htmlHash: string;
    payloadCount: number;
  };
};

export async function importChatGPTShareUrl(
  input: ChatGPTShareAdapterInput
): Promise<ChatGPTShareAdapterOutput>;
```

### 6.3 URL 검증

허용:

```text
https://chatgpt.com/share/<share-id>
```

거부:

```text
http://...
https://chat.openai.com/c/...
https://chatgpt.com/c/...
일반 웹 URL
파일 경로
빈 문자열
```

반환 타입:

```ts
export type ShareUrlValidationResult = {
  valid: boolean;
  normalizedUrl?: string;
  shareId?: string;
  errorCode?:
    | "INVALID_URL"
    | "UNSUPPORTED_DOMAIN"
    | "UNSUPPORTED_PATH"
    | "MISSING_SHARE_ID";
};
```

### 6.4 HTML fetch

정책:

```text
- timeout 적용
- redirect follow
- 최대 body size 제한
- raw HTML은 기본 저장하지 않음
- 테스트에서는 fetchHtml mock을 주입할 수 있어야 함
```

### 6.5 Payload extraction

목표:

```text
HTML에서 window.__reactRouterContext.streamController.enqueue(...) 호출을 모두 찾는다.
```

요구사항:

```text
1. 단순 정규식 하나에만 의존하지 않는다.
2. 문자열 literal boundary를 고려한다.
3. 여러 enqueue payload를 순서대로 추출한다.
4. payload가 없으면 PAYLOAD_NOT_FOUND 에러를 반환한다.
```

반환 타입:

```ts
export type RawEnqueuePayload = {
  order: number;
  rawArgument: string;
  startOffset: number;
  endOffset: number;
};
```

### 6.6 Decode

요구사항:

```text
1. enqueue("...") 내부 escaped string을 decode한다.
2. JSON.parse 가능한 문자열이면 JSON.parse한다.
3. 실패 시 payload index와 함께 error를 반환한다.
```

### 6.7 Dereference

요구사항:

```text
1. _193, _200 같은 참조 문자열을 실제 값으로 재귀 치환한다.
2. maxDepth를 둔다.
3. maxNodes를 둔다.
4. circular reference를 감지한다.
5. unresolved ref를 stats로 남긴다.
```

타입:

```ts
export type DereferenceOptions = {
  maxDepth: number;
  maxNodes: number;
  preserveUnknownRefs: boolean;
};

export type DereferenceResult = {
  root: unknown;
  stats: {
    totalRefs: number;
    resolvedRefs: number;
    unresolvedRefs: number;
    maxDepthReached: boolean;
  };
  warnings: string[];
};
```

### 6.8 linear_conversation 복원

우선순위:

```text
1. dereferenced root에서 linear_conversation을 찾는다.
2. 없으면 messages/mapping/conversation 후보를 탐색한다.
3. v0.1에서는 linear_conversation이 없으면 실패해도 된다.
```

복원할 것:

```text
- message id
- role
- content text
- content blocks
- message order
- sourceRef
```

제외할 것:

```text
- system message는 기본 UI 분석에서 제외
- tool/internal message는 기본 UI 분석에서 제외
- 빈 메시지 제외
```

### 완료 기준

```text
- fixture HTML에서 payload를 찾을 수 있음
- dereference 테스트 통과
- linear_conversation 메시지 수가 복원됨
- 첫 user 메시지와 첫 assistant 메시지를 출력할 수 있음
- CanonicalConversation.messages가 user/assistant 순서로 정렬됨
- npm run test 통과
```

---

## 7. Sprint 2 — Fixture와 원문 메시지 Viewer

### 목표

실제 구조화 전에, 복원된 대화가 UI에서 정확히 보이는지 검증한다.

### 작업

```text
1. fixtures/chatgpt-share 디렉토리 생성
2. 개인정보 없는 테스트 HTML fixture 추가
3. adapter integration test 작성
4. /api/analyses endpoint 생성
5. /api/analyses/{id}/messages endpoint 생성
6. Share URL 입력 화면 구현
7. MessageViewer 구현
```

### UI 요구사항

```text
- user / assistant role이 시각적으로 구분되어야 함
- message index가 보여야 함
- 긴 메시지가 접히거나 스크롤 가능해야 함
- code block은 최소한 pre/code로 표시되어야 함
- unsupported content는 placeholder로 표시해야 함
```

### 완료 기준

```text
- Share URL 입력 후 메시지 목록 화면으로 이동
- user/assistant 메시지 순서 확인 가능
- 실패 시 명확한 에러 메시지 표시
- raw HTML은 화면에 노출하지 않음
```

---

## 8. Sprint 3 — Analysis Job 파이프라인

### 목표

분석 과정을 stage 단위 job으로 실행하고 상태를 조회할 수 있게 한다.

### 상태 enum

```ts
export type AnalysisStatus =
  | "queued"
  | "fetching"
  | "importing"
  | "normalizing"
  | "segmenting"
  | "extracting_context"
  | "building_structures"
  | "completed"
  | "failed";
```

### stage

```text
1. validate_url
2. fetch_html
3. import_conversation
4. normalize_conversation
5. segment_conversation
6. extract_context
7. validate_context
8. build_structures
9. export_ready
```

### API

```http
POST /api/analyses
GET /api/analyses/{analysisId}
GET /api/analyses/{analysisId}/result
GET /api/analyses/{analysisId}/messages
POST /api/analyses/{analysisId}/exports
```

### v0.1 저장 방식

초기에는 in-memory store 또는 local JSON file store로 시작할 수 있다.

```text
src/core/storage/memoryStore.ts
src/core/storage/fileStore.ts
```

단, store interface를 분리해서 나중에 DB로 교체 가능하게 한다.

```ts
export interface AnalysisStore {
  createJob(input: CreateAnalysisJobInput): Promise<AnalysisJob>;
  updateJob(id: string, patch: Partial<AnalysisJob>): Promise<void>;
  getJob(id: string): Promise<AnalysisJob | null>;
  saveResult(id: string, result: AnalysisResult): Promise<void>;
  getResult(id: string): Promise<AnalysisResult | null>;
}
```

### 완료 기준

```text
- 분석 시작 시 job id가 반환됨
- job status를 조회할 수 있음
- import 실패와 LLM 실패가 구분됨
- completed 상태에서 result를 조회할 수 있음
```

---

## 9. Sprint 4 — Segmenter 구현

### 목표

CanonicalConversation을 의미 단위 segment로 나눈다.

### 구현 파일

```text
src/core/segmenter/segmentConversation.ts
```

### 기본 전략

v0.1에서는 과도하게 복잡한 segmenter를 만들지 않는다.

우선 규칙 기반으로 시작한다.

```text
1. user message를 기준으로 segment 시작 후보 생성
2. user + 뒤따르는 assistant 답변을 하나의 기본 segment로 묶음
3. 너무 짧은 segment는 앞뒤와 병합
4. 너무 긴 assistant 답변은 heading 또는 길이 기준으로 분할
5. messageRange를 반드시 보존
```

### Segment 타입

```ts
export type ConversationSegment = {
  id: string;
  order: number;
  title: string;
  summary: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
  };
  messageIds: string[];
  topicShiftReason:
    | "new_user_question"
    | "explicit_transition"
    | "semantic_shift"
    | "length_limit"
    | "manual";
};
```

### LLM 사용 여부

초기에는 title/summary를 placeholder로 생성한다.

```text
title: 첫 user message의 앞 40자
summary: segment 메시지의 간단한 deterministic summary 또는 빈 문자열
```

Sprint 5에서 LLM으로 개선한다.

### 완료 기준

```text
- 모든 message가 하나 이상의 segment에 포함됨
- segment order가 message order와 일치함
- segment messageRange가 올바름
- 빈 segment가 없음
```

---

## 9.5 Sprint 4.5 — Parser / Normalizer / Rule Guardrail 보정

### 목표

LLM을 붙이기 전에 Clean Conversation과 규칙 기반 구조화 결과가 안정적인 기준선이 되도록 만든다.

### 작업

```text
1. tool/plugin/search/connector 로그를 Context Signal 또는 Internal로 분리
2. 사용자-visible assistant final answer와 transition을 구분
3. 복합 발화를 clause 단위 Decision / Action / Preference / Constraint로 분리
4. deferred / excluded / confirmed / candidate 충돌 해소
5. Preference / Content Constraint / Problem Signal / Open Question 분리
6. Satisfaction pairing과 Open Question resolvedBy 보정
7. confidence 0.75 및 Review Queue 정책 적용
8. trigger phrase, matched span, conflict diagnostics를 Audit Export에 포함
```

### 완료 기준

```text
- Clean Conversation에 순수 tool operation이 없음
- 사용자-visible assistant final answer가 누락되지 않음
- 같은 evidence에서 Decision status 충돌이 없음
- pain point가 Open Question으로 추출되지 않음
- explicit user action이 team_next로 오분류되지 않음
- example-derived semantic item이 Main Board에 노출되지 않음
- confidence 0.75 미만 항목이 Main Board에 노출되지 않음
```

---

## 10. Sprint 5 — Hybrid LLM Extraction

Sprint 5에서는 LLM을 RuleExtractor의 대체재로 바로 사용하지 않는다. 같은 Canonical Conversation을 RuleExtractor와 LLMExtractor에 병렬로 입력하고, LLM 결과를 Shadow Mode에서 비교한다.

```text
Canonical Conversation
├─ RuleExtractor
└─ LLMExtractor

→ Evidence Verifier
→ Rule vs LLM Conflict Resolver
→ Main Board / Review Queue
```

### Sprint 5A — LLMExtractor Shadow Mode

### 목표

Segment에서 SemanticItem 후보를 추출하되, LLM 결과를 Main Board에 직접 반영하지 않는다.

### 구현 파일

```text
src/core/extraction/
  schemas.ts
  prompts.ts
  mockExtractor.ts
  llmExtractor.ts
```

### 중요한 원칙

```text
1. LLM 출력은 최종 결과가 아니라 후보군이다.
2. 모든 핵심 항목은 evidenceMessageIndexes를 가져야 한다.
3. JSON Schema 또는 Zod schema로 검증한다.
4. OPENAI_API_KEY가 없으면 MockExtractor로 동작해야 한다.
5. LLM 호출 실패가 전체 import 실패로 이어지지 않게 한다.
6. LLM 결과는 Rule 결과와 분리 저장하고 Shadow Mode 비교에만 사용한다.
7. LLM은 clause 분리, 의미 후보, topic label, overview, satisfaction nuance를 제안한다.
8. Clean 분리, message ID, duplicate, schema, 확정 조건, 노출 여부는 Rule/Validator가 통제한다.
```

### Extractor Interface

```ts
export interface ContextExtractor {
  extractSegment(input: SegmentExtractionInput): Promise<SegmentExtraction>;
  mergeConversation(input: ConversationMergeInput): Promise<MergedContext>;
}
```

### SegmentExtractionInput

```ts
export type SegmentExtractionInput = {
  conversationId: string;
  segment: ConversationSegment;
  messages: CanonicalMessage[];
  language: "ko" | "en" | "unknown";
};
```

```ts
export type HybridExtractionResult = {
  ruleResult: RuleExtractionResult;
  llmResult: LlmExtractionResult;
  verifiedItems: SemanticItem[];
  rejectedItems: RejectedItem[];
  conflicts: ExtractionConflict[];
  reviewQueue: ReviewItem[];
};
```

### Decision 정책

Codex는 decision 추출 시 아래 정책을 반영해야 한다.

```text
Decision으로 인정:
- 사용자가 명시적으로 확정한 것
- “하지 않을거야”, “빼자”, “이걸로 하자” 같은 표현이 있는 것
- 이후 대화에서 확정된 전제로 사용된 것

Decision으로 인정하지 않음:
- assistant가 혼자 제안한 것
- 여러 대안 중 하나로 언급된 것
- evidence가 없는 것
```

### MockExtractor

MockExtractor는 개발 중 UI와 파이프라인 테스트를 위해 필요하다.

요구사항:

```text
- 입력 segment 수에 맞춰 deterministic 결과 생성
- 최소 1개 topic 생성
- 사용자 발화에 “하지 않을거야”, “빼자”, “확정” 등이 있으면 decision 후보 생성
- evidenceMessageIndexes 포함
```

### Sprint 5A 완료 기준

```text
- MockExtractor로 전체 구조화 파이프라인이 동작함
- LLMExtractor는 schema validation을 통과하는 결과만 반환함
- 동일 입력의 Rule 결과와 LLM 결과를 별도로 저장하고 비교할 수 있음
- LLM 비활성화 또는 실패 시 기존 Rule 결과가 그대로 유지됨
```

### Sprint 5A-2 — Segment Coverage 및 품질 보정

긴 Clean Conversation을 한 번에 요약하면 LLM이 소수 핵심 항목만 반환할 수 있으므로 Topic Flow 기반 구간 추출을 추가한다.

```text
Canonical Conversation + Rule Topic Flow
→ Topic 경계 우선 segment 생성
→ 큰 topic만 message 단위 분할
→ 구간별 SemanticItem 전체 category 점검
→ exact duplicate 병합
→ usage / latency / coverage diagnostics 저장
```

구현 원칙:

```text
1. 구간당 기본 28,000자, 40개 메시지, 전체 최대 12개 구간을 사용한다.
2. 최대 3개 구간을 병렬 호출하되 환경변수로 조정할 수 있다.
3. 직전 assistant final answer 한 개를 context-only로 겹쳐 satisfaction과 accepted suggestion 판단을 보존한다.
4. LLM에게 top-N 요약이 아니라 모든 semantic category의 evidence-backed 후보 추출을 요구한다.
5. 구간 실패는 전체 import를 실패시키지 않고 completed / partial / failed 상태를 구분한다.
6. 모든 provider는 input/output/total/cached/thought token과 response model/request ID를 가능한 범위에서 반환한다.
7. GPT Audit에 segment 결과와 message/evidence/type coverage를 노출한다.
```

완료 기준:

```text
- Clean Conversation의 모든 분석 가능 메시지가 정확히 하나의 main segment에 포함됨
- segment boundary의 assistant-user reaction은 context-only overlap으로 해석 가능함
- 구간별 schema validation과 실패 상태가 독립적으로 기록됨
- provider usage와 전체/구간 latency가 합산됨
- LLM 결과의 semantic type 분포와 evidence message coverage를 Audit에서 확인 가능함
```

### Sprint 5B — Evidence Verifier

모든 SemanticItem의 근거를 다음 계약으로 검증한다.

```ts
export type EvidenceMatch = {
  messageId: string;
  messageIndex: number;
  quote: string;
  startChar: number | null;
  endChar: number | null;
  supportType: "explicit" | "accepted_context" | "inferred" | "unsupported";
  verificationStatus: "verified" | "rejected" | "review_required";
};
```

완료 기준:

```text
- quote와 character span이 원문과 일치함
- message index 존재만으로 evidence verified가 되지 않음
- unsupported evidence는 rejectedItems로 이동함
- inferred evidence는 Review Queue로 이동함
```

### Sprint 5C — Rule vs LLM Conflict Resolver

Rule과 LLM이 같은 발화를 다르게 해석한 경우 다음을 비교한다.

```text
- semantic type
- decision status
- trigger/evidence span
- confidence
- user explicitness
```

완료 기준:

```text
- deferred/excluded 같은 상태 충돌이 하나의 확정 결과로 노출되지 않음
- explicit user evidence가 assistant suggestion보다 우선함
- 자동 해소할 수 없는 충돌은 Review Queue에 기록됨
- 모든 충돌에 선택 결과와 사유가 남음
```

---

## 11. Sprint 6 — Hybrid Result Builder

### 목표

Rule/LLM 후보와 검증 결과를 결합해 Main Board, Review Queue, Overview 및 후속 Structure Builder 입력을 생성한다.

### 구현 파일

```text
src/core/validation/
  validateExtraction.ts
  validateEvidence.ts
  validateSemanticType.ts
  resolveTemporalState.ts
  resolveConflicts.ts
  validateMainBoardEligibility.ts
  validateGraph.ts
```

### 검증 규칙

```text
1. evidenceMessageIndexes가 비어 있으면 핵심 항목 제거
2. message index가 범위를 벗어나면 제거
3. relation source/target entity가 없으면 제거
4. relation type whitelist 밖이면 제거
5. 같은 title의 decision은 병합
6. 같은 canonical name의 entity는 병합 후보로 처리
7. weak inference는 UI에서 약한 추론으로 표시
8. Preference / Content Constraint / Problem Signal / Decision / Action 타입 혼합을 검사
9. Open Question의 answered / superseded / open 상태를 검증
10. confidence 0.75 미만, example-derived, assistant suggestion은 Review Queue로 이동
```

### Evidence 생성

LLM이 message index만 주면 validator가 quote 후보를 생성하되, 자동으로 verified 처리하지 않는다.

```text
1. 해당 message text에서 관련 문장 후보 추출
2. span을 찾을 수 있으면 startChar/endChar 저장
3. 정확한 span을 못 찾으면 verificationStatus를 review_required로 지정
4. 원문이 판단을 지지하지 않으면 rejectedItems로 이동
5. quote 길이는 적절히 제한
```

### 완료 기준

```text
- evidence 없는 decision은 result에 포함되지 않음
- 범위 밖 message index는 rejectedItems로 기록됨
- EntityGraph edge는 모두 valid node를 가짐
- validation warnings를 UI에서 확인 가능
- Main Board 항목은 explicit 또는 accepted context evidence가 verified 상태임
- Review Queue에 제외 사유와 Rule/LLM 충돌 정보가 표시됨
```

---

## 12. Sprint 7 — Structure Builder

### 목표

검증된 context를 사용자 화면 구조로 변환한다.

### 구현 파일

```text
src/core/builders/
  buildOverview.ts
  buildTopicMap.ts
  buildThoughtFlow.ts
  buildBoard.ts
  buildEntityGraph.ts
```

### 12.1 Overview

생성 항목:

```text
- title
- oneLineSummary
- coreProblem
- coreSolution
- keyDecisions
- pendingIssues
- nextActions
```

### 12.2 Topic Map

규칙:

```text
- root는 conversation title
- depth는 최대 3
- 중복 topic 병합
- evidence 없는 topic은 제거 또는 weak 표시
- 관련 decision/pending/action 연결
```

### 12.3 Thought Flow

규칙:

```text
- Timeline이 아니다.
- 시간 표현을 쓰지 않는다.
- segment order를 기준으로 한다.
- Step 1, Step 2 형태로 표시한다.
```

### 12.4 Board

세 칼럼:

```text
Decision
Pending
Action
```

규칙:

```text
- assistant 제안만 있는 것은 Decision이 아니다.
- 사용자가 명시적으로 제외한 기능은 confirmed decision이다.
- action은 실행 가능한 동사형으로 정리한다.
```

### 12.5 Entity Graph

규칙:

```text
- max nodes: 50
- max edges: 80
- UI default nodes: 20
- relation type whitelist 강제
- edge는 evidence가 없으면 제거
```

### 완료 기준

```text
- result JSON에 overview/topicMap/thoughtFlow/board/entityGraph가 모두 있음
- UI가 없어도 JSON만으로 결과 확인 가능
- 모든 decision card에 evidenceIds가 있음
```

---

## 13. Sprint 8 — 결과 UI 구현

### 목표

분석 결과를 사용자가 볼 수 있는 화면으로 구현한다.

### 화면 탭

```text
Overview | Topic Map | Thought Flow | Board | Entity Graph | Export
```

### 우측 패널

```text
- 선택 항목 상세
- Source Evidence
- 관련 message index
- 원문 quote
```

### 컴포넌트 요구사항

#### OverviewPanel

```text
- 한 줄 요약
- 핵심 문제
- 핵심 해결책
- 주요 결정
- 보류사항
- 다음 액션
```

#### TopicMapView

```text
- tree 형태
- 노드 접기/펼치기
- 노드 클릭 시 EvidencePanel 갱신
```

#### ThoughtFlowView

```text
- Step 순서 표시
- 시간 표현 금지
- 각 step 클릭 시 관련 evidence 표시
```

#### BoardView

```text
- Decision / Pending / Action 3 column
- 카드 클릭 시 원문 근거 표시
```

#### EntityGraphView

v0.1에서는 복잡한 그래프 라이브러리에 집착하지 않는다.

허용 방식:

```text
1. node/edge list
2. 간단한 force graph
3. table 기반 relation view
```

Graph UI보다 graph data 품질이 우선이다.

### 완료 기준

```text
- 분석 완료 후 결과 탭이 표시됨
- 각 구조화 항목에서 원문 근거를 볼 수 있음
- Entity Graph는 최소 node/edge 목록으로 확인 가능
```

---

## 14. Sprint 9 — Export

### 목표

구조화 결과를 Markdown과 JSON으로 내보낸다.

### 구현 파일

```text
src/core/export/
  markdownExport.ts
  jsonExport.ts
```

### Markdown 구성

```markdown
# {Conversation Title}

## 1. 한 줄 요약

## 2. 핵심 문제

## 3. 핵심 해결책

## 4. Topic Map

## 5. Thought Flow

## 6. 결정사항

## 7. 보류사항

## 8. 다음 액션

## 9. Entity Graph 요약

## 10. 원문 근거
```

### JSON Export

`AnalysisResult` 전체를 export한다.

민감정보 옵션이 있는 경우:

```text
- full JSON: messages 포함
- structure only JSON: messages 제외, evidence quote 최소화
```

### 완료 기준

```text
- Markdown Export 생성 가능
- JSON Export 생성 가능
- Export 내용이 UI 결과와 일치
```

---

## 15. 에러 처리

Codex는 모든 실패를 명시적 error code로 처리한다.

```ts
export type AnalysisErrorCode =
  | "INVALID_SHARE_URL"
  | "SHARE_LINK_NOT_ACCESSIBLE"
  | "SHARE_LINK_DELETED"
  | "WORKSPACE_RESTRICTED_LINK"
  | "HTML_FETCH_FAILED"
  | "PAYLOAD_NOT_FOUND"
  | "PAYLOAD_DECODE_FAILED"
  | "REFERENCE_DEREFERENCE_FAILED"
  | "LINEAR_CONVERSATION_NOT_FOUND"
  | "NO_MESSAGES_FOUND"
  | "TOO_FEW_MESSAGES"
  | "UNSUPPORTED_CONTENT_ONLY"
  | "LLM_EXTRACTION_FAILED"
  | "STRUCTURE_BUILD_FAILED";
```

사용자 메시지는 기술 에러를 그대로 노출하지 않는다.

예시:

```text
PAYLOAD_NOT_FOUND:
ChatGPT 공유 페이지의 내부 대화 데이터를 찾지 못했습니다. 공유 페이지 구조가 변경되었거나 지원되지 않는 링크일 수 있습니다.

LINEAR_CONVERSATION_NOT_FOUND:
대화 메시지 배열을 복원하지 못했습니다. 일부 응답만 공유된 링크이거나 현재 지원하지 않는 형식일 수 있습니다.

INVALID_SHARE_URL:
지원되는 링크 형식은 https://chatgpt.com/share/... 입니다.
```

---

## 16. 개인정보 / 보안 요구사항

### 반드시 지킬 것

```text
1. 사용자의 ChatGPT 쿠키를 요구하지 않는다.
2. 로그인 세션을 수집하지 않는다.
3. 비공개 ChatGPT URL을 분석하지 않는다.
4. raw HTML은 기본 저장하지 않는다.
5. 사용자가 입력한 URL을 외부 로그에 남기지 않는다.
6. API key, 비밀번호, 개인정보가 포함될 수 있음을 안내한다.
7. 삭제 기능을 위한 구조를 남긴다.
```

### 입력 화면 안내 문구

```text
공유 링크에 포함된 대화 내용을 분석합니다.
민감한 개인정보, 비밀번호, API 키, 고객정보가 포함된 대화는 입력하지 마세요.
```

### 저장 모드

v0.1 최소 구현:

```text
- canonical conversation 저장
- 구조화 결과 저장
- raw HTML 미저장
```

추후 구현:

```text
- Structure Only 모드
- Session Only 모드
```

---

## 17. 테스트 전략

### 17.1 Unit Tests

필수 테스트:

```text
validateShareUrl.test.ts
- valid chatgpt.com/share URL 허용
- chat.openai.com/c URL 거부
- 일반 URL 거부
- malformed URL 거부

extractEnqueuePayloads.test.ts
- 단일 enqueue 추출
- 복수 enqueue 순서 보존
- escaped quote 포함 payload 처리
- payload 없음 에러

dereference.test.ts
- _숫자 ref 치환
- nested object 치환
- array 내부 ref 치환
- unresolved ref 처리
- circular ref 처리
- maxDepth 처리

normalizeConversation.test.ts
- user/assistant role 정규화
- 빈 메시지 제거
- unsupported content placeholder 처리
- message index 부여

validateExtraction.test.ts
- evidence 없는 decision 제거
- invalid relation 제거
- duplicate decision 병합
```

### 17.2 Integration Tests

```text
chatgptShareAdapter.test.ts
- fixture HTML → CanonicalConversation
- message count 확인
- 첫 user message 확인
- assistant message 확인

runAnalysisJob.test.ts
- fixture URL mock fetch
- import → segment → mock extraction → structures 생성
```

### 17.3 Fixture 정책

```text
1. 개인정보 없는 공유 대화만 fixture로 사용
2. raw HTML fixture는 git에 올리기 전 민감정보 제거
3. 최소 fixture 5개 확보
   - simple-ko.html
   - simple-en.html
   - long-planning-ko.html
   - code-block.html
   - table-list-heavy.html
```

---

## 18. Acceptance Gates

Codex는 각 gate를 순서대로 통과해야 한다.  
이전 gate가 통과하지 않으면 다음 gate 구현에 들어가지 않는다.

### Gate 1 — Adapter Gate

```text
입력: ChatGPT share fixture HTML
출력: CanonicalConversation JSON

통과 기준:
- totalMessages > 0
- userMessages > 0
- assistantMessages > 0
- message index가 1부터 순서대로 부여됨
- 첫 user message text가 비어 있지 않음
```

### Gate 2 — Viewer Gate

```text
입력: Share URL
출력: 웹 화면의 message list

통과 기준:
- user/assistant 메시지가 순서대로 표시됨
- code block이 깨지지 않음
- 에러 발생 시 error code와 사용자 메시지가 표시됨
```

### Gate 3 — Mock Structure Gate

```text
입력: CanonicalConversation
처리: MockExtractor
출력: Overview / Topic Map / Board

통과 기준:
- Overview가 표시됨
- Topic Map root가 있음
- Board 3 column이 표시됨
- 각 decision에는 evidence가 있음
```

### Gate 4 — LLM Extraction Gate

```text
입력: 실제 대화 segment
처리: RuleExtractor + LLMExtractor Shadow Mode + Evidence Verifier + Conflict Resolver
출력: HybridExtractionResult

통과 기준:
- schema validation 통과
- Rule 결과와 LLM 결과가 분리 저장됨
- EvidenceMatch의 quote/span이 원문과 일치함
- invalid output은 rejectedItems로 이동함
- unresolved conflict와 low-confidence item은 Review Queue로 이동함
- LLM 결과가 검증 없이 Main Board에 직접 노출되지 않음
```

### Gate 5 — Full MVP Gate

```text
입력: ChatGPT share URL
출력: 전체 결과 화면 + export

통과 기준:
- Overview / Topic Map / Thought Flow / Board / Entity Graph 탭이 있음
- Source Evidence 확인 가능
- Markdown Export 가능
- JSON Export 가능
- PDF, Ask, RAG, Chrome Extension 기능 없음
```

---

## 19. Codex 작업 규칙

Codex는 다음 규칙을 따른다.

```text
1. 한 번에 전체 서비스를 만들지 말고 Sprint 순서대로 구현한다.
2. 먼저 ChatGPTShareAdapter를 완성한다.
3. LLMExtractor보다 MockExtractor를 먼저 만든다.
4. LLMExtractor는 Shadow Mode로 시작하며 최종 결정권을 갖지 않는다.
5. UI보다 CanonicalConversation JSON 생성을 우선한다.
6. 타입과 테스트를 먼저 작성한다.
7. 실패 케이스를 정상 케이스만큼 중요하게 다룬다.
8. 외부 서비스 HTML 구조에 의존하는 코드는 adapter 내부에만 둔다.
9. 기술명세서에 없는 기능을 임의로 추가하지 않는다.
10. PDF 관련 코드는 만들지 않는다.
11. Ask/RAG 관련 코드는 만들지 않는다.
```

각 작업 완료 후 다음 명령이 통과해야 한다.

```bash
npm run typecheck
npm run test
npm run build
```

---

## 20. 첫 번째 Codex 프롬프트

Codex에 처음 줄 지시는 아래처럼 시작한다.

```text
Read these documents first:
1. JARVIS_Context_Mapper_기획안.md
2. JARVIS_Context_Mapper_기술명세서.md
3. CODEX_IMPLEMENTATION_PLAN.md

Implement Sprint 0 and Sprint 1 only.

Do not implement PDF upload, Chrome extension, Ask/RAG, authentication, payment, collaboration, or graph database.

The first goal is to build ChatGPTShareAdapter.
It must convert a ChatGPT share URL or fixture HTML into CanonicalConversation JSON.

Required modules:
- validateShareUrl
- fetchShareHtml
- extractEnqueuePayloads
- decodePayloads
- dereference
- restoreConversation
- normalizeConversation

Add unit tests for URL validation, enqueue extraction, dereference, and conversation normalization.
Use mock/fixture HTML for tests.
The build is complete only when typecheck and tests pass.
```

---

## 21. 두 번째 Codex 프롬프트

Sprint 1이 통과한 뒤 다음 지시를 준다.

```text
Implement Sprint 2 and Sprint 3.

Build the API flow:
- POST /api/analyses
- GET /api/analyses/{analysisId}
- GET /api/analyses/{analysisId}/messages

Add a simple URL input page and a MessageViewer page.
The goal is to let a user paste a ChatGPT share URL and see the restored user/assistant messages in order.

Use the existing ChatGPTShareAdapter.
Do not implement LLM extraction yet.
Do not implement PDF upload.
```

---

## 22. 세 번째 Codex 프롬프트

Sprint 2~3이 통과한 뒤 다음 지시를 준다.

```text
Implement Sprint 4, Sprint 5, and Sprint 6 using MockExtractor first.

Add:
- segmentConversation
- MockExtractor
- extraction schemas
- validateExtraction
- validateEvidence
- validateGraph

The output should be an AnalysisResult with:
- conversation
- segments
- evidence
- overview placeholder
- topicMap placeholder
- board placeholder
- entityGraph placeholder

Do not call any real LLM yet.
Make the full pipeline deterministic and testable.
```

---

## 23. 네 번째 Codex 프롬프트

Mock pipeline이 통과한 뒤 다음 지시를 준다.

```text
Implement LLMExtractor with structured JSON output.

Requirements:
- Use the existing extraction schemas.
- Return topics, decisions, pending issues, action items, entities, and relations.
- Every item must include evidenceMessageIndexes.
- Invalid outputs must be rejected by validateExtraction.
- If OPENAI_API_KEY is missing, fall back to MockExtractor.

Do not change ChatGPTShareAdapter behavior.
```

---

## 24. 다섯 번째 Codex 프롬프트

LLM extraction이 통과한 뒤 다음 지시를 준다.

```text
Implement Sprint 7, Sprint 8, and Sprint 9.

Build:
- OverviewPanel
- TopicMapView
- ThoughtFlowView
- BoardView
- EntityGraphView
- EvidencePanel
- Markdown Export
- JSON Export

The UI must use the AnalysisResult generated by the pipeline.
Every structured item should be able to show source evidence.

Do not implement Ask/RAG.
Do not implement PDF upload.
```

---

## 25. 최종 완료 기준

v0.1 개발 완료는 다음 조건을 모두 만족할 때로 정의한다.

```text
1. 사용자가 ChatGPT 공유 링크를 입력할 수 있다.
2. 서버가 공유 페이지 HTML에서 대화 payload를 복원한다.
3. user/assistant 전체 메시지가 순서대로 CanonicalConversation에 저장된다.
4. 메시지 Viewer에서 원문 대화를 확인할 수 있다.
5. Segmenter가 대화를 의미 단위로 나눈다.
6. Context Extractor가 Topic/Decision/Pending/Action/Entity/Relation 후보를 생성한다.
7. Validator가 evidence 없는 항목과 invalid relation을 제거한다.
8. Overview가 생성된다.
9. Topic Map이 생성된다.
10. Thought Flow가 생성된다.
11. Decision/Pending/Action Board가 생성된다.
12. Entity Graph 데이터가 생성된다.
13. 각 구조화 항목에서 Source Evidence를 확인할 수 있다.
14. Markdown Export가 가능하다.
15. JSON Export가 가능하다.
16. PDF 업로드 기능이 없다.
17. Ask/RAG 기능이 없다.
18. npm run typecheck/test/build가 통과한다.
```

---

## 26. v0.1 이후 TODO

v0.1 완료 후에만 검토한다.

```text
1. PDF Adapter
2. Chrome Extension DOM Extractor
3. 여러 대화 프로젝트 병합
4. Notion Export
5. Graph View 고도화
6. Structure Only 저장 모드
7. Session Only 모드
8. 사용자 계정
9. 팀 공유
10. JARVIS 장기기억 엔진 연결
```

---

## 27. 한 줄 요약

> Codex는 먼저 전체 제품을 만들려고 하지 말고, `ChatGPTShareAdapter → CanonicalConversation → Mock Structure Pipeline → LLM Extraction → UI/Export` 순서로 구현해야 한다.
