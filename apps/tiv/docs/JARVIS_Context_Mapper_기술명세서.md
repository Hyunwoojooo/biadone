# JARVIS Context Mapper 기술 명세서

## v0.1 — ChatGPT 공유 링크 기반 대화 구조화 시스템

문서 상태: Draft v0.1  
작성 목적: 개발팀이 바로 시스템 설계, 모듈 분리, 구현 범위 산정에 사용할 수 있는 기술 명세서  
입력 방식: ChatGPT 공유 링크  
후순위 기능: PDF 업로드, Chrome Extension, 여러 대화 병합, Ask/RAG

---

## 0. 핵심 결정

v0.1에서는 PDF 업로드를 제외한다.

초기 입력 방식은 **ChatGPT 공유 링크**만 사용한다.

최종 파이프라인은 다음과 같이 정의한다.

```text
ChatGPT Share URL
→ HTML Fetch
→ Shared Page Payload 추출
→ JS Stream Payload Decode
→ Reference Table Dereference
→ linear_conversation 복원
→ Canonical Conversation Format 변환
→ Segment 분리
→ LLM 기반 맥락 추출
→ Topic Map / Thought Flow / Board / Entity Graph 생성
→ Source Evidence 연결
→ Export
```

이 방식의 핵심은 PDF처럼 납작해진 출력물을 읽는 것이 아니라, **공유 페이지 HTML 안에 포함된 대화 원본 구조에 가까운 데이터를 복원하는 것**이다.

단, ChatGPT 공유 페이지 내부 hydration/stream payload 구조는 공식 API가 아니다. 따라서 해당 기능은 제품 핵심 로직에 직접 묶지 않고, 반드시 `ChatGPTShareAdapter`라는 독립 어댑터로 격리한다.

---

## 1. 제품 범위

### 1.1 v0.1에서 하는 것

```text
1. ChatGPT 공유 링크 입력
2. 공유 페이지 HTML 다운로드
3. HTML 내부 대화 payload 추출
4. 대화 메시지 전체 복원
5. user / assistant 메시지 순서화
6. 대화 맥락 추출
7. Topic Map 생성
8. Thought Flow 생성
9. Decision / Pending / Action Board 생성
10. Entity Graph 생성
11. 원문 근거 연결
12. Markdown / JSON Export
```

### 1.2 v0.1에서 하지 않는 것

```text
1. PDF 업로드
2. Chrome Extension
3. 사용자의 비공개 ChatGPT 계정 직접 접근
4. ChatGPT 로그인 세션 / 쿠키 수집
5. Ask Memory / RAG 검색
6. 구조화된 대화에 다시 질문하기
7. 여러 대화 자동 병합
8. 장기기억 자동 업데이트
9. 실시간 대화 캡처
```

PDF 업로드는 나중에 `PdfAdapter`로 추가한다.  
v0.1에서는 `ChatGPTShareAdapter`만 구현한다.

---

## 2. 전체 시스템 아키텍처

### 2.1 상위 구조

```text
┌────────────────────────────┐
│ Frontend                   │
│ - Share URL 입력            │
│ - 분석 상태 표시             │
│ - 구조화 결과 UI             │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ API Server                 │
│ - URL validation            │
│ - analysis job 생성          │
│ - 결과 조회                  │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ ChatGPTShareAdapter         │
│ - HTML fetch                 │
│ - payload extract            │
│ - stream decode              │
│ - dereference                │
│ - conversation restore       │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Canonical Conversation      │
│ - messages                  │
│ - roles                     │
│ - content blocks            │
│ - source refs               │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Context Pipeline            │
│ - segmentation              │
│ - LLM extraction             │
│ - validation                │
│ - merge                     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Structure Builder           │
│ - Overview                  │
│ - Topic Map                 │
│ - Thought Flow              │
│ - Board                     │
│ - Entity Graph              │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Renderer / Exporter         │
│ - Web UI                    │
│ - Markdown                  │
│ - JSON                      │
└────────────────────────────┘
```

### 2.2 모듈 구성

```text
src/
  adapters/
    chatgpt-share/
      index.ts
      validateShareUrl.ts
      fetchHtml.ts
      extractStreamPayload.ts
      decodePayload.ts
      dereference.ts
      restoreConversation.ts
      normalizeConversation.ts
      tests/

  domain/
    conversation/
      canonicalConversation.ts
      message.ts
      evidence.ts

    context/
      segment.ts
      extractionSchema.ts
      validator.ts
      merger.ts

    structure/
      overview.ts
      topicMap.ts
      thoughtFlow.ts
      board.ts
      entityGraph.ts

  services/
    analysisJobService.ts
    llmExtractionService.ts
    exportService.ts

  api/
    analyses.ts
    exports.ts
```

---

## 3. 입력 방식 명세

### 3.1 입력값

사용자는 다음 형태의 URL을 입력한다.

```text
https://chatgpt.com/share/<conversation-ID>
```

### 3.2 입력 검증

서버는 다음 조건을 검증한다.

```text
1. URL scheme이 https인지
2. hostname이 chatgpt.com인지
3. pathname이 /share/ 로 시작하는지
4. conversation ID가 존재하는지
5. query string을 제거하거나 canonicalize할 수 있는지
6. URL 길이가 비정상적으로 길지 않은지
```

예시 타입:

```ts
type ShareUrlValidationResult = {
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

### 3.3 보안상 금지할 입력

다음 입력은 v0.1에서 허용하지 않는다.

```text
1. chat.openai.com/c/... 비공개 대화 URL
2. 사용자의 ChatGPT 세션 쿠키
3. 로그인 필요한 workspace 내부 링크
4. Enterprise / Business 워크스페이스 전용 링크
5. 일반 웹 URL
6. 파일 업로드
```

---

## 4. 사용자 플로우

### 4.1 정상 플로우

```text
1. 사용자가 ChatGPT에서 공유 링크를 생성한다.
2. 서비스에 공유 링크를 입력한다.
3. 서버가 URL을 검증한다.
4. 서버가 공유 페이지 HTML을 다운로드한다.
5. HTML 내부 stream payload를 추출한다.
6. payload를 decode / dereference한다.
7. linear_conversation을 복원한다.
8. conversation을 표준 포맷으로 변환한다.
9. LLM API로 맥락을 추출한다.
10. 구조화 결과를 생성한다.
11. 사용자가 Topic Map / Thought Flow / Board / Entity Graph를 확인한다.
12. 사용자가 Markdown 또는 JSON으로 내보낸다.
```

### 4.2 실패 플로우

```text
1. 링크가 유효하지 않음
   → URL 오류 표시

2. 링크가 삭제됨
   → 공유 링크가 더 이상 접근 불가능하다고 표시

3. 링크가 workspace 내부 전용임
   → 현재 v0.1에서는 분석할 수 없다고 표시

4. HTML은 받았지만 payload를 찾지 못함
   → ChatGPT 공유 페이지 구조 변경 가능성 표시

5. payload는 찾았지만 dereference 실패
   → parser version mismatch로 표시

6. 대화 메시지 수가 너무 적음
   → 일부 응답만 공유된 링크일 수 있다고 경고

7. LLM 구조화 실패
   → 원본 대화 복원 결과는 보여주고 구조화 재시도 버튼 제공
```

---

## 5. ChatGPT Share Adapter 명세

### 5.1 역할

`ChatGPTShareAdapter`의 역할은 ChatGPT 공유 링크를 **표준 대화 포맷**으로 변환하는 것이다.

```text
Input:
  ChatGPT Share URL

Output:
  CanonicalConversation
```

Adapter 내부 구현은 외부 서비스의 HTML 구조 변화에 취약하므로 제품 핵심 로직과 분리한다.

```text
src/
  adapters/
    chatgpt-share/
      index.ts
      fetchHtml.ts
      extractStreamPayload.ts
      decodePayload.ts
      dereference.ts
      restoreConversation.ts
      normalizeConversation.ts
      tests/
```

### 5.2 처리 단계

```text
ChatGPTShareAdapter.run(url)
  1. validateShareUrl(url)
  2. fetchShareHtml(url)
  3. extractEnqueuePayloads(html)
  4. decodeEnqueueStrings(payloads)
  5. parseStreamObjects(decodedStrings)
  6. buildReferenceTable(streamObjects)
  7. dereferenceRootObject(referenceTable)
  8. findLinearConversation(rootObject)
  9. restoreMessages(linearConversation)
  10. normalizeToCanonicalConversation(messages)
```

---

## 6. HTML Fetch 명세

### 6.1 요청 방식

서버에서 `GET` 요청으로 공유 페이지 HTML을 가져온다.

```ts
type FetchShareHtmlInput = {
  url: string;
  timeoutMs: number;
  userAgent: string;
};

type FetchShareHtmlOutput = {
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
  contentLength: number;
};
```

### 6.2 권장 fetch 정책

```text
timeout: 10초
redirect: follow
max redirects: 3
content-type: text/html 우선
max body size: 20MB
retry: 1회
```

### 6.3 fetch 실패 코드

```ts
type FetchErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "NON_200_STATUS"
  | "TOO_LARGE_RESPONSE"
  | "HTML_NOT_FOUND"
  | "ACCESS_DENIED"
  | "LINK_DELETED_OR_INVALID";
```

---

## 7. Payload Extraction 명세

### 7.1 목표

HTML 안에서 다음 패턴의 payload를 찾는다.

```js
window.__reactRouterContext.streamController.enqueue(...)
```

현재 관찰된 구조 기준으로는 `enqueue("...")` 안에 escaped JSON 문자열이 들어 있고, 이 문자열을 풀면 `_193`, `_200` 같은 참조 인덱스를 포함한 데이터 구조가 나온다.

이 구조는 공식 문서화된 API가 아니므로, 명세에서는 다음처럼 부른다.

```text
ChatGPT Shared Page Stream Payload
```

### 7.2 추출 대상

```ts
type RawEnqueuePayload = {
  order: number;
  rawArgument: string;
  startOffset: number;
  endOffset: number;
};
```

### 7.3 추출 알고리즘

단순 정규식 하나로 끝내면 위험하다. 문자열 escape, 괄호, 따옴표가 섞일 수 있기 때문이다.

권장 알고리즘:

```text
1. HTML에서 "streamController.enqueue" 위치를 모두 찾는다.
2. 각 위치에서 첫 번째 "("를 찾는다.
3. JS string literal boundary를 인식하면서 ")"까지 스캔한다.
4. enqueue의 첫 번째 argument를 추출한다.
5. argument가 문자열이면 JSON.parse 또는 JS string unescape로 decode한다.
6. decode 결과를 stream chunk로 저장한다.
```

### 7.4 실패 조건

```ts
type PayloadExtractionErrorCode =
  | "ENQUEUE_PATTERN_NOT_FOUND"
  | "UNTERMINATED_ENQUEUE_CALL"
  | "INVALID_JS_STRING_LITERAL"
  | "DECODE_FAILED"
  | "NO_CONVERSATION_PAYLOAD_CANDIDATE";
```

### 7.5 Parser Versioning

이 adapter는 반드시 parser version을 가져야 한다.

```ts
const CHATGPT_SHARE_ADAPTER_VERSION = "chatgpt-share-adapter@0.1.0";
```

복원 결과에도 version을 기록한다.

```json
{
  "adapter": {
    "name": "ChatGPTShareAdapter",
    "version": "0.1.0"
  }
}
```

이유는 ChatGPT 공유 페이지 내부 구조가 바뀌었을 때, 어떤 버전의 파서가 어떤 결과를 만들었는지 추적해야 하기 때문이다.

---

## 8. Stream Decode / Dereference 명세

### 8.1 입력

```ts
type DecodedStreamChunk = unknown;
```

여러 개의 `enqueue(...)` chunk가 있을 수 있다.

### 8.2 참조 테이블 구조

payload가 다음과 같은 참조 구조를 가질 수 있다.

```json
{
  "_193": ["some", "value"],
  "_200": {
    "role": "user"
  }
}
```

또는 특정 배열 인덱스와 `_숫자` 문자열이 서로 연결될 수 있다.

따라서 dereference는 다음 역할을 한다.

```text
1. reference table을 만든다.
2. _숫자 형태의 참조를 실제 값으로 치환한다.
3. 객체 / 배열 내부를 재귀적으로 순회한다.
4. 순환 참조를 감지한다.
5. max depth를 둔다.
```

### 8.3 Dereference 함수 명세

```ts
type DereferenceOptions = {
  maxDepth: number;        // 기본 100
  maxNodes: number;        // 기본 100_000
  preserveUnknownRefs: boolean;
};

type DereferenceResult = {
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

### 8.4 Dereference 기본 의사코드

```ts
function deref(value: unknown, ctx: DerefContext, depth = 0): unknown {
  if (depth > ctx.maxDepth) {
    ctx.warnings.push("MAX_DEPTH_REACHED");
    return value;
  }

  if (typeof value === "string" && /^_\d+$/.test(value)) {
    const resolved = ctx.refTable.get(value);
    if (resolved === undefined) {
      ctx.unresolvedRefs++;
      return ctx.preserveUnknownRefs ? value : null;
    }

    if (ctx.visiting.has(value)) {
      ctx.warnings.push(`CIRCULAR_REF:${value}`);
      return null;
    }

    ctx.visiting.add(value);
    const out = deref(resolved, ctx, depth + 1);
    ctx.visiting.delete(value);
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deref(item, ctx, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deref(v, ctx, depth + 1);
    }
    return out;
  }

  return value;
}
```

---

## 9. Conversation Restore 명세

### 9.1 목표

dereference된 root object에서 실제 대화 배열을 찾고, 전체 메시지를 복원한다.

우리가 찾는 핵심 후보는 다음이다.

```text
linear_conversation
messages
mapping
conversation
```

현재 관찰된 구조에서는 `linear_conversation`을 1순위로 사용한다.

### 9.2 대화 메시지 추출 기준

각 message에서 다음 정보를 복원한다.

```ts
type RawChatGPTMessage = {
  id?: string;
  role?: "user" | "assistant" | "system" | "tool" | string;
  authorRole?: string;
  content?: unknown;
  createTime?: number | null;
  updateTime?: number | null;
  metadata?: Record<string, unknown>;
  parentId?: string | null;
  childrenIds?: string[];
};
```

### 9.3 content 복원

ChatGPT 메시지 content는 단순 문자열이 아닐 수 있다.

가능한 content 형태:

```text
1. plain text
2. markdown text
3. parts array
4. code block
5. table
6. tool result
7. image/file placeholder
8. canvas/artifact metadata
```

v0.1에서는 다음만 정식 지원한다.

```text
1. text
2. markdown
3. code block
4. list/table은 markdown text로 유지
```

이미지, 파일, tool result는 placeholder로 처리한다.

```json
{
  "type": "unsupported_attachment",
  "label": "image",
  "text": "[이미지 첨부: v0.1에서는 분석 제외]"
}
```

### 9.4 메시지 필터링

다음 메시지는 기본 분석에서 제외한다.

```text
1. system message
2. internal tool message
3. 빈 assistant message
4. content가 없는 message
5. hidden metadata-only message
```

단, 추적용 raw message는 저장할 수 있다.

### 9.5 최종 메시지 순서

`linear_conversation`이 있으면 그 순서를 따른다.

만약 없으면 fallback으로 다음 순서를 시도한다.

```text
1. create_time 기준
2. parent-child traversal
3. HTML 등장 순서
```

하지만 v0.1에서는 `linear_conversation`이 없으면 실패 처리해도 된다.

---

## 10. Canonical Conversation Format

### 10.1 목적

ChatGPT 공유 링크 내부 포맷은 언제든 바뀔 수 있다.  
따라서 이후 구조화 파이프라인은 ChatGPT 내부 포맷에 의존하면 안 된다.

모든 입력은 아래 표준 포맷으로 변환한다.

```ts
type CanonicalConversation = {
  id: string;
  source: ConversationSource;
  title: string | null;
  language: string | null;
  createdAt: string | null;
  importedAt: string;
  messages: CanonicalMessage[];
  stats: ConversationStats;
  warnings: ImportWarning[];
};

type ConversationSource = {
  type: "chatgpt_share_link";
  originalUrl: string;
  normalizedUrl: string;
  shareId: string;
  adapterName: "ChatGPTShareAdapter";
  adapterVersion: string;
  fetchedAt: string;
};

type CanonicalMessage = {
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

type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string | null; text: string }
  | { type: "quote"; text: string }
  | { type: "table_markdown"; text: string }
  | { type: "unsupported"; label: string; text: string };

type SourceRef = {
  type: "chatgpt_share_payload";
  messageId: string | null;
  messageIndex: number;
  role: string;
};

type ConversationStats = {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  unsupportedMessages: number;
  totalChars: number;
};

type ImportWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};
```

### 10.2 중요한 설계 원칙

이 표준 포맷에는 PDF의 `page/bbox`가 없다.  
대신 Source Evidence는 다음 기준으로 연결한다.

```text
Evidence → message_id / message_index / text span
```

즉, v0.1의 원문 근거는 PDF 페이지가 아니라 **공유 대화의 메시지 단위 근거**다.

---

## 11. Source Evidence 명세

### 11.1 Evidence Anchor

모든 추출 결과는 원문 메시지와 연결되어야 한다.

```ts
type EvidenceAnchor = {
  id: string;
  conversationId: string;
  messageId: string;
  messageIndex: number;
  role: "user" | "assistant";
  textSpan: {
    startChar: number;
    endChar: number;
  } | null;
  quote: string;
  evidenceType: "direct_quote" | "paraphrase" | "inferred_from_context";
};
```

### 11.2 Evidence 정책

```text
1. Decision은 최소 1개 이상의 evidence를 가져야 한다.
2. Pending Issue는 최소 1개 이상의 evidence를 가져야 한다.
3. Action Item은 evidence가 없으면 “suggested” 상태로 표시한다.
4. Entity relation은 evidence가 없으면 graph에 표시하지 않는다.
5. LLM이 만든 모든 항목은 source message index를 가져야 한다.
```

### 11.3 Evidence 품질 등급

```ts
type EvidenceConfidence =
  | "explicit_user_statement"
  | "explicit_assistant_statement"
  | "agreed_conclusion"
  | "model_inference"
  | "weak_inference";
```

예시:

```json
{
  "id": "ev_001",
  "messageIndex": 5,
  "role": "user",
  "quote": "사용자가 구조화된 대화 내용에서 다시 질문하는건 안할거야.",
  "evidenceType": "direct_quote",
  "confidence": "explicit_user_statement"
}
```

---

## 12. Segmenter 명세

### 12.1 목적

긴 대화를 그대로 LLM에 넣지 않고, 의미 단위로 나눈다.

```text
CanonicalConversation
→ Segment[]
```

### 12.2 Segment 정의

```ts
type ConversationSegment = {
  id: string;
  order: number;
  title: string;
  summary: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
  };
  messages: string[];
  topicShiftReason:
    | "new_user_question"
    | "explicit_transition"
    | "semantic_shift"
    | "length_limit"
    | "manual";
};
```

### 12.3 Segment 분리 기준

```text
1. 사용자의 새 질문 또는 새 지시
2. “그렇다면”, “다시”, “이제”, “최종본”, “개발 얘기” 같은 전환 표현
3. 앞뒤 메시지의 의미 차이
4. segment 길이 제한
5. 하나의 assistant 장문 답변이 지나치게 긴 경우
```

### 12.4 Segment 길이 정책

```text
권장 길이:
- 2~8 messages
- 또는 4,000~8,000 characters

너무 짧은 segment:
- 이전/다음 segment와 병합

너무 긴 segment:
- assistant 답변의 heading 기준으로 재분할
```

### 12.5 LLM 사용 여부

Segment title과 summary는 LLM을 사용한다.  
Segment boundary는 규칙 기반 + LLM 보조를 섞는다.

---

## 13. LLM Context Extraction 명세

### 13.1 역할

LLM은 원문 대화에서 다음 맥락 후보를 추출한다.

```text
1. Topic
2. Subtopic
3. Problem
4. Goal
5. Decision
6. Pending Issue
7. Action Item
8. Entity
9. Relationship
10. Constraint
11. Assumption
12. Alternative
13. Rationale
```

이 작업은 JSON Schema 기반 structured extraction으로 수행한다.

### 13.2 LLM 호출 단위

```text
1차: segment별 context extraction
2차: 전체 conversation-level merge
3차: structure generation
4차: graph relation normalization
```

### 13.3 Segment Extraction Schema

```ts
type SegmentExtraction = {
  segmentId: string;
  topics: ExtractedTopic[];
  decisions: ExtractedDecision[];
  pendingIssues: ExtractedPendingIssue[];
  actionItems: ExtractedActionItem[];
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  constraints: ExtractedConstraint[];
};

type ExtractedTopic = {
  title: string;
  summary: string;
  evidenceMessageIndexes: number[];
};

type ExtractedDecision = {
  title: string;
  description: string;
  decisionStatus: "confirmed" | "rejected" | "suggested" | "unclear";
  madeBy: "user" | "assistant" | "both" | "inferred";
  rationale: string | null;
  evidenceMessageIndexes: number[];
};

type ExtractedPendingIssue = {
  title: string;
  description: string;
  options: string[];
  evidenceMessageIndexes: number[];
};

type ExtractedActionItem = {
  title: string;
  description: string;
  owner: "user" | "team" | "unknown";
  priority: "high" | "medium" | "low" | "unknown";
  evidenceMessageIndexes: number[];
};

type ExtractedEntity = {
  name: string;
  canonicalNameHint: string | null;
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
    | "data_source"
    | "unknown";
  description: string;
  evidenceMessageIndexes: number[];
};

type ExtractedRelation = {
  sourceEntity: string;
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
  targetEntity: string;
  description: string;
  evidenceMessageIndexes: number[];
};

type ExtractedConstraint = {
  title: string;
  description: string;
  evidenceMessageIndexes: number[];
};
```

### 13.4 Decision 판정 정책

Decision은 엄격하게 판단한다.

```text
Decision으로 인정:
1. 사용자가 명시적으로 확정함
2. “빼자”, “하지 않을거야”, “이걸로 하자” 등 명확한 표현이 있음
3. 이후 대화에서 해당 방향을 전제로 논의함
4. assistant 제안에 사용자가 동의하거나 수정 없이 받아들임

Decision으로 인정하지 않음:
1. assistant 혼자 제안함
2. 여러 대안 중 하나로 언급됨
3. 검토 필요로 남아 있음
4. evidence가 없음
```

예시 decision:

```text
- PDF 업로드는 v0.1에서 제외하고 추후 기능으로 뺀다.
- v0.1은 링크 기반 대화 분석으로 잡는다.
- 구조화된 대화에 다시 질문하는 기능은 넣지 않는다.
- 시간 기반 Timeline은 넣지 않는다.
```

---

## 14. Context Validator 명세

LLM 출력은 최종 결과가 아니라 후보군이다.  
따라서 반드시 검증한다.

### 14.1 검증 단계

```text
1. JSON Schema validation
2. required field validation
3. enum validation
4. evidenceMessageIndexes 존재 여부 확인
5. message index 범위 확인
6. quote span 생성 가능 여부 확인
7. 중복 topic / decision / entity 병합
8. relation source / target entity 존재 여부 확인
9. relation type whitelist 확인
10. hallucination 의심 항목 제거 또는 weak 표시
```

### 14.2 Validator Output

```ts
type ValidationResult<T> = {
  validItems: T[];
  rejectedItems: RejectedItem[];
  warnings: ValidationWarning[];
};

type RejectedItem = {
  itemType: string;
  item: unknown;
  reason:
    | "MISSING_EVIDENCE"
    | "INVALID_ENUM"
    | "OUT_OF_RANGE_MESSAGE_INDEX"
    | "DUPLICATE"
    | "UNSUPPORTED_RELATION"
    | "WEAK_INFERENCE";
};
```

---

## 15. Structure Builder 명세

Context extraction 결과를 사용자 화면에 맞게 재구성한다.

### 15.1 생성할 구조

```text
1. Overview
2. Topic Map
3. Thought Flow
4. Decision / Pending / Action Board
5. Entity Graph
6. Source Evidence
7. Export Document
```

### 15.2 Overview

```ts
type Overview = {
  title: string;
  oneLineSummary: string;
  coreProblem: string;
  coreSolution: string;
  keyDecisions: string[];
  pendingIssues: string[];
  nextActions: string[];
  evidenceIds: string[];
};
```

생성 기준:

```text
- 전체 대화의 핵심 문제
- 최종 방향
- 확정된 결정
- 남은 쟁점
- 실행 항목
```

### 15.3 Topic Map

```ts
type TopicNode = {
  id: string;
  title: string;
  summary: string;
  children: TopicNode[];
  relatedDecisionIds: string[];
  relatedPendingIssueIds: string[];
  relatedActionItemIds: string[];
  evidenceIds: string[];
};
```

제약:

```text
1. depth는 v0.1에서 최대 3단계
2. evidence 없는 topic은 표시하지 않거나 weak 표시
3. 같은 이름의 topic은 병합
4. 너무 추상적인 topic은 제거
5. root는 conversation title 또는 자동 생성 title
```

### 15.4 Thought Flow

Timeline이 아니라 메시지 순서 기반 논점 흐름이다.

```ts
type ThoughtFlowStep = {
  id: string;
  order: number;
  title: string;
  summary: string;
  segmentId: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
  };
  relatedDecisionIds: string[];
  relatedPendingIssueIds: string[];
  evidenceIds: string[];
};
```

생성 기준:

```text
1. segment order를 따른다.
2. 시간 표현을 쓰지 않는다.
3. “Step 1, Step 2” 또는 “문제 제기 → 방향 수정”으로 표현한다.
4. 같은 논점이 반복되면 하나로 병합한다.
```

### 15.5 Decision / Pending / Action Board

```ts
type Board = {
  decisions: DecisionCard[];
  pendingIssues: PendingCard[];
  actionItems: ActionCard[];
};

type DecisionCard = {
  id: string;
  title: string;
  description: string;
  rationale: string | null;
  status: "confirmed" | "rejected";
  evidenceIds: string[];
};

type PendingCard = {
  id: string;
  title: string;
  description: string;
  options: string[];
  evidenceIds: string[];
};

type ActionCard = {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low" | "unknown";
  owner: "user" | "team" | "unknown";
  evidenceIds: string[];
};
```

---

## 16. Entity Graph 명세

### 16.1 목적

대화 속 핵심 개념과 관계를 graph 형태로 보여준다.

JARVIS 관점에서 이 레이어는 중요하다. 장기적으로 JARVIS는 raw data를 episode/event로 만들고, entity/fact/relationship을 추출하는 방향으로 확장되어야 한다.

### 16.2 Graph Schema

```ts
type EntityGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphNode = {
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

type GraphEdge = {
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

### 16.3 Entity Canonicalization

LLM이 같은 개념을 여러 이름으로 뽑을 수 있다.

예시:

```text
JARVIS
J.A.R.V.I.S
자비스
개인 AI 비서
```

이를 하나의 canonical entity로 묶는다.

```ts
type CanonicalEntity = {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: string;
  mergedFrom: string[];
};
```

### 16.4 Canonicalization 규칙

```text
1. 대소문자 차이는 병합
2. 점 / 하이픈 / 공백 차이는 병합 후보
3. 한국어 / 영어 alias는 embedding similarity로 후보 생성
4. 같은 segment에서 동일 설명을 가지면 병합 후보
5. product / feature / problem type이 다르면 자동 병합하지 않음
6. 애매하면 별도 노드로 유지
```

### 16.5 Graph Validation

```text
1. 모든 edge는 source / target node가 존재해야 한다.
2. 모든 edge는 relation type whitelist 안에 있어야 한다.
3. 모든 edge는 evidence를 가져야 한다.
4. self-loop는 기본 제거한다.
5. MENTIONS 외 relation은 description을 가져야 한다.
6. 노드 수가 너무 많으면 중요도 기준으로 상위 N개만 UI에 표시한다.
```

v0.1 권장 제한:

```text
max nodes: 50
max edges: 80
UI default nodes: 20
```

---

## 17. 데이터 저장 명세

### 17.1 저장 단위

```text
1. analysis_job
2. source_import
3. canonical_conversation
4. messages
5. segments
6. context_items
7. evidence
8. structures
9. exports
```

### 17.2 PostgreSQL 테이블 초안

```sql
analysis_jobs (
  id uuid primary key,
  user_id uuid null,
  status text not null,
  input_url text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  error_code text null,
  error_message text null
);

source_imports (
  id uuid primary key,
  job_id uuid not null,
  source_type text not null,
  normalized_url text not null,
  share_id text not null,
  adapter_name text not null,
  adapter_version text not null,
  fetched_at timestamptz not null,
  raw_html_stored boolean not null default false,
  import_warnings jsonb not null default '[]'
);

conversations (
  id uuid primary key,
  job_id uuid not null,
  title text null,
  language text null,
  stats jsonb not null,
  canonical_json jsonb not null,
  created_at timestamptz not null
);

messages (
  id uuid primary key,
  conversation_id uuid not null,
  message_index int not null,
  role text not null,
  text text not null,
  blocks jsonb not null,
  source_ref jsonb not null
);

segments (
  id uuid primary key,
  conversation_id uuid not null,
  segment_order int not null,
  title text not null,
  summary text not null,
  message_range jsonb not null
);

evidence (
  id uuid primary key,
  conversation_id uuid not null,
  message_id uuid not null,
  quote text not null,
  text_span jsonb null,
  evidence_type text not null,
  confidence text not null
);

structures (
  id uuid primary key,
  conversation_id uuid not null,
  overview jsonb not null,
  topic_map jsonb not null,
  thought_flow jsonb not null,
  board jsonb not null,
  entity_graph jsonb not null,
  created_at timestamptz not null
);

exports (
  id uuid primary key,
  conversation_id uuid not null,
  export_type text not null,
  content text not null,
  created_at timestamptz not null
);
```

### 17.3 Raw HTML 저장 정책

v0.1에서는 기본적으로 raw HTML을 저장하지 않는 것을 추천한다.

```text
기본:
- raw HTML 미저장
- canonical conversation 저장
- 구조화 결과 저장

옵션:
- 디버깅 모드에서만 raw HTML 임시 저장
- 일정 시간 후 자동 삭제
```

---

## 18. API 명세

### 18.1 분석 생성

```http
POST /api/analyses
Content-Type: application/json
```

Request:

```json
{
  "shareUrl": "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67",
  "options": {
    "storeOriginalConversation": true,
    "storeRawHtml": false,
    "language": "ko"
  }
}
```

Response:

```json
{
  "analysisId": "ana_123",
  "status": "queued"
}
```

### 18.2 분석 상태 조회

```http
GET /api/analyses/{analysisId}
```

Response:

```json
{
  "analysisId": "ana_123",
  "status": "processing",
  "stage": "context_extraction",
  "progress": 62,
  "warnings": []
}
```

Status enum:

```text
queued
fetching
importing
normalizing
segmenting
extracting_context
building_structures
completed
failed
```

### 18.3 결과 조회

```http
GET /api/analyses/{analysisId}/result
```

Response:

```json
{
  "conversation": {
    "title": "JARVIS 기술 논의",
    "stats": {
      "totalMessages": 24,
      "userMessages": 12,
      "assistantMessages": 12
    }
  },
  "overview": {},
  "topicMap": {},
  "thoughtFlow": [],
  "board": {},
  "entityGraph": {},
  "evidence": []
}
```

### 18.4 원문 메시지 조회

```http
GET /api/analyses/{analysisId}/messages
```

Response:

```json
{
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "jarvis를 만들 때..."
    }
  ]
}
```

### 18.5 Export

```http
POST /api/analyses/{analysisId}/exports
```

Request:

```json
{
  "type": "markdown"
}
```

Response:

```json
{
  "exportId": "exp_123",
  "type": "markdown",
  "content": "# JARVIS 기술 논의\n..."
}
```

---

## 19. Frontend 화면 명세

### 19.1 URL 입력 화면

구성:

```text
- ChatGPT 공유 링크 입력창
- 예시 URL
- 민감정보 주의 안내
- “분석 시작” 버튼
```

안내 문구:

```text
공유 링크에 포함된 대화 내용을 분석합니다.
민감한 개인정보, 비밀번호, API 키, 고객정보가 포함된 대화는 입력하지 마세요.
```

### 19.2 분석 진행 화면

```text
1. 링크 확인 중
2. 대화 데이터 가져오는 중
3. 메시지 구조 복원 중
4. 맥락 추출 중
5. 구조화 화면 생성 중
```

### 19.3 결과 화면

상단 탭:

```text
Overview | Topic Map | Thought Flow | Board | Entity Graph | Export
```

우측 패널:

```text
선택 항목 상세
원문 근거
관련 메시지
관련 노드
```

---

## 20. LLM 사용 지점 vs 자체 기술 지점

### 20.1 LLM API 사용

| 영역 | LLM 사용 여부 | 설명 |
|---|---:|---|
| Segment title 생성 | 사용 | 구간 제목 생성 |
| Segment summary 생성 | 사용 | 구간 요약 |
| Topic 추출 | 사용 | 의미 기반 주제 추출 |
| Decision 추출 | 사용 | 결정사항 후보 추출 |
| Pending Issue 추출 | 사용 | 미결정 항목 추출 |
| Action Item 추출 | 사용 | 실행 항목 후보 추출 |
| Entity 추출 | 사용 | 개념/기능/제품/기술 추출 |
| Relation 추출 | 사용 | 관계 후보 추출 |
| Overview 생성 | 사용 | 전체 요약 |
| Export 문서 생성 | 일부 사용 | 템플릿 + LLM 정리 |

### 20.2 자체 기술로 구현

| 영역 | 자체 구현 필요도 | 설명 |
|---|---:|---|
| Share URL validation | 높음 | 입력 보안 |
| HTML fetch | 높음 | 안정적 가져오기 |
| stream payload extraction | 매우 높음 | 핵심 adapter |
| escaped JSON decode | 매우 높음 | 핵심 adapter |
| reference dereference | 매우 높음 | 핵심 adapter |
| linear_conversation restore | 매우 높음 | 핵심 adapter |
| canonical format 변환 | 매우 높음 | 모든 입력 표준화 |
| evidence anchor 생성 | 매우 높음 | 신뢰성 핵심 |
| schema validation | 매우 높음 | LLM 출력 검증 |
| decision 정책 | 매우 높음 | 제품 품질 |
| entity canonicalization | 높음 | graph 품질 |
| graph validation | 높음 | relation 품질 |
| export template | 높음 | 결과물 품질 |
| error handling | 매우 높음 | 서비스 안정성 |

정리하면:

> **LLM은 의미 후보를 뽑는 데 쓰고, 제품의 기술 자산은 ChatGPT Share Adapter, Canonical Conversation Format, Evidence Anchor, Context Validator, Entity Graph Normalizer에 쌓아야 한다.**

---

## 21. 에러 처리 명세

### 21.1 주요 에러 코드

```ts
type AnalysisErrorCode =
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

### 21.2 사용자 메시지 예시

```text
PAYLOAD_NOT_FOUND:
ChatGPT 공유 페이지의 내부 데이터 구조를 찾지 못했습니다.
공유 링크 구조가 변경되었을 수 있습니다.

LINEAR_CONVERSATION_NOT_FOUND:
대화 메시지 배열을 복원하지 못했습니다.
현재 링크가 일부 응답만 포함하거나 지원되지 않는 형식일 수 있습니다.

WORKSPACE_RESTRICTED_LINK:
이 링크는 특정 워크스페이스 내부에서만 접근 가능한 공유 링크일 수 있습니다.
v0.1에서는 공개적으로 접근 가능한 ChatGPT 공유 링크만 지원합니다.
```

---

## 22. 개인정보 / 보안 명세

### 22.1 기본 원칙

```text
1. 사용자의 ChatGPT 로그인 정보는 절대 받지 않는다.
2. 쿠키를 수집하지 않는다.
3. 공유 링크 HTML만 가져온다.
4. raw HTML은 기본 저장하지 않는다.
5. 사용자가 원문 저장 여부를 선택할 수 있게 한다.
6. 삭제 요청 시 conversation, messages, structures, exports를 모두 삭제한다.
```

### 22.2 저장 모드

```text
Mode A: Full Save
- canonical conversation 저장
- 구조화 결과 저장
- export 저장

Mode B: Structure Only
- 원문 메시지 저장하지 않음
- evidence quote 최소 저장
- 구조화 결과만 저장

Mode C: No Save / Session Only
- 분석 세션 동안만 보관
- 브라우저 종료 또는 일정 시간 후 삭제
```

---

## 23. 품질 평가 명세

### 23.1 Import 품질

```text
1. 메시지 수가 실제 화면과 일치하는가
2. user / assistant role이 정확한가
3. 메시지 순서가 정확한가
4. 첫 user 메시지가 누락되지 않았는가
5. 마지막 assistant 메시지가 누락되지 않았는가
6. markdown / code block이 보존되는가
```

### 23.2 Context 품질

```text
1. 핵심 주제가 누락되지 않았는가
2. 결정사항과 제안이 구분되는가
3. 보류사항이 정확히 추출되는가
4. 액션 아이템이 실행 가능하게 정리되는가
5. 모든 핵심 항목에 evidence가 있는가
```

### 23.3 Graph 품질

```text
1. 중복 entity가 적은가
2. relation type이 일관적인가
3. 근거 없는 edge가 없는가
4. graph가 너무 복잡하지 않은가
5. Topic Map과 Entity Graph가 서로 모순되지 않는가
```

---

## 24. 테스트 케이스

### 24.1 Adapter 테스트

```text
1. 일반 ChatGPT 공유 링크
2. 긴 대화 공유 링크
3. 한국어 대화
4. 영어 대화
5. 코드블록 포함 대화
6. 표 포함 대화
7. 리스트가 많은 대화
8. 일부 assistant 응답만 공유된 링크
9. 삭제된 공유 링크
10. Business workspace 제한 링크
11. 이미지/파일 포함 대화
12. payload 구조가 일부 바뀐 HTML fixture
```

### 24.2 Regression Fixture

초기에는 실제 공유 링크 HTML을 20~50개 정도 fixture로 저장해 parser regression test를 만든다.

단, 개인정보가 포함되지 않은 테스트 대화만 사용한다.

```text
fixtures/
  chatgpt-share/
    simple-ko.html
    simple-en.html
    long-product-planning.html
    code-heavy.html
    table-heavy.html
    partial-response-share.html
```

### 24.3 Gold Dataset

Context extraction 품질을 보려면 사람이 만든 정답 데이터가 필요하다.

```text
gold/
  conversation_001.expected.topics.json
  conversation_001.expected.decisions.json
  conversation_001.expected.graph.json
```

이 Gold Dataset은 장기적으로 JARVIS의 핵심 자산이 된다.

---

## 25. 배포 / 운영 명세

### 25.1 Job Queue

분석은 비동기 job으로 처리한다.

```text
POST /analyses
→ job queued
→ worker가 import / LLM / structure 처리
→ frontend는 polling 또는 websocket으로 상태 확인
```

### 25.2 Worker 분리

```text
import-worker
- URL fetch
- payload extraction
- conversation restore

context-worker
- segmentation
- LLM extraction
- validation

structure-worker
- Topic Map
- Thought Flow
- Board
- Graph
- Export
```

초기에는 하나의 worker로 시작해도 되지만, 논리적으로는 분리한다.

### 25.3 Rate Limit

```text
1 user:
- 시간당 분석 10개
- 하루 분석 50개

1 URL:
- 10분 내 중복 분석 방지
```

### 25.4 Cache

같은 공유 링크를 다시 분석할 수 있으므로 다음을 캐시한다.

```text
- fetched HTML hash
- canonical conversation hash
- structure result hash
```

단, 공유 링크는 업데이트될 수 있으므로 URL만으로 영구 캐시하면 안 되고, HTML content hash를 기준으로 캐시해야 한다.

---

## 26. v0.1 구현 우선순위

### P0

```text
1. Share URL validation
2. HTML fetch
3. enqueue payload extraction
4. JSON string decode
5. reference dereference
6. linear_conversation restore
7. CanonicalConversation 변환
8. message list UI
9. segment 생성
10. LLM structured extraction
11. Overview
12. Topic Map
13. Decision / Pending / Action Board
14. Source Evidence
15. Markdown Export
```

### P1

```text
1. Thought Flow
2. Entity Graph
3. JSON Export
4. parser regression fixtures
5. raw HTML debug mode
6. structure-only 저장 모드
```

### P2

```text
1. Graph visualization 고도화
2. 여러 대화 프로젝트화
3. Chrome Extension
4. PDF Adapter
5. Notion Export
```

---

## 27. 최종 기술 판단

v0.1에서 가장 중요한 기술 자산은 PDF 파서가 아니다.

이제 핵심 기술 자산은 다음이다.

```text
1. ChatGPT Share Adapter
   공유 링크 HTML에서 대화 구조를 안정적으로 복원하는 기술

2. Canonical Conversation Format
   어떤 입력이든 동일한 대화 구조로 바꾸는 표준 포맷

3. Evidence Anchor
   모든 구조화 결과를 원문 메시지와 연결하는 기술

4. Context Extraction Schema
   LLM이 주제 / 결정 / 보류 / 액션 / 개념 / 관계를 일관되게 뽑도록 하는 스키마

5. Context Validator
   LLM 출력의 hallucination, 중복, 근거 부족을 걸러내는 검증기

6. Entity Graph Normalizer
   entity alias를 병합하고 relation type을 제한해 깨끗한 graph를 만드는 기술
```

최종 구조는 다음으로 확정한다.

```text
ChatGPT Share Link
→ ChatGPTShareAdapter
→ CanonicalConversation
→ Segmenter
→ LLM Context Extractor
→ Context Validator
→ Structure Builder
→ Entity Graph Normalizer
→ UI / Export
```

한 문장으로 정리하면:

> **v0.1은 “PDF 문서 분석기”가 아니라, ChatGPT 공유 링크에서 대화 원본 구조를 복원하고 이를 JARVIS의 맥락 데이터로 변환하는 Conversation Structuring Engine이다.**

---

## 28. 향후 확장

### v0.2

```text
1. 결과 편집 기능
2. Thought Flow 고도화
3. Entity Graph UI 고도화
4. PDF Export
5. Notion Export
6. Paste / Markdown 입력 지원
```

### v0.3

```text
1. 여러 대화 프로젝트화
2. 여러 대화의 Topic / Decision / Entity 병합
3. Chrome Extension 기반 현재 대화 추출
4. 사용자별 프로젝트 맥락 저장
```

### v0.4

```text
1. PDF Adapter 추가
2. Claude / Gemini 공유 링크 또는 export 지원
3. 일반 문서 / 회의록 입력 지원
4. JARVIS Memory Engine과 연동
```

---

## 29. 참고 링크

- OpenAI Help — ChatGPT Shared Links FAQ
- OpenAI Help — Delete or invalidate a shared link
- OpenAI Help — Update a shared link
- OpenAI Platform Docs — Structured Outputs

