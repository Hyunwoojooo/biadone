# Prompt binding restart safety

- 작성일: 2026-09-02 (KST)
- 상태: v1 안전장치 구현, v2 영속 복구 설계
- 범위: `UserPromptSubmit` 이후 첫 `emit_decision` 이전의 서비스 교체·재시작

## 결론

현재 `Contracts/v1`에서 안전한 기본 정책은 활성 Codex와 구 Blabee MCP를 모두
드레인한 뒤에만 service·Plugin·cache를 교체하는 것이다. 실행 중인 Codex는 새
Plugin을 hot-load하지 않으며, `UserPromptSubmit`이 발급한 prompt authority도
프로세스 메모리에만 있으므로 중간 교체를 호환 manifest만으로 복구할 수 없다.

v1에서는 다음을 보장한다.

- 활성 Codex 또는 구 Blabee 참조가 있거나 프로세스 조사를 완료하지 못하면 교체를
  보류한다.
- 프로세스를 강제 종료하거나 cache를 먼저 제거하지 않는다.
- 예상하지 못한 daemon 재시작, stale wrapper 또는 알 수 없는 session으로 prompt authority를
  찾지 못하면 journal을 쓰지 않고 `proposal_session_context_missing`으로 실패 폐쇄한다.
- MCP에는 세션 존재 여부를 노출하지 않도록 다른 binding mismatch와 같은
  `decision_context_invalid_or_expired`를 반환한다.
- 사용자는 세션을 재개하고 새 프롬프트를 제출해 새로운 authority를 발급받는다.

## v1에서 영속 복구를 넣지 않는 이유

frozen `Contracts/v1` runtime event는 이미 존재하는 decision boundary의 전체 binding을
요구한다. `UserPromptSubmit` 시점에는 `decision_boundary_id`가 아직 없으므로 prompt
binding을 기존 이벤트로 저장하면 존재하지 않는 경계를 합성하게 된다.

SQLite v1도 exact-schema를 검증하며 기존 DB의 암묵적 migration을 거부한다. 새 테이블을
조용히 추가하거나 인증되지 않은 sidecar 파일을 두는 방식은 rollback·replay 경계를
약화하므로 사용하지 않는다.

## Contracts/v2 제안

### Prompt binding

`CoordinatorPromptBinding`은 다음 비밀이 아닌 lineage를 보존한다.

```text
binding_id
project_id
project_path
cwd
session_id
source_turn_id
source_prompt_id
episode_id
episode_root_prompt_id
episode_baseline_checkpoint_id
prompt_hmac_sha256
correlation_token_hmac
key_version
issue_idempotency_hmac
prompt_origin
issued_at
expires_at
supersedes_binding_id?
```

원문 prompt, 원본 correlation token, Hook additional context는 저장하지 않는다. 짧고 흔한
prompt를 사전 대입으로 추측하지 못하도록 일반 SHA-256이 아니라 별도 domain key의 HMAC을
사용한다.

### Events

1. `prompt_binding_issued`
   - 새 prompt authority를 발급한다.
   - 같은 session의 이전 binding을 같은 transaction에서 supersede한다.
   - 이전 binding에서 열린·sealed·waiting·staged 상태인 decision boundary도 같은 batch에서
     terminal supersede하고, restart projection이 오래된 Pet 카드를 복원하지 못하게 한다.
2. `decision_proposal_claimed`
   - `prompt_binding_id`, `proposal_id`, token을 제거한 canonical proposal digest를 담는다.
   - boundary opened/sealed 및 packet document와 같은 journal batch로 기록한다.

한 prompt에서 후속 boundary가 둘 이상 생길 수 있으므로 prompt 전체를 consumed로 만드는
이벤트는 추가하지 않는다. exact-once 단위는
`prompt_binding_id + proposal_id + canonical digest`다. 같은 proposal ID가 다른 binding이나
digest와 결합되면 conflict로 거부한다.

## 인증과 재생 방지

- 최초 binding ID는 256-bit CSPRNG로 생성한다.
- `(project_id, session_id, source_turn_id)`를 unique key로 삼는다. prompt HMAC과 origin까지
  포함한 canonical issue 입력은 별도 domain key의 `issue_idempotency_hmac`으로 저장한다.
  같은 turn의 재시도는 이 HMAC이 같을 때만 기존 binding을 반환하고, 다르면 conflict다.
- 새 binding은 현재 `key_version`을 고정하고, prompt·issue·token issuance·token verification에
  서로 다른 domain-separated subkey를 사용한다.
- correlation token은 stable binding ID와 key version을 입력으로 한 domain-separated
  HMAC-SHA256에서 결정론적으로 파생한다. 따라서 commit 뒤 Hook 응답이 유실돼도 같은
  binding을 조회해 같은 token을 다시 만들 수 있다.
- 검증용 `correlation_token_hmac`은 issuance key와 분리한 key로 계산한다.
- HMAC canonical 입력은 `correlation_token_hmac`, `prompt_hmac_sha256`,
  `issue_idempotency_hmac` 같은 파생 필드를 제외한 immutable binding fields로 정의한다.
  token 검증 HMAC에만 제출된 원본 token을 추가하고 constant-time으로 비교한다.
- 새 발급은 현재 key version만 사용한다. 재시도는 먼저 unique
  `(project_id, session_id, source_turn_id)`로 기존 binding을 찾고, 그 binding에 저장된
  key version으로 prompt·issue HMAC과 token을 다시 계산한다. 구 key는 최대 TTL과 허용된
  clock-skew 기간이 끝날 때까지 보존하며, 필요한 key가 없으면 새 authority를 발급하지 않고
  실패 폐쇄한다.
- 기본 TTL은 24시간이다. 인증된 freshness anchor에 마지막 확인 wall time과 key version을
  저장하고, 재시작 뒤 현재 시간이 anchor보다 허용 clock-skew 5분을 초과해 뒤로 갔거나
  anchor 검증·rollback 탐지가 실패하면 모든 persisted binding을 실패 폐쇄한다.
- prompt·issue·token MAC 비교는 성공·실패 모두 constant-time digest comparison을 사용한다.
- 만료되었거나 다른 session·turn·prompt·episode인 요청은 실패 폐쇄한다.
- 새 사용자 prompt는 같은 session의 이전 binding을 즉시 supersede한다.
- 같은 binding·proposal ID·digest의 재시도는 기존 acceptance를 반환한다. binding이나
  digest가 하나라도 다르면 `proposal_id_conflict`로 거부한다.
- raw token은 log, snapshot, packet, proposal document와 error에 포함하지 않는다.

## Crash boundaries

- binding commit 전 crash: authority가 생기지 않는다.
- commit 후 Hook 응답 전 crash: 동일 issue idempotency HMAC의 Hook 재시도는 저장된 binding
  ID와 key version으로 같은 token을 재생성한다.
- Hook이 token을 받은 뒤 daemon restart: 저장된 HMAC으로 정확한 wrapper만 검증한다.
- proposal batch 응답 유실: 재시도는 기존 acceptance를 반환하고 두 번째 boundary를
  만들지 않는다.
- 새 prompt와 구 proposal의 경쟁은 비대칭이다. 새 prompt가 먼저 commit되면 구 proposal은
  superseded로 거부한다. 구 proposal이 먼저 commit되면 새 prompt는 CAS를 재시도해 반드시
  새 session head가 되고, 구 binding과 그 boundary를 같은 batch에서 terminal supersede한다.
- restart 후 Pet foreground는 자동 복원하지 않는다. 사용자가 다시 명시적으로 연다.

## 구현 순서

1. v1 rotation preflight와 cache 보존 정책을 dogfood에서 검증한다.
2. `Contracts/v2`에 pre-boundary event와 migration 계약을 추가한다.
3. `CoordinatorPromptBindingAuthorityPort`를 추가한다.
4. v1 reader를 보존하는 v2 journal migration을 구현한다.
5. `userPromptSubmit`의 durable issue와 `emitDecision`의 durable verify/claim을 연결한다.
6. 구 MCP → 새 service 실제 왕복, response-loss, replay와 raw-token 부재를 검증한다.

## 완료 기준

- 활성 구 MCP가 있으면 service·Plugin·cache가 변경되지 않는다.
- `UserPromptSubmit → daemon restart → emit_decision`이 정확히 한 번 성공한다.
- 잘못되거나 superseded·expired된 binding은 journal write 없이 거부된다.
- proposal, boundary, packet이 response-loss 재시도에도 각각 하나만 기록된다.
- DB와 log에서 raw correlation token이 발견되지 않는다.
- 일반 `codex`, `/resume`, native permission UI와 Hook 없는 사용은 변하지 않는다.
