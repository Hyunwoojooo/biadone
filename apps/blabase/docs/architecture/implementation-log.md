# Architecture visibility implementation log

작업 기준일: 2026-08-14 (Asia/Seoul)

이 문서는 아키텍처 가시화·검증 인프라 도입 전후의 명령과 결과를 시간순으로 기록한다. 제품 코드와 테스트가 실제 구현의 기준이며, 이 로그의 실패는 도입 전 실패와 도입 후 회귀를 구분해서 기록한다.

## Phase 0 — repository safety and baseline

### Repository inventory

- Git top level: `/Users/joo/BiaDone`
- 대상 프로젝트: `apps/blabase`
- 브랜치: `main`
- 구조: 저장소 루트에는 package manager가 없는 monorepo 형태이며, `apps/blabase`와 `apps/blabase/suggestion`은 각각 독립 `package.json`과 `package-lock.json`을 가진 npm 프로젝트다. npm workspace 선언은 없다.
- 실제 Node.js: `v22.23.2`
- npm: `10.9.8`
- Node version pin: `package.json#engines`, `.nvmrc`, `.node-version` 모두 없음.
- Main app installed framework: Next.js `15.5.20`, React `19.2.7`, TypeScript `5.9.3`, Vitest `3.2.6`.
- Suggestion app installed framework: Next.js `15.5.21`, React `19.2.8`, TypeScript `5.9.3`, Vitest `3.2.7`, Playwright `1.62.0`.
- Main source roots: `src/app`, `src/components`, `src/core`, `tests`, `tools`.
- Suggestion source roots: `suggestion/app`, `suggestion/src`, `suggestion/tests`, `suggestion/tools`, `suggestion/desktop/macos`.
- TypeScript alias: main app의 `@/*`는 `./src/*`를 가리킨다. suggestion app에는 path alias가 없다.
- 기존 CI: Git 저장소에서 `.github/workflows` 또는 다른 CI 설정을 찾지 못했다.
- 기존 architecture tool 설정: `appmap.yml`, dependency-cruiser 설정, LikeC4 모델, `.cbmignore`, `.codebase-memory` 설정을 찾지 못했다.
- 현재 Codex session: codebase-memory MCP tool이 노출되지 않았고 `codex mcp list`에도 등록되어 있지 않다. 사용자 홈 설정은 변경하지 않는다.

### Dirty worktree safety record

작업 시작 시점부터 `suggestion/`의 API, TypeScript, Swift launcher, 테스트, 문서와 `../gptmemory/.env.example`에 미커밋 변경이 존재했다. 또한 dashboard·runtime architecture 산출물과 project-local skill 파일이 untracked 상태였다. 이 작업에서는 기존 변경을 초기화·삭제·덮어쓰기하지 않는다. 아키텍처 인프라가 수정하는 `package.json`, lockfile, `.gitignore`, `AGENTS.md`와 신규 architecture 파일은 기존 변경과 별도로 검토한다.

### Baseline commands

| 명령 | 위치 | 결과 | 시간 | 분류와 처리 |
|---|---|---:|---:|---|
| `npm ls --depth=0` | main | PASS | 0.28s | 설치 상태 정상. `@emnapi/runtime` extraneous 1건은 도입 전 상태이며 이번 작업에서 제거하지 않는다. |
| `npm ls --depth=0` | suggestion | PASS | 0.28s | 설치 상태 정상. `@emnapi/runtime` extraneous 1건은 도입 전 상태이며 이번 작업에서 제거하지 않는다. |
| `npm run lint` | main | FAIL | 17.26s | 도입 전 실패. root `eslint .`가 nested `suggestion/.next/dev/**` generated webpack 파일까지 검사해 13개 `@next/next/no-assign-module-variable` 오류를 냈다. 제품 소스 오류가 아니며 architecture 도입 회귀가 아니다. |
| `npm run typecheck` | main | PASS | 14.47s | 기준선 통과. |
| `npm run lint` | suggestion | PASS | 10.04s | 기준선 통과. |
| `npm run typecheck` | suggestion | PASS | 2.73s | 기준선 통과. |
| `npm test` | main | PASS | 1.30s | 28 files, 159 tests 통과. |
| `npm test` | suggestion | FAIL | 17.04s | 도입 전 실패. 153 files 중 152 통과, 1 실패; 1,289 tests 중 1,287 통과, 2 실패. `tests/liveWorkBoardShadow.test.ts` 두 케이스가 `src/suggestionBoard/liveShadow.ts:248`에서 `captured.evaluated.run.sources`를 읽다 실패했다. 기존 dirty worktree의 Work Board 변경과 연결된 문제이며 이번 관찰 인프라 작업에서 제품 동작을 수정하지 않는다. |
| `npm run build` | main, sandbox | FAIL | <1s | 샌드박스의 `listen EPERM 127.0.0.1` 제약. 제품 실패로 분류하지 않음. |
| `npm run build` | main, approved local rerun | PASS | 23.72s | 외부 배포 없이 로컬 production build 통과. |
| `npm run build` | suggestion | PASS | 17.37s | production build 통과. `.env.local`은 Next.js가 존재 여부만 표시했으며 내용을 읽거나 기록하지 않았다. |

### Baseline conclusion

- 제품 build와 양쪽 typecheck는 통과했다.
- main lint와 suggestion unit test에는 아키텍처 도입 전부터 존재한 실패가 있다.
- 아키텍처 인프라는 이 두 제품 문제를 우회하거나 제품 코드를 수정하지 않고, 최종 검증에서 동일 실패인지 비교한다.

## Phase 1 — current code architecture

소스 route, import, symbol, 환경 분기, storage 구현과 테스트를 직접 조사했다. 결과는 `current-state.md`에 fact/inference 구분과 함께 기록했다.

- main live flow는 `UrlInputForm.handleSubmit` → `POST /api/analyses` → `importChatGPTShareUrl` → normalization → live deterministic `extractMockStructure` → optional LLM shadow → LLM evidence verification → process memory store다.
- 독립 paste ingestion, persisted review mutation, queue/background job, durable main store는 현재 코드에서 확인되지 않았다.
- suggestion은 별도 Next.js 앱이며 local source sync, Active Attention, Work Board/Continuation, private `.local` repositories와 macOS launcher를 갖는다.
- suggestion의 legacy restore/types 경로 네 곳만 main source를 import한다.
- 현재 구현과 계획을 `architecture/model.c4`, `architecture/planned.c4`로 분리했다.

## Phase 2 — dependency-cruiser

- `dependency-cruiser@18.2.0`을 exact devDependency로 설치했다. 이 버전의 Node engine `^22 || ^24 || >=26`와 실제 Node `22.23.2`가 호환된다.
- `dependency-cruiser.config.mjs`, `dependency-cruiser.suggestion.config.mjs`, `dependency-cruiser.scripts.config.mjs`와 artifact helper를 작성했다. repository/cross-boundary pass는 root `tsconfig.json`, suggestion-native pass는 `suggestion/tsconfig.json`과 nested package boundary를 사용한다. 두 tsconfig의 `allowJs:false` 때문에 `.mjs` import가 누락되는 것을 QA에서 발견해, 발견된 JS/MJS/CJS entry를 tsconfig 없이 분석하는 세 번째 pass를 추가했다. 실제 source roots만 분석하므로 `.next`, node_modules, artifacts, AppMap, `.env*`는 graph에 들어가지 않는다.
- 초기 설정 과정에서 복잡한 exclude 정규식이 dependency-cruiser ReDoS guard에 막힌 것과 `baseDir` 설정 오용을 확인해, broad exclude 없이 단순한 include root와 project-relative tsconfig로 수정했다.
- 최종 repository pass: PASS, 592 modules, 2,026 dependencies, 0 errors, 12 warnings. warning은 기존 suggestion cycle 8건과 suggestion → main legacy import 4건이다.
- 최종 suggestion-native pass: PASS, 480 modules, 1,803 dependencies, 0 errors, 8 cycle warnings. `suggestion/e2e`, `playwright.config.ts`, `middleware.ts`를 포함하고 CI가 nested lockfile을 별도로 설치한다.
- 최종 JS/MJS pass: PASS, 30 modules, 30 dependencies, 0 errors, 2 warnings. 자동 발견한 entry 17개와 핵심 import sentinel 4개를 assertion한다. macOS bundler의 `esbuild`와 `node:fs/promises`, architecture helper의 Node built-ins가 실제 graph에 포함된다. 두 warning은 기존 ESLint config가 transitive `@eslint/eslintrc`를 직접 import하는 경로다.
- 신규 위반을 막는 test/fixture/unresolvable/undeclared/devDependency/core→UI/main→suggestion 규칙은 error다. UI→server integration 규칙은 `"use client"`를 의미 분석하는 보안 증명이 아니라 비-API UI path의 runtime import를 표시하는 review warning이다.
- `npm run arch:deps:graph`는 Mermaid 4종을, `npm run arch:deps:report`는 세 pass의 HTML/JSON report를 생성했다.

## Phase 3 — LikeC4

- `likec4@1.59.2`를 exact devDependency로 설치했다. Node engine은 `>=22.22.3`이다.
- `specification.c4`, current `model.c4`, separate `planned.c4`, static `views.c4`, `dynamics.c4`를 작성했다.
- 뷰: system context 1, container 1, main/suggestion component 2, planned 1, dynamic 3으로 총 8개의 명시적 view와 project landing을 제공한다. LikeC4 build는 총 9 view layout을 보고했다.
- 최초 validation은 element tag가 property보다 뒤에 있었던 문법 오류를 정확히 보고했다. 설치 버전 문법에 맞춰 tag 순서를 수정한 뒤 `likec4 validate`가 5 files 모두 통과했다.
- `arch:sources:check`를 추가해 최종 LikeC4 local source link 49개를 실제 파일 존재 여부로 검사한다. 이 검사에서 잘못 추정한 suggestion 경로 4개를 발견하고 실제 파일로 교정했다.
- `npm run arch:model:build`: PASS. Playwright/PNG 없이 static site를 `artifacts/architecture/likec4`에 생성했다.

## Phase 4 — AppMap

- `appmap-node@2.26.1`을 exact devDependency로 설치했다. package metadata의 Node range는 `>=18`이다.
- `appmap.yml`을 main/suggestion 실제 source roots로 제한하고 generated/private 범위를 제외했다. 설치 agent의 exclude가 glob이 아닌 literal substring matcher임을 확인해 `*` 없는 표현으로 교정하고 connector 전체를 제외했다.
- `npx appmap-node --help`는 help가 아니라 실행 target으로 해석돼 `spawn --help ENOENT`가 났고 default config를 만들었다. default file을 보존하지 않고 검토된 config로 교체했으며 runbook에 이 CLI 특성을 기록했다.
- `npm run arch:trace:test`: PASS, 1.63s. Node `22.23.2`, Vitest `3.2.6`에서 privacy-safe ChatGPT fixture의 3 tests가 통과하고 3 AppMap recordings를 `tmp/appmap/vitest/`에 생성했다.
- 초기 `arch:trace:dev` 호환성 smoke는 `http://127.0.0.1:3000` Ready까지 확인했으나, QA에서 AppMap HTTP recorder가 실제 share URL·response body·함수 인자를 기록할 수 있음을 확인했다. live synthetic fixture mode가 없는 최종 상태에서는 이 명령을 privacy guard로 교체해 의도적으로 exit 2로 차단했다.
- `npm run arch:trace:config:check`는 설치된 agent matcher로 provider/Golden/generated/connector/private fixture 9개가 제외되고, reviewed source/test 3개가 포함되며, dev trace가 fail-closed인지 자동 검사한다.
- recording에서 credential-shaped pattern을 찾지 못했고 `.gitignore` 적용과 Git 미추적 상태를 확인했다.

## Phase 5 — codebase-memory installation and cross-validation

후속 사용자 승인에 따라 공식 installer를 파일로 받아 378줄 전체와 SHA-256 `2fdd4d6563fc8e540bb32e233c5fdef22ecf05d7ebd5a80657cd4fec953b3475`를 검토했다. 검증 시점에는 `codebase-memory-mcp 0.10.3` 설치, Codex MCP enabled 등록, durable instruction, skill, `hook-augment` hook, loopback UI `127.0.0.1:9749`가 이미 완료된 상태였다. 현재 process에는 server tool이 hot-load되지 않아 동일 binary의 공식 CLI로 교차검증했고, 재시작 뒤 native MCP를 사용할 수 있다.

- full index generation `2026-08-14T06:53:18Z`: ready, 14,659 nodes, 64,543 edges, shared artifact 없음.
- 첫 index에서 `suggestion/desktop/macos/.build` 생성물이 들어간 것을 발견해 `.cbmignore`에 SwiftPM `.build`와 `.swiftpm`을 추가하고 재색인했다. parse partial은 55개에서 22개로 줄었고 남은 22개는 모두 suggestion test다.
- 분석 API, share adapter, normalizer, shadow extractor, evidence verifier, sync coordinator/runtime, legacy restore의 production evidence 8개는 current generation과 metadata가 일치하며 recorded issue가 없다.
- `POST /api/analyses` outbound 126개, `SourceSyncCoordinator.sync` outbound 31개, `restoreConversations` outbound 28개를 pagination 없이 전부 추적했다. LSP 중심 graph와 원문 source를 대조한 결과 implemented LikeC4의 핵심 edge에 구조 drift가 없어 C4 모델 변경은 하지 않았다.
- installer review, restart/hook trust, CLI index/coverage, built-in UI, cache/log, update/uninstall 절차와 검증 snapshot을 runbook에 기록했다.

## Phase 6–9 — operations, CI, and final validation

- `AGENTS.md`에 architecture maintenance 규칙을 최소 추가했다.
- `arch:check`는 세 dependency pass, 49 source links, AppMap safety, LikeC4 format과 validation을 순차 실행한다.
- `arch:build`는 Mermaid/HTML/JSON dependency artifacts와 LikeC4 static site를 생성한다.
- repository root `.github/workflows/architecture-check.yml`은 Node `22.23.2`, main과 suggestion의 개별 `npm ci`, `arch:check`, `arch:build`, 14-day artifact upload만 수행하며 AppMap/배포/secret을 요구하지 않는다.
- main ESLint ignore를 nested generated directories에도 적용하도록 수정했다. 기준선의 `suggestion/.next` 오검사가 사라져 final lint는 warning 없이 통과한다.
- Archify skill로 main current flow standalone HTML을 추가했다. specification은 showcase 9/9, 0 errors, 0 warnings이며 1440×900, 1600×1000, 1920×1080, 2048×1320 light containment과 1440/2048 light/dark capture가 통과했다. 실제 light/dark screenshots를 검수했다.

### Final command matrix

| 명령 | 결과 | 시간/수치 | 비고 |
|---|---:|---:|---|
| final `npm ci --ignore-scripts --no-audit --no-fund` | PASS | 7.62s | synchronized final root lockfile에서 717 packages clean install. architecture dev tool 해석에 필요한 `acorn 8.18.0`, `nanoid 3.3.18` patch bump는 유지하고 아래 risk에 공개한다. |
| lock-preservation/offline install probes | RECOVERED | <1s 및 1m43s | 이전 product transitive를 강제하면 `npm ci`가 lock 불일치로 거부함을 확인해 되돌렸다. offline cache에는 old acorn tarball이 없어 `ENOTCACHED`; sandbox network 대기는 조사 후 종료하고 승인된 clean install로 대체했다. |
| `npm run lint` | PASS | 12.81s | final clean install, architecture config/tools 포함, warning 없음. |
| `npm run typecheck` | PASS | 8.86s | main. |
| `npm test` | PASS | 1.11s | codebase-memory 교차검증 후 main 28 files, 159 tests. |
| `npm run build` | PASS | 19.49s earlier; final call 403.6s tool wall | main production build. final log의 compile은 1.217s이고 모든 route 생성이 통과했으나 command output 회수 지연이 길었다. 배포 없음. |
| `npm run lint` | PASS | 16.40s | suggestion. |
| `npm run typecheck` | PASS | 3.34s | suggestion. |
| `npm test` | PASS | 16.09s | codebase-memory 교차검증 후 suggestion 158 files, 1,327 tests. 기준선 실패를 architecture 변경이 고친 것이 아니라 기존 dirty product files가 작업 중 갱신된 결과다. |
| `npm run build` | PASS | 16.41s | suggestion production build, 배포 없음. |
| `npm run arch:deps:check` | PASS | integrated | repository 592/2,026/12 warnings; suggestion-native 480/1,803/8; scripts 30/30/2. 세 pass 모두 0 error. |
| `npm run arch:deps:graph` | PASS | integrated | top/main/suggestion/JS-MJS scripts Mermaid 4종 생성. |
| `npm run arch:deps:report` | PASS | integrated | standalone HTML + JSON 생성. |
| `npm run arch:model:check` | PASS | 5 files | all views layouted. |
| `npm run arch:model:build` | PASS | integrated | static site 생성. |
| `npm run arch:check` | PASS | 7.05s | codebase-memory 교차검증 후 세 dependency pass + 49 links + AppMap safety + format + model validation. |
| `npm run arch:build` | PASS | 29.94s | 세 pass reports, Mermaid 4종과 LikeC4 output refreshed. |
| `npm run arch:trace:config:check` | PASS | <1s | 9 exclusions, 3 includes, dev fail-closed. |
| `npm run arch:trace:dev` | SAFE BLOCK | <1s | 실제 대화 기록 방지를 위해 설명과 exit 2를 반환. |
| `npm run arch:trace:test` | PASS | 1.4s | 3 fixture tests, 3 recordings. |
| Prettier targeted check | PASS | 0.22s | package/config/helper/workflow files. |
| `git diff --check` | PASS | — | whitespace error 없음. |
| generated/private ignore check | PASS | — | AppMap, artifacts, `.codebase-memory`, visual-check sidecars ignored; tracked output 0. |
| credential-shape scan | PASS | — | architecture sources/docs/standalone HTML에서 key/token/private-key pattern 없음. |

### Security audit note

`npm audit --omit=dev --json`은 7 high를 보고했다. 직접 dependency인 installed Next `15.5.20`에 대해 `15.5.21` 미만 advisory가 포함되며, transitive `postcss`, `sharp`, `undici`, `brace-expansion`, `miniflare`와 direct `wrangler`도 report에 나타난다. `npm ci` 전체 summary는 8 high다. 이 문제는 architecture tool 설치 전에 쓰던 제품/framework dependency도 포함하고, 자동 `npm audit fix`는 제품 version을 바꿀 수 있어 이번 관찰 인프라 범위에서 실행하지 않았다. 별도 dependency upgrade/회귀 검증 작업이 필요하다.

### Engine recordkeeping conclusion

이번 변경은 product engine input/output, prompt, extraction, evidence filtering, ordering, result resolution을 변경하지 않았다. Golden baseline 또는 Engine Change Record 재실행 대상이 아니다. AppMap은 기존 synthetic fixture만 사용했고 production conversation을 dataset이나 recording으로 승격하지 않았다.
