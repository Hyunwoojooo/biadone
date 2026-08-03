# GPTMemory

GPTMemory는 공개 ChatGPT 공유 링크를 가져와 대화가 끝난 시점의 현재 상태,
확정된 결정, 완료된 결과, 남은 작업과 미해결 문제를 10초 안에 복원할 수 있는
개인 상태 노트로 바꾸는 앱입니다.

엔티티 그래프나 지식 그래프를 만들지 않습니다. 신규 import는 Google Gemini가
제안한 요청·완료·결정·제안·변경 사건을 서버가 근거와 시간순으로 검증하고 fold한
v3 상태 노트를 만듭니다. 기존 v2 압축 요약과 규칙 기반 v1 엔진은 과거 노트 호환과
접힌 `대화 흐름 상세 보기`를 위해 유지합니다.

Vite 설정은 Git에 없는 로컬 `build/sites-vite-plugin` 사본 대신
`@openai/sites-vite-plugin@0.1.0`을 개발 의존성으로 고정합니다. 따라서 새 clone과
CI에서도 동일한 Sites metadata·migration packaging 단계가 재현됩니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

상태 노트 생성에는 서버 전용 `GEMINI_API_KEY`가 필요합니다. 기본 모델은
`gemini-3.1-flash-lite`이며 `GEMINI_MODEL`로 변경할 수 있습니다. GPTMemory의
개발 실행기는 현재 저장소의 Blabase가 참조하는 비공개 env 포인터를 찾을 수 있으면
Gemini 설정 세 개만 allowlist로 읽어 재사용합니다. 비밀값을 이 프로젝트에 복사하지
않습니다. 다른 비공개 env를 쓰려면 다음 포인터만 설정할 수 있습니다.

```text
GPTMEMORY_SHARED_ENV_PATH=/absolute/path/to/private.env
```

`npm run dev`는 loopback(`127.0.0.1`)에 일회성 ChatGPT fetch bridge를 열고
vinext 개발 서버를 함께 실행합니다. bridge 인증 secret은 실행할 때마다 무작위로
생성되며 vinext 자식 프로세스에만 전달되고 출력되지 않습니다. 개발 서버를
종료하면 bridge도 함께 닫힙니다. vinext 옵션은 그대로 전달할 수 있습니다.

```bash
npm run dev -- --hostname 127.0.0.1 --port 3101
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
- D1에는 기존 v1 `overview`·`sections_json`을 유지하면서 버전이 있는 v2 요약 또는
  v3 상태 노트를 nullable `summary_schema_version`·`summary_json`에 저장합니다.
  기존 v1·v2 노트는 자동 변환하지 않습니다.
- Gemini는 최종 상태를 직접 확정하지 않고 원자적인 상태 사건 후보만 제안합니다.
  서버가 실제 근거 ID, 메시지 역할, 발생 순서와 허용된 생명주기 전이를 검증한 뒤
  현재 상태를 계산합니다.
- 완료된 요청은 열린 작업에서 제거하고, Assistant 제안은 사용자의 명시적 수락 전에는
  결정으로 승격하지 않습니다. 나중의 사용자 수정은 이전 방향을 대체한 이력으로
  남깁니다.
- 서버가 원문 조항별 근거 카탈로그와 요청 전용 숫자 인덱스를 만들고, Gemini는
  Structured Output의 허용 범위 안에서 인덱스만 선택합니다. 서버는 이를 다시 실제
  메시지 ID와 정확한 조항으로 변환해 검증하므로 모델이 근거 ID나 인용문을 만들 수
  없습니다.
- normalized source URL, source title/message count와 서버 내부 import provenance도
  저장합니다. provenance에는 run·workflow·adapter·note engine·schema·provider·
  model 버전, share ID, canonical conversation SHA-256과 fetch/generation 시각이
  포함되며 public note 응답에는 노출하지 않습니다.
- 가져온 ChatGPT 원본 HTML과 복원된 전체 대화 메시지는 저장하거나 로그로 남기지
  않습니다. 별도 `sourceSnapshot`도 만들지 않습니다. v3는 근거 확인에 필요한
  선택된 짧은 조항만 메시지 ID와 함께 저장합니다.
- 요약 생성 시 tool·reasoning·private URI 등을 제거한 사용자·assistant 메시지는
  Google Gemini API로 전송됩니다. API key와 provider 원문 응답은 브라우저,
  D1, 로그에 남기지 않습니다.

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
노트를 찾습니다. UI는 `기존 노트 열기`, `새 상태 노트로 재생성`, `취소`를 제공하며,
재생성은 사용자가 확인한 `noteId + updatedAt`이 현재 상태와 일치할 때만 v3 상태
노트를 갱신합니다. 기존 v1 본문과 사용자 편집본은 유지되고, provider 실패나 stale
write에서는 기존 row를 변경하지 않습니다.

가져오기 adapter는 사용자에게 보이지 않는 tool call, 검색 JSON, reasoning 및
실행 로그를 노트 입력에서 제외합니다. 실제 생성 결과가 확인된 이미지·파일은
내부 URI나 저장 경로 대신 짧은 이벤트로 남깁니다. 응답의 `diagnostics`에는 정제
전후 메시지 수만 기록하며 원본 tool 내용은 포함하지 않습니다.

로컬 개발에서는 별도 fetcher 설정이 필요하지 않습니다. 배포 환경처럼 외부
fetcher를 사용해야 할 때는 아래 두 환경변수를 **항상 함께** 설정합니다. 두 값이
이미 있으면 개발 실행기도 로컬 bridge를 시작하지 않고 해당 fetcher를 그대로
사용하며, 둘 중 하나만 있으면 잘못된 구성으로 보고 즉시 중단합니다.

```text
CHATGPT_SHARE_FETCHER_URL
CHATGPT_SHARE_FETCHER_SECRET
```

자동으로 실행되는 loopback bridge는 로컬 개발 전용입니다. 프로덕션에서는 외부에
배포한 fetcher URL과 secret을 런타임 환경변수로 관리해야 합니다.

자세한 제품·구현 결정은 [implementation_plan.md](./implementation_plan.md)에
기록합니다.

대화 정리의 사용자 가치와 제품 원칙은
[GPT 대화 정리의 근본 가치](./docs/conversation-organization-first-principles.md)에
정리합니다.

상태 노트의 공개 스키마, 사건 원장과 생명주기 규칙은
[GPTMemory State Note v3](./docs/state-note-v3-spec.md)에 정리합니다. 긴급 롤백이
필요하면 서버 환경변수 `GPTMEMORY_GENERATION_MODE=summary-v2`로 신규 import만 기존
v2 생성기로 되돌릴 수 있습니다.

## 평가 데이터

강한 모델의 Teacher draft, 입력 cutoff, 사람 검수 상태는
[`evals/golden-notes/`](./evals/golden-notes/)에서 관리합니다. Teacher 요청과
답변은 저비용 모델의 평가 입력에서 항상 제외합니다.

v3의 구현 범위, 검증 결과와 아직 필요한 사람 평가는
[State Note v3 구현 기록](./evals/golden-notes/STATE_NOTE_V3_RECORD.md)에 기록합니다.
