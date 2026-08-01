# Golden Baseline Runner — Engine Change Record

## 변경 범위

- Date: 2026-08-01
- Owner: Codex; 의미 품질과 개인정보 결정은 project owner 검토 대기
- Goal: 12개 Golden Note 사례에 동일한 cutoff와 기술 guardrail을 적용하고, 향후 저비용 LLM 후보와 비교할 deterministic 대조군을 재현 가능하게 만든다.
- Affected pipeline stages: Golden dataset metadata validation, ChatGPT share import sanitization, `sourceIndex` cutoff, deterministic note generation, provenance validation, private artifact reporting
- Behavior before: 사례와 Teacher draft는 있었지만 일괄 실행, source drift 차단, Teacher turn 관측, exact provenance, private output 격리, baseline report가 없었다.
- Behavior after: source count 및 adapter/share identity 검증, fail-closed cutoff, Teacher/internal/private artifact 누출 gate, candidate set/hash 검증, atomic private write를 제공한다. 의미 품질은 자동 판정하지 않는다.
- Versions before: baseline runner 없음; dataset version field 없음; ChatGPT share adapter v2
- Versions after: `gptmemory-golden-baseline-runner.v1`, `gptmemory-golden-baseline-guardrails.v1`, `gptmemory-golden-notes-dev-v1`, `gptmemory-chatgpt-share.v3`, `gptmemory-note-engine.v1`

## 재현 식별자

- Code commit: human-approved commit 대기; base revision `c15c82ef78fb9c84c05e1e9af7b5b6968130d2f4`
- Working-tree content manifest SHA-256: `957a070e3644a0a4808adbaedb6eaa70ef5df9715d0f89befe3f35a9269b51d9`
  - Scope: `apps/gptmemory` 아래 수정·추가 파일을 경로순으로 정렬해 각 SHA-256을 다시 SHA-256한 값. 순환 참조를 피하기 위해 이 기록 파일 자체는 제외했다.
- Evaluation dataset: `gptmemory-golden-notes-dev-v1`
- Dataset SHA-256: `3975c01140f1354a776292c64e6abe6d3e2943b403aed539deab631d1a8ee849`
- Dataset hash scope: `manifest_and_case_metadata`; 승인되지 않은 Teacher draft 본문은 채점에도 hash에도 포함하지 않았다.
- Analysis/evaluation run ID: `golden-20260801151947-ef16795a`
- Comparison run ID: N/A — 최초 전체 deterministic baseline
- Session ID: N/A — 서로 다른 12개 공유 세션으로 구성된 dataset run
- Candidate bundle SHA-256: `fc0356c2f98c5f10f8cd45e9057e24206f984d7a8722c187b276ae86febeaca2`

## 실행 구성

- Collection window: `2026-08-01T15:19:47.607Z`–`2026-08-01T15:20:07.784Z`
- Acquisition: 사용자가 제공한 12개 공개 공유 URL을 명시적 `--allow-live-fetch`로 다시 가져옴
- Included cases: 12; excluded cases: 0; concurrency: 1; retry: 0; timeout: 10,000 ms
- Context/segmentation: adapter title과 `sourceIndex <= lastIncludedMessageIndex`인 정제 메시지만 사용; note section은 포함된 user turn별 exact provenance를 요구
- Provider/model/prompt/judge: N/A — 이 대조군은 LLM과 자동 judge를 호출하지 않음
- Token usage/cost: N/A — 외부 모델 요청 없음
- Commands executed:
  - `npm run eval:golden -- --allow-live-fetch`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

모든 Node 명령은 다른 프로젝트의 runtime을 빌리지 않고, 이 프로젝트의 checksum 검증된 로컬 Node `22.23.2`를 PATH 앞에 두고 실행했다. `.local/`은 Git에서 제외된다.

## 결과

- Technical pass/fail/blocked: `12 / 0 / 0`
- Semantic quality: 12개 모두 `not_scored_pending_human_reference`
- Gates: 총 276개 중 pass 264, warning 12, fail 0. 각 사례는 23개 gate 중 22개가 pass하고 `source.content_identity_unverified` 1개가 warning이다.
- Source messages: 753; cutoff candidate input items: 370
- Omitted internal items: 1,885; preserved events: 2; redacted private artifact references: 31
- Provenance coverage: 모든 기술 통과 사례 `1.0`
- Output/input character ratio: 최소 `1.0102`, 최대 `1.0480`

기술 통과는 cutoff, provenance, sanitization, output contract만 만족했다는 뜻이다. 모든 candidate가 입력보다 약 1–5% 길어 현재 deterministic engine은 좋은 요약기가 아니라 안전성과 재현성을 확인하는 대조군이다.

## 예외·개인정보·보존

- 현재 v3 canonical input digest는 case metadata에 승인·고정되지 않았다. 동일 message count를 유지한 source drift는 기술 통과할 수 있으므로 각 사례에 warning을 남긴다. 직접 성능 비교 전 새 dataset version에서 사람이 확인한 digest를 고정해야 한다.
- raw HTML과 복원된 전체 message 배열은 저장하지 않았다. 중간 검증 산출물은 삭제했고, 최종 candidate와 report만 Git에서 제외된 `outputs/`에 `0700` directory 및 `0600` file 권한으로 유지한다.
- candidate는 거의 원문 수준의 private derived artifact다. adapter v3가 알려진 private artifact URI 31개를 제거했지만, 사람이 공개 가능하다고 승인한 문서는 아니다.
- `case.json`의 공개 공유 URL을 저장소에 계속 둘 권한, 저장소 공개 범위, 보존 기간은 아직 formal project decision으로 기록되지 않았다. 다음 push 또는 접근 범위 확대 전에 project owner가 판단해야 한다.
- 현재 Teacher draft는 모두 승인 전이며 자동 judge 결과를 Gold로 승격하지 않는다.

## Release와 후속 작업

- Release decision: 개발용 평가 기반 도구로만 사용한다. 제품 품질 점수나 human-approved Golden reference로 발표하지 않는다.
- Rollback method: `eval:golden` script와 Golden runner module을 제거하고 manifest의 개발 dataset metadata를 되돌린다. 사례와 Teacher draft 원문은 이 변경에서 수정하지 않았다.
- Agent가 계속 수행할 수 있는 작업: 승인된 reference를 소비하는 저비용 LLM candidate interface, provider/model/prompt/run metadata 기록, 동일 dataset 비교 report 구현
- Project owner 결정이 필요한 작업: 대표 candidate와 Teacher draft 검수, human reference 승인, 공유 URL의 저장·보존 정책, 사용할 LLM provider/model 및 비용·개인정보 한도
