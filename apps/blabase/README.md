# blabase

ChatGPT 공유 링크의 대화를 복원하고 구조화하는 Next.js 애플리케이션입니다.

## Engine Development Records

엔진, Golden Dataset, 평가, 프롬프트, Evidence 규칙을 변경하기 전에
[`docs/ENGINE_DEVELOPMENT_RECORDS.md`](docs/ENGINE_DEVELOPMENT_RECORDS.md)를
읽습니다. 이 문서는 Codex CLI와 사람이 반드시 남겨야 하는 실행 버전, 데이터
출처, Evidence, 평가, 사용자 수정, 개인정보, 릴리스 기록을 정의합니다.

## URL Parsing QA MVP

홈에서 ChatGPT 공유 링크를 제출하면 분석 완료 후
`/analyses/ana_...?tab=entity_graph`로 이동합니다. 첫 화면의 `LLM Entity
Graph`는 Evidence 검증을 통과했거나 리뷰가 필요한 LLM 의미 항목을 중앙 핵심
후보와 주변 노드로 표시합니다. Turn Inspector의 `Parsing QA`에서는 복원된
canonical 메시지를 user, assistant, clean conversation, context signal,
excluded/internal, unsupported content, turn으로 나누고 Import Warning을 함께
표시합니다. 원문과 Rule/LLM 추출 결과를 나란히 비교하고 Evidence message 번호를
눌러 해당 원문으로 이동할 수 있습니다.

분석 결과 확인은 Golden Dataset Sheet 동기화 성공 여부와 분리되어 있습니다.
Sheet 등록은 Extraction Monitor 헤더의 표 아이콘으로 명시적으로 실행합니다.

### DB 없는 MVP 세션

현재 분석 저장소는 서버 메모리이며 영구 DB를 사용하지 않습니다. Workers의
요청별 isolate에 의존하지 않도록 분석 POST 응답이 결과와 메시지를 함께 돌려주고,
같은 브라우저의 메모리와 `sessionStorage`로 결과 화면에 전달합니다.

- URL 제출 직후의 결과 화면은 Workers isolate가 달라져도 열립니다.
- 큰 대화가 브라우저 저장 한도를 넘으면 현재 탭의 메모리에서만 유지됩니다.
- 새 브라우저, 다른 기기, 장기 보관, 공유 가능한 분석 URL은 아직 지원하지
  않습니다. 이 범위가 필요할 때 영구 저장소를 도입합니다.

## Cloudflare Workers 배포

운영 주소 `https://blabase.com`과 `https://www.blabase.com`은
`@opennextjs/cloudflare`로 빌드한 Worker `blabase-app`이 서비스합니다.

```bash
npm run preview
npm run deploy
```

- `wrangler.jsonc`의 두 Worker Route가 기존 Pages origin보다 먼저 모든 경로를
  처리합니다.
- ChatGPT가 Cloudflare Worker의 직접 요청을 차단할 수 있어 운영 Worker에는
  `CHATGPT_SHARE_FETCHER_URL`, `CHATGPT_SHARE_FETCHER_SECRET` 두 secret이
  필요합니다. 값은 저장소에 기록하지 않습니다.
- `sites/blabase.com`의 정적 Pages 배포는 현재 운영 화면이 아니라 Route 제거 시
  돌아갈 수 있는 롤백 원본입니다.
- 상세 운영 및 롤백 절차는
  [`../../ops/cloudflare/blabase.com.md`](../../ops/cloudflare/blabase.com.md)에
  기록합니다.

## Conversation Atlas

Extraction Monitor의 `LLM Entity Graph`에서는 LLM 정리 결과를, `Hybrid
Structure` 또는 `/atlas?analysisId=ana_...`에서는 Rule+LLM 개념 관계와 대화
흐름을 탐색합니다. 같은 브라우저에서는 마지막으로 연 Atlas 분석 ID를
기억합니다.
분석 기록이 없는 직접 방문자는 인터랙티브 데모를 볼 수 있고, 새 분석이 완료되면
실제 세션 데이터로 자동 전환됩니다.

## Golden Dataset Sheet 등록

분석 결과 화면의 표 아이콘을 누르면 현재 `blabase Golden Dataset - Multi-session Labeling` Sheet에 새 세션을 등록합니다.

- `00_세션목록`: 다음 `S-xxx` ID, 제목, 링크, 수집일을 기록합니다.
- `01_전체메시지`: 전체 메시지를 화자·분류·분석 대상과 함께 기록합니다.
- `02_프롬프트판정`: 사용자 프롬프트마다 사람이 작성할 빈 판정 행을 만듭니다.
- `03_세션요약`: 세션 ID와 제목만 만들고 사람의 요약 칸은 비워 둡니다.
- `04_예상추출항목`: 정답 데이터이므로 자동으로 만들거나 수정하지 않습니다.
- 동일한 공유 링크가 이미 있으면 새 행을 만들지 않고 기존 세션을 반환합니다.

Google Sheets API를 활성화한 서비스 계정을 만들고 대상 Sheet를 해당 서비스 계정 이메일에 편집자로 공유한 뒤 다음 환경변수를 설정합니다. 비공개 키는 실제 개행 또는 `\\n` 문자열 형식을 모두 지원합니다.

```text
BLABASE_GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
BLABASE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
BLABASE_GOLDEN_SHEET_ID=1_xJUjB3zy68CKZ0zdBt15vDaqWPwFmoIzANRhnOzGBQ
```

## Sprint 5A LLM Shadow Mode

LLM Shadow Mode는 기존 RuleExtractor 결과를 대체하지 않습니다. 같은 Clean Conversation을 LLM으로 별도 분석하고, Rule/LLM 공통 `SemanticItem` 결과를 분석 레코드와 GPT Audit 파일에 함께 저장합니다.

```text
BLABASE_LLM_SHADOW_ENABLED=true
BLABASE_LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
```

- `BLABASE_LLM_SHADOW_ENABLED`가 `true`가 아니면 API를 호출하지 않습니다.
- `BLABASE_LLM_PROVIDER`는 `gemini`, `qwen`, `openai`를 지원하며 기본값은 `openai`입니다.
- Gemini는 `GEMINI_API_KEY`, Qwen은 `DASHSCOPE_API_KEY`, OpenAI는 `OPENAI_API_KEY`를 사용합니다.
- Gemini는 기본적으로 `https://generativelanguage.googleapis.com/v1/interactions`를 사용하며 `GEMINI_BASE_URL`로 재정의할 수 있습니다.
- Qwen의 `QWEN_BASE_URL`은 API 키를 발급받은 리전에 맞게 설정해야 합니다.
- Gemini는 stateless `store=false`, minimal thinking, JSON Schema Structured Output으로 호출합니다.
- Qwen JSON mode를 위해 non-thinking 모드로 호출하고 반환값을 공통 Zod schema로 다시 검증합니다.
- LLM 호출 또는 schema 검증이 실패해도 Rule 결과와 기존 UI는 정상 유지됩니다.
- Shadow Mode를 활성화하면 Clean Conversation 내용이 선택한 외부 LLM API로 전송됩니다. 민감한 대화에는 사용하지 마세요.

## Golden Core v0.1 베이스라인

S-001~S-020에서 사람이 승인한 `02_프롬프트판정!H:K`와
`03_세션요약!C:J`만 Gold Core v0.1로 사용합니다. 검수하지 않은 사용자
만족도(`02!Q`)와 `04_예상추출항목`은 제외합니다.

베이스라인 실행 전에는 결정적 품질 검사기를 실행합니다. 검사기는 Gold를
수정하거나 원문을 출력하지 않고 구조 오류는 `error`, 사람 확인이 필요한 빈값,
취소 입력, 보류 판정은 `warning`으로 보고합니다.

```text
npm run golden:validate -- \
  --input .local/golden-v01-input.json \
  --output .local/golden-v01-quality.json
```

- 기본 실행은 `error`가 있을 때 실패하며, `warning`도 배포 gate로 사용할 때는
  `--fail-on-warning`을 추가합니다.
- 알려진 동결 데이터셋의 세션 범위와 레코드 수도 검사합니다. 임시 fixture에는
  `--no-profile`을 사용할 수 있습니다.
- 전체 JSON을 표준 출력으로 확인할 때는 `--json`을 사용합니다.
- 베이스라인 runner도 같은 검사를 자동 실행하며, 구조 오류가 있으면 LLM API를
  호출하기 전에 중단합니다.

서버는 최신 로컬 보고서를 read-only API로 제공합니다.

```text
GET /api/golden/quality
```

응답에는 `datasetVersion`, `goldSnapshotSha256`, `qualityReportVersion`,
`generatedAt`, 오류·경고 개수, 경고 코드와 대상 ID만 포함됩니다. Gold 원문,
이슈 설명, 필드명, 공유 URL, Spreadsheet ID는 반환하지 않으며 모든 응답은
`Cache-Control: no-store`입니다. 기본 파일은
`.local/golden-v01-quality.json`이고 서버 환경변수
`BLABASE_GOLDEN_QUALITY_REPORT_PATH`로 다른 비공개 경로를 지정할 수 있습니다.
보고서가 없으면 `404`, 읽을 수 없거나 계약에 맞지 않으면 `503`을 반환합니다.
Extraction Monitor 헤더의 방패 아이콘 또는 `/golden/quality`에서 데이터셋
메타데이터, 오류·경고 집계, 경고 코드 분류와 검수 대상 목록을 확인하고 최신
보고서를 다시 불러올 수 있습니다.

```text
set -a; source /Users/nika/.blabase/blabase.env; set +a
npm run golden:baseline -- \
  --input .local/golden-v01-input.json \
  --output .local/golden-v01-results.json \
  --html-dir /private/tmp \
  --concurrency 3
```

- Gemini가 Gold를 보지 않고 02의 현재 프롬프트 단독(B1), 이전 맥락 포함(B2),
  03의 전체 세션 요약을 생성합니다.
- 별도의 Gemini 평가 호출이 각 Gold 필드의 의미 일치도·완전성·근거성을
  0~2점으로 판정합니다. 같은 모델 계열의 자동 채점이므로 사람 검수를 대체하지
  않고 검수 우선순위를 정하는 기준으로 사용합니다.
- 실행 결과는 중간 저장되므로 같은 출력 경로로 재실행하면 완료된 대상을
  건너뜁니다.
- v0.1은 모델 개발에 사용한 `dev` 데이터이므로 일반화 성능이 아니라 초기
  비교 기준으로만 해석합니다.

### Sprint 5A-2 품질 보정

긴 대화를 한 번에 요약하지 않도록 RuleExtractor의 Topic Flow를 구간 힌트로 사용합니다. 기본적으로 구간당 28,000자, 최대 40개 메시지로 묶고 최대 12개 구간을 3개씩 병렬 분석합니다. 직전 assistant 메시지는 첫 user reaction의 satisfaction/acceptance 판단을 위한 context-only 메시지로만 겹쳐 전달합니다.

```text
BLABASE_LLM_SEGMENT_MAX_CHARS=28000
BLABASE_LLM_SEGMENT_MAX_MESSAGES=40
BLABASE_LLM_SEGMENT_MAX_COUNT=12
BLABASE_LLM_SEGMENT_CONCURRENCY=3
```

- 각 구간은 intent, topic, decision, open question, action, preference, content constraint, problem signal, satisfaction, change event, entity, relation을 독립적으로 점검합니다.
- 여러 구간에서 생성된 exact duplicate는 evidence와 trigger phrase 기준으로 병합합니다.
- 일부 구간만 실패하면 전체 상태를 `partial`로 기록하고 성공한 구간의 후보는 보존합니다.
- GPT Audit에는 구간별 상태, 토큰 사용량, 응답시간, semantic type coverage, evidence message coverage를 함께 기록합니다.

### Sprint 5B Evidence Verifier

LLM 후보를 원문과 다시 대조해 `verifiedItems`, `reviewQueue`, `rejectedItems`로 분리합니다. 검증기는 규칙 기반으로 실행되므로 추가 LLM API 호출이나 토큰 비용이 발생하지 않습니다.

- `triggerPhrase`가 인용한 Clean Conversation 메시지에 실제로 존재하는지 확인하고 정확한 `startChar/endChar`를 저장합니다.
- intent, preference, content constraint, problem signal, change event는 직접적인 user evidence가 있어야 검증됩니다.
- decision은 명시적인 user 결정 표현 또는 assistant 제안 직후의 user 수락 반응이 필요합니다.
- satisfaction은 assistant final answer와 그다음 user reaction이 함께 인용되고 상태 표현이 일치해야 합니다.
- 잘못된 index와 Context/Internal 근거는 `rejectedItems`, span 불일치·암시적 판단·낮은 confidence는 `reviewQueue`로 이동합니다.
- RuleExtractor와 Sprint 3/4 결과는 변경하지 않으며, Rule/LLM 충돌 해소는 Sprint 5C에서 수행합니다.
- 분석 결과 화면의 Sprint 5 탭에서 LLM 실행 지표, segment 상태, Rule/LLM 타입 분포와 Evidence 검증 결과를 확인할 수 있습니다.
