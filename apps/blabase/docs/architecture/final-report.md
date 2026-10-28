# Architecture visibility final report

## 1. 최종 상태

**PARTIAL**

dependency-cruiser, LikeC4, deterministic AppMap, codebase-memory 설치·full index·graph 교차검증, 문서와 CI는 완료했다. 단, 실제 대화를 기록할 위험이 있는 interactive `arch:trace:dev`는 synthetic-only server가 없는 현재 privacy guard로 의도적으로 차단했으므로 전체 상태를 PARTIAL로 판정한다. codebase-memory native MCP tool은 Codex 재시작 뒤 hot-load되지만, 설치된 동일 binary의 공식 CLI로 인덱싱과 LikeC4 비교는 완료했다.

## 2. 저장소에서 확인한 실제 구조

- main conversation app: Next.js UI/route가 ChatGPT share adapter, normalization, deterministic rule extraction, optional LLM shadow, LLM evidence verification, process-memory analysis store를 동기 조정한다.
- browser handoff: module memory와 `sessionStorage`; Atlas last analysis ID만 `localStorage`다.
- export: stored analysis의 GPT audit Markdown과 명시적 Google Sheets sync가 있다.
- suggestion app: 독립 Next.js app이며 source connectors, process-local sync coordinator, Active Attention, Current Focus shadow, Work Board/Continuation, private `.local` stores, macOS launcher를 포함한다.
- external systems: ChatGPT Share, configured LLM provider, Google Sheets, GitHub, local Codex App Server, Google Calendar, Notion.
- 현재 없는 것으로 확인한 것: 독립 paste ingestion UI/API, durable main analysis database, queue, persisted review edit/accept/reject, production fixture switch, durable scheduler lease, signed/notarized launcher distribution.
- 계획 구조는 current model과 섞지 않고 `architecture/planned.c4`로 분리했다.

상세 evidence table과 flow는 [current-state.md](current-state.md)에 있다.

## 3. 변경한 파일

| 파일/그룹 | 목적 |
|---|---|
| `package.json`, `package-lock.json` | exact architecture devDependencies와 `arch:*` scripts |
| `dependency-cruiser.config.mjs`, `dependency-cruiser.suggestion.config.mjs`, `dependency-cruiser.scripts.config.mjs` | repository/cross-boundary, suggestion-native, JS/MJS static rules |
| `tools/architecture/dependency-artifacts.mjs` | script entry 자동 발견, Mermaid와 세 분석 범위의 HTML/JSON artifact 생성 |
| `tools/architecture/check-appmap-config.mjs`, `appmap-dev-guard.mjs` | AppMap literal exclude 검증과 interactive trace privacy gate |
| `tools/architecture/check-model-links.mjs` | LikeC4 source link 49개 존재 검증 |
| `architecture/*.c4`, `architecture/likec4.config.json`, `architecture/README.md` | current/planned official model, static/dynamic views, operation convention |
| `appmap.yml` | privacy-bounded main/suggestion instrumentation roots |
| `.cbmignore`, `.gitignore` | CBM/AppMap/generated/private output과 SwiftPM build cache 제외 |
| `AGENTS.md` | 지속 architecture workflow |
| `eslint.config.mjs` | nested generated Next output lint 제외 |
| `docs/architecture/**` | current state, drift, four runbooks, log, report |
| `docs/architecture-current.archify.json`, `docs/architecture-current.html` | 검증된 main current-flow standalone visual |
| repository root `.github/workflows/architecture-check.yml` | reproducible CI check/build와 artifact upload |

기존 suggestion product/Swift/dashboard 변경은 보존했고 이 작업에서 수정·초기화하지 않았다.

## 4. 추가한 명령

| 명령 | 역할 |
|---|---|
| `npm run arch:deps:check` | root/suggestion tsconfig와 별도 JS/MJS pass를 사용한 import/rule 검사 |
| `npm run arch:deps:graph` | bounded/main/suggestion/JS-MJS scripts Mermaid 4종 생성 |
| `npm run arch:deps:report` | standalone HTML + machine JSON report 생성 |
| `npm run arch:sources:check` | LikeC4 local evidence link 존재 검사 |
| `npm run arch:trace:config:check` | AppMap matcher·민감 경계·privacy gate 검사 |
| `npm run arch:model:dev` | `127.0.0.1` LikeC4 interactive preview |
| `npm run arch:model:check` | LikeC4 syntax/reference/layout validation |
| `npm run arch:model:format` | C4 format |
| `npm run arch:model:build` | LikeC4 static site build |
| `npm run arch:trace:dev` | synthetic-only server가 생길 때까지 설명과 exit 2를 반환하는 privacy guard |
| `npm run arch:trace:test` | deterministic fixture AppMap recording |
| `npm run arch:check` | 세 dependency pass + source links + AppMap safety + model validation |
| `npm run arch:build` | dependency artifacts + LikeC4 site |

모든 명령은 `/Users/joo/BiaDone/apps/blabase`에서 실행한다.

## 5. 생성된 아키텍처 뷰

- System Context: 사용자, Blabase, 실제 external integrations.
- Containers: main conversation app, suggestion app, macOS launcher, optional ChatGPT fetcher sidecar.
- Main Components: UI, analysis API, share adapter, normalizer, rule/LLM extraction, evidence verifier, memory/browser stores.
- Suggestion Components: Work Cockpit, local API, connectors, sync coordinator, attention engine, continuation/board, private stores.
- Planned: conflict resolver, durable analysis store, 새 Semantic/cross-source human Golden+holdout, durable scheduler/lease, signed distribution.
- Dynamic: ChatGPT share analysis, Active Attention evaluation, deterministic fixture analysis.
- Standalone current-flow HTML: [architecture-current.html](../architecture-current.html), light/dark 및 guided focus view 포함.

## 6. dependency-cruiser 결과

- repository/cross-boundary pass: **592 modules**, **2,026 dependencies**, **0 errors**, **12 warnings**
- suggestion-native pass: **480 modules**, **1,803 dependencies**, **0 errors**, **8 warnings**
- JS/MJS scripts pass: **30 modules**, **30 dependencies**, **0 errors**, **2 warnings**
- unique baseline warning categories: cycle **8**, suggestion → main legacy coupling **4**, ESLint config transitive-package use **2**. suggestion-native cycle 8건은 repository 8건과 같은 기존 cycle을 앱 자체 경로로 재검사한 결과다.

중요 경로는 `attention/liveAttention`, `attentionDecision`, `eligibility`, `claims`, `artifacts`, `workEvidence` cycle cluster와 `suggestion/src/{prompt,restoreConversations,types,verifyCandidates}.ts`의 main dependency다. 기존 위반은 숨기지 않고 warning으로 유지하고, 현재 깨끗한 production→test/fixture, unresolvable, undeclared, production→devDependency, core→UI, main→suggestion 경계는 error로 차단한다.

## 7. AppMap 결과

- compatibility: `appmap-node 2.26.1`의 declared Node `>=18`; 실제 Node `22.23.2`, Vitest `3.2.6` test recording은 성공했다. 초기 Next `15.5.20` loopback smoke도 Ready까지 갔지만 HTTP/body/argument 기록 위험과 Turbopack partial-coverage 경고 때문에 최종 dev command는 활성화하지 않았다.
- recording: **성공**, 3 tests → 3 `.appmap.json`.
- 시나리오: canonical fixture HTML, embedded Flight row strings, flat Flight table restoration.
- 위치: `tmp/appmap/vitest/` (Git ignored, tracked 0).
- blocked/manual scenarios: invalid URL/upstream error, synthetic extraction+evidence, synthetic UI/export, suggestion in-memory attention trace. 전용 synthetic harness와 privacy review가 먼저 필요하다.

운영 데이터와 실제 대화는 사용하지 않았다.

## 8. 테스트 결과

| 검사 | 결과 |
|---|---:|
| main lint / typecheck / 159 tests / build | PASS |
| suggestion lint / typecheck / 1,327 tests / build | PASS |
| `arch:deps:check`, graph, report | PASS |
| JS/MJS entry coverage 17개 + sentinel edge 4개 | PASS |
| `arch:model:check`, static build | PASS |
| `arch:check`, `arch:build` | PASS |
| AppMap fixture smoke | PASS |
| AppMap matcher/privacy config safety | PASS |
| Interactive AppMap dev trace | SAFE BLOCK (exit 2) |
| LikeC4 source links 49 | PASS |
| codebase-memory full index / evidence coverage / 3 core traces | PASS |
| Archify showcase validation 9/9 | PASS |
| Archify 4-viewport containment + light/dark visual review | PASS |
| whitespace, targeted formatting, ignore, credential-shape scan | PASS |

codebase-memory final generation은 full/complete이며 14,659 nodes, 64,543 edges다. 사용한 production evidence 8개는 모두 metadata match이고 recorded issue가 없다. `POST /api/analyses` 126 outbound, `SourceSyncCoordinator.sync` 31 outbound, legacy `restoreConversations` 28 outbound를 source와 함께 대조했다. suggestion test 22개는 부분 파싱 상태라 해당 line의 graph-only claim은 피한다.

제품 engine behavior는 바꾸지 않아 Golden baseline과 Engine Change Record를 재실행하지 않았다.

## 9. 기존 문제와 새로 발생한 문제

### 기존 또는 제품 측 문제

- suggestion cycle 8건과 main legacy source coupling 4건.
- main analysis store의 TTL/durability/ownership 부재와 route-level authorization 불확실성.
- suggestion process-local scheduler와 hosted/local source 경계.
- `npm audit`의 7 high production-filtered report 및 전체 8 high summary. installed Next `15.5.20` advisory가 포함되지만 자동 upgrade는 제품 회귀 검증이 필요한 별도 작업이다.
- 작업 전 suggestion tests 2건은 기존 dirty snapshot에서 실패했으나, 작업 중 별도로 갱신된 final dirty snapshot에서는 1,327 tests 모두 통과했다. architecture 도입이 제품 실패를 수정했다고 주장하지 않는다.

### 이번 작업에서 새로 발생한 문제

- 제품 behavior 회귀는 확인되지 않았다.
- architecture dev tool 추가로 root install graph의 기존 transitive `acorn`이 `8.17.0→8.18.0`, `nanoid`가 `3.3.15→3.3.18`로 patch bump됐다. lock 일관성상 이전 값 강제 시 `npm ci`가 실패해 유지했으며, final clean install·lint·typecheck·159 tests·build는 통과했다.
- 첫 codebase-memory index가 SwiftPM `.build` 생성물을 포함하는 ignore drift가 있었지만 `.cbmignore` 수정과 재색인으로 해소했다. 검토한 main analysis, source sync, legacy restore 핵심 edge 범위에서는 implemented LikeC4와 source 사이의 구조 drift를 발견하지 않았다.
- interactive AppMap dev trace는 실사용 입력을 기록할 수 있어 활성화하지 않았다. 이 안전 차단이 최종 상태를 PARTIAL로 만든 유일한 구현 차단 항목이다.

## 10. 사용자가 직접 해야 하는 작업

1. Codex를 재시작해 이번 process에 없던 native codebase-memory MCP tool을 hot-load하고 `codex mcp list`, `/mcp`, `/hooks`에서 등록과 hook trust를 확인한다. CLI 기반 index/coverage/LikeC4 교차검증은 이미 완료됐다.
2. LikeC4 current/planned 의미를 architecture owner가 승인한다.
3. repository warning 12건과 ESLint config transitive warning 2건 중 어떤 boundary를 언제 error로 승격할지 결정한다. suggestion-native cycle 8건은 repository cycle의 중복 재검사다.
4. Next/Wrangler/transitive dependency advisory upgrade를 별도 PR에서 검토한다.
5. interactive AppMap이 필요하면 먼저 실제 route와 분리된 synthetic-only server/harness를 구현·privacy review한다. guard를 단순 해제해 실제 공유 URL을 기록하면 안 된다.
6. 필요할 때 AppMap IDE extension을 설치해 이미 생성된 fixture recordings를 연다.

commit, push, deployment는 수행하지 않았다. merge 전 변경 파일 선택과 architecture semantic approval에는 human review가 필요하다.

## 11. 남은 위험과 권장 후속 작업

1. **P0 security maintenance**: Next `15.5.21+`와 관련 transitive update를 별도 branch에서 검토하고 full regression을 수행한다.
2. **P1 access/data lifetime**: main analysis ownership/auth, TTL, deletion, durable-store 여부를 결정한다.
3. **P1 coupling**: suggestion legacy imports를 승인된 shared package 또는 adapter contract로 이동한 뒤 warning을 error로 승격한다.
4. **P1 cycles**: attention/eligibility/claims/artifacts cycle을 orchestration과 pure contracts로 분리한다. 이번 작업에서는 리팩터링하지 않았다.
5. **P2 runtime coverage**: 외부 connector와 실사용 입력을 받을 수 없는 synthetic-only analysis/evidence 및 suggestion Attention harness를 추가한 뒤 dev privacy guard의 해제 여부를 재검토한다.
6. **P2 drift cadence**: 주요 boundary 변경 또는 월 1회 `arch:check`/`arch:build`와 representative trace를 review한다.

```text
아키텍처 검사:
cd /Users/joo/BiaDone/apps/blabase && npm run arch:check

아키텍처 시각화:
cd /Users/joo/BiaDone/apps/blabase && npm run arch:build && npm run arch:model:dev

런타임 추적:
cd /Users/joo/BiaDone/apps/blabase && npm run arch:trace:test
```
