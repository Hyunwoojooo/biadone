# Blabase current architecture

기준일: 2026-08-14. `[fact]`는 소스·import·테스트에서 직접 확인한 사실, `[inference]`는 그 사실에서 도출했지만 런타임 전체 조합을 관찰하지 않은 해석이다. README보다 코드와 테스트를 우선했다.

## Repository and runtime boundaries

`apps/blabase`는 하나의 npm workspace가 아니라 두 개의 독립 npm 프로젝트를 함께 담는다.

- main conversation application: `src/app`, `src/components`, `src/core`, `tests`, `tools`
- work-intelligence application: `suggestion/app`, `suggestion/src`, `suggestion/tests`, `suggestion/tools`, `suggestion/desktop/macos`
- main에서 suggestion을 import하지 않는다. suggestion의 legacy restore 경로만 main `src/core`를 네 번 import한다.
- 두 Next.js 앱 사이에 공용 database나 queue는 없다. main은 process memory와 browser storage, suggestion은 주로 `.local/` JSON을 사용한다.

## Implemented components

| 구성 요소 | 역할 | 상태 | 소스 근거 | 입력 | 출력 | 상위 호출자 | 하위 의존성 | 데이터 저장 | 신뢰도 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| Main Web UI | 공유 URL 입력, extraction monitor, Atlas, Golden quality 화면 | implemented | `src/app/page.tsx`; `src/components/UrlInputForm.tsx#handleSubmit`; `src/components/extraction-monitor/ExtractionMonitor.tsx` | 사용자 URL, API payload | 화면·다운로드·navigation cache | browser user | main API routes | module memory, `sessionStorage`; Atlas last ID만 `localStorage` | high | [fact] 서버 review mutation API는 없다. |
| Analysis API | 수집→정규화→rule→optional LLM shadow→evidence→memory 저장을 동기 조정 | implemented | `src/app/api/analyses/route.ts#POST` | `{ shareUrl }` JSON | monitor payload와 analysis ID | `UrlInputForm` | share adapter, extractors, verifier, store | process/isolate memory | high | [fact] queue/background job 없음. |
| Share URL adapter | URL 검증, direct/sidecar fetch, React Flight decode, conversation 복원 | implemented | `src/core/adapters/chatgpt-share/index.ts#importChatGPTShareUrl` | ChatGPT share URL, optional injected `fetchHtml` | canonical conversation + diagnostics | Analysis API, suggestion legacy restore, tests | URL validator, fetch, Flight parser/dereference, normalizer | 없음 | high | [fact] 테스트는 privacy-safe fixture fetch를 주입한다. |
| ChatGPT fetcher sidecar | 선택적 bearer 인증을 가진 서버측 fetch proxy | implemented | `tools/chatgpt-fetcher/server.mjs` | URL, configured bearer token | fetched HTML | Share URL adapter when `CHATGPT_SHARE_FETCHER_URL` set | ChatGPT share endpoint | 없음 | high | [fact] 별도 Node process. |
| Conversation normalizer | message를 turn/block으로 만들고 clean/context/internal을 분류 | implemented | `src/core/adapters/chatgpt-share/normalizeConversation.ts#normalizeConversation` | restored messages | `CanonicalConversation` | Share URL adapter | conversation types/helpers | 없음 | high | [fact] LLM에는 clean conversation 중심으로 전달한다. |
| Rule extractor | deterministic semantic structure 생성 | implemented | `src/core/extractors/mockStructureExtractor.ts#extractMockStructure`; `ruleSemanticAdapter.ts` | canonical conversation | rule semantic items | Analysis API | local rules/types | 없음 | high | [fact] 이름은 Mock이지만 live POST 경로에서 사용한다. |
| LLM shadow pipeline | segment별 provider 호출과 결과 집계 | implemented | `src/core/extractors/runShadowExtraction.ts#runShadowExtraction`; `llmShadowExtractor.ts#extractLlmShadow`; `providers/*` | clean turns, provider env config | shadow semantic items·errors·usage | Analysis API | OpenAI/Gemini/Qwen adapters | 없음 | high | [fact] env/key가 없으면 비활성; 실패해도 rule 결과는 유지된다. |
| Evidence verifier | LLM item evidence를 verified/review/rejected로 분류 | implemented | `src/core/validation/evidenceVerifier.ts#verifyLlmEvidence` | LLM semantic items, conversation | verification decisions | shadow orchestration | canonical message lookup | analysis result에 포함 | high | [fact] rule item 검증기가 아니다. |
| Analysis store | completed analysis 조회용 process-local repository | implemented | `src/core/storage/analysisStore.ts#MemoryAnalysisStore` | completed result/messages | ID별 조회 | POST와 result/messages/audit routes | `globalThis` Map | process/isolate lifetime | high | [fact] TTL, durable ownership, per-user authorization이 없다. |
| Export / Golden Sheet | GPT audit Markdown과 explicit Google Sheet sync | implemented / external | `src/core/export/gptAuditExport.ts`; `src/core/golden-sheet/googleSheetsClient.ts#syncAnalysisToGoldenSheet`; 관련 API routes | stored analysis | Markdown 또는 Google API write | monitor UI | Google auth/API | external Sheet | high | [fact] 원문·evidence를 포함할 수 있어 sensitive. |
| Semantic Core v1 schema | 7-type semantic draft schema와 validator | implemented but not live-wired | `src/core/types/semanticCoreV1.ts`; `src/core/types/semantic.ts`; `tests/unit/semanticCoreV1.test.ts` | candidate draft | validated draft | tests | Zod | 없음 | high | [fact] production route import는 확인되지 않았다. |
| Suggestion Work Cockpit | Active Attention, Current Focus, Work Board, source health UI | implemented | `suggestion/app/page.tsx`; `suggestion/app/WorkCockpit.tsx` | local API responses·user actions | bounded public UI | browser user | suggestion API clients | browser state only | high | [fact] 별도 Next app. |
| Suggestion local API boundary | attention, sync, connectors, context, continuation, board/evidence endpoints | implemented | `suggestion/app/api/**/route.ts`; `suggestion/middleware.ts` | loopback/browser requests | JSON projections/actions | Work Cockpit, launcher agent | suggestion engines/stores/connectors | `.local/` through repositories | high | [fact] middleware에 Basic Auth와 development localhost gate가 있다. |
| Source sync coordinator | bounded source collection, in-flight dedup, backoff, snapshot persistence | implemented | `suggestion/src/sync/coordinator.ts#SourceSyncCoordinator`; `sync/runtime.ts#syncRuntimeSources` | configured source adapters | snapshots/status | sync routes and attention pipeline | connectors, repository | `.local/` JSON | high | [fact] scheduling은 process-local timer이며 durable lease가 아니다. |
| Source connectors | GitHub, local Codex, Google Calendar, Notion read adapters | implemented / external | `suggestion/src/connectors/{github,codex,googleCalendar,notion}/**` | OAuth/local connection config | bounded source snapshots | SourceSyncCoordinator | external APIs / loopback WS | connector state under `.local/` | high | [fact] hosted runtime에서 local source 접근은 환경 제약을 받는다. |
| Active Attention pipeline | capture, routing, eligibility, evidence graph, lane ranking | implemented | `suggestion/src/attention/liveAttention.ts`; `attentionDecision/resolveActiveAttention.ts`; `eligibility/resolveAttentionEligibility.ts` | source snapshots/context | sealed attention projection | attention routes | claims/evidence/eligibility/current-work modules | replay/monitor files under `.local/` | high | [fact] Current Focus shadow는 현재 `attentionSelectionEffect: "none"`. |
| Continuation / Work Board | sealed Active를 보존하는 display-only continuation과 setup offer | implemented, gated | `suggestion/src/suggestionBoard/liveShadow.ts`; `suggestion/src/suggestionBoard/composeBoard.ts#composeWorkSuggestionBoard`; `suggestion/src/semanticContinuation/**` | evaluated attention, context | bounded board/intent projection | work-board and continuation routes | attention/evidence/local stores | `.local/` JSON | high | [fact] feature flags 기본값이 off인 경로가 있다. |
| macOS launcher | AppKit menu bar + bundled Node agent JSONL bridge | implemented development beta | `suggestion/desktop/macos/Sources/BlabaseLauncher/**`; `suggestion/src/launcher/service.ts` | local settings, JSONL messages | attention/board UI와 승인된 resume action | local user | bundled Node + loopback APIs | user-local settings/files | high | [fact] signed/notarized distribution은 미완료. |

## Routes and entry points

Main pages are `/`, `/analyses/[analysisId]`, `/atlas`, and `/golden/quality`. Main Node API routes are `POST /api/analyses`, analysis `messages/result/gpt-audit/golden-sheet`, debug share fetch/payloads, and Golden quality.

Suggestion pages are `/`, `/projects`, `/sources`, `/settings`, `/attention-lab`, and `/legacy`. Its API surface is grouped under `attention`, `sync`, `connectors`, `context`, `continuation`, `work-board`, `work-artifacts`, `work-relations`, `work-resumption`, and `managed-codex-runs`. Exact route files are discoverable with:

```bash
rg --files src/app suggestion/app | rg 'page\.tsx$|route\.ts$|layout\.tsx$'
```

## Actual flows

### ChatGPT share URL

`UrlInputForm.handleSubmit` → `POST /api/analyses` → `importChatGPTShareUrl` → direct fetch or optional fetcher sidecar → Flight parsing/dereference → `normalizeConversation` → `extractMockStructure` → optional `runShadowExtraction` → `verifyLlmEvidence` → `MemoryAnalysisStore.createCompleted` → monitor payload → browser session handoff.

### Pasted conversation

현재 main UI/API에서 독립적인 paste ingestion route는 확인되지 않았다. `[uncertain]` 일부 normalization 함수는 이미 복원된 message 입력을 받을 수 있지만, 그것을 사용자 paste 기능으로 표현하지 않는다.

### Review, edit, accept, reject

UI는 computed comparison/evidence 상태를 표시한다. 사용자 결정을 서버에 영속화하는 accept/reject/edit mutation은 현재 코드에서 확인되지 않았다. 따라서 공식 모델에는 “review UI”만 구현으로 두고 conflict resolution·durable decision은 planned로 분리한다.

### Export

Analysis ID로 GPT audit Markdown을 생성할 수 있고, 명시적 POST로 Google Sheet에 동기화한다. 전체 canonical MD/JSON export는 현재 확인되지 않았다.

### Fixture mode

live fixture switch는 없다. AppMap smoke는 `tests/integration/chatgptShareAdapter.test.ts`가 `tests/fixtures/chatgpt-share/simple-ko.html`을 injected `fetchHtml`로 사용하는 deterministic test 경로를 기록한다. Atlas demo data는 visualization fixture이지 ingestion mode가 아니다.

### Suggestion Active Attention

Work Cockpit/local API → `syncRuntimeSources` → bounded connectors → coordinator가 private snapshot commit → `liveAttention` capture/evaluate → claims/evidence/eligibility → `resolveActiveAttention` → optional display-only Work Board/Continuation → public bounded response.

## Boundaries and impact

- main `src/components`와 suggestion의 비-API `app` 모듈이 server storage/provider integration을 직접 import하는 경로는 dependency-cruiser가 보수적인 **warning**으로 표시한다. 이 규칙은 경로 기반 review signal이며, `"use client"` directive를 의미적으로 증명하는 보안 경계는 아니다.
- production code must not import tests, fixtures, or mocks. 현재 위반은 없다.
- suggestion → main source imports 네 건은 legacy coupling으로 warning이다. 변경 영향은 share adapter와 conversation types에서 suggestion restore/prompt/types/verification까지 이어진다.
- suggestion 내부 cycle 8건은 기존 구조이므로 warning이다. `attention → eligibility → attentionDecision → artifacts/claims/workEvidence` 주변 수정은 넓게 영향 검토한다.
- dynamic/configured provider 호출은 정적 graph에 나타나지 않을 수 있으므로 provider/env 변경은 AppMap 또는 targeted test로 보완한다.

## Planned, uncertain, and external

| 요소 | 상태 | 근거와 구분 |
|---|---|---|
| rule·LLM conflict resolver와 durable review decision | planned | `docs/CODEX_IMPLEMENTATION_PLAN.md`; live mutation 없음 |
| durable main analysis store + ownership/TTL/deletion | planned | current store가 `globalThis` Map |
| Semantic Core/cross-source용 human-reviewed Golden + locked holdout | planned | Gold Core v0.1 자체는 존재하지만 새 release gate는 아직 없음 |
| durable scheduler + exclusive lease | planned | suggestion coordinator가 process-local timer |
| Developer ID/hardened runtime/notarization | planned | launcher release docs의 gate |
| main API authorization/analysis ownership | uncertain / absent in inspected routes | no auth check observed; deployment edge policy가 별도로 있을 가능성은 코드만으로 확정 못함 |
| ChatGPT, LLM providers, Google Sheets, GitHub, Codex App Server, Calendar, Notion | external | adapter와 route의 실제 imports/HTTP calls 근거 |

## Code/document differences

- `extractMockStructure`라는 이름과 달리 main live analysis path의 rule engine이다.
- “review”는 현재 표시·비교이며 persisted adjudication으로 해석하면 안 된다.
- “fixture mode”는 production toggle이 아니라 test dependency injection이다.
- 기존 Gold Core v0.1과 향후 Semantic Core/cross-source human Golden gate는 서로 다른 상태다.
- suggestion Current Focus는 현재 Active selection을 바꾸지 않는 shadow/display-only 단계다.

## Risk register

1. Main analysis ID endpoints에 code-level user ownership/auth가 보이지 않고 store도 TTL이 없는 process memory다.
2. audit·Golden Sheet·AppMap은 conversation content를 담을 수 있어 운영 데이터를 recording에 쓰면 안 된다.
3. provider 호출은 conversation content를 외부로 보낼 수 있고 설정·키가 있어야만 활성화된다.
4. suggestion scheduler는 multi-process ownership/lease가 없고 local sources는 hosted environment에서 접근 불가능할 수 있다.
5. existing suggestion cycles와 main coupling은 변경 영향 범위를 넓힌다. 지금은 관찰 인프라에서 리팩터링하지 않는다.
