# Managed Codex Semantic Timeline Contract

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Phase 2B.2A local beta · 관찰 전용 |
| 기준일 | 2026-08-01 |
| 입력 | hash-verified `codex-managed-event-history-v1` + 동일 revision의 public run projection |
| timeline | `codex-managed-semantic-timeline-v0.1` |
| detector | `codex-managed-direct-event-detector-v0.1` |
| Attention 사용 | 금지 |

## 1. 목적

Phase 2B.2A는 Blabase가 직접 관리하는 Codex run의 ordered metadata를 사용해
사용자가 눈으로 확인할 수 있는 실행 timeline을 만든다. 이 버전은 **직접
관찰한 실행 사실**과 **사용자 task/outcome의 실제 진전**을 분리한다.

```text
managed ordered event history
→ private 값을 제거한 semantic window
→ direct-fact timeline
→ 최신 turn/managed-run 상태 해석
→ Work Cockpit 관찰 UI

Attention input / candidate / ranking
→ 연결하지 않음
```

Codex turn이 완료됐다는 사실은 말할 수 있지만, 연결된 제품 작업이 끝났거나
이번 주 outcome에 가까워졌다고 말하지 않는다.

## 2. 버전과 재현성

- window contract: `codex-managed-semantic-window-v0.1`
- timeline contract: `codex-managed-semantic-timeline-v0.1`
- detector result: `codex-managed-semantic-detector-result-v0.1`
- run result: `codex-managed-semantic-run-result-v0.1`
- projection: `codex-managed-semantic-projection-v0.1`
- schema: `codex-managed-semantic-schema-v0.1`
- rule: `codex-managed-direct-event-detector-v0.1`
- evidence policy: `codex-managed-direct-metadata-evidence-v0.1`

window는 전체 sanitized input digest와 bounded public window hash를 분리하고,
timeline, detector, run result와 projection도 각각 canonical SHA-256을 가진다.
schema read 시 public hash와 revision/identity coherence를 검증한다. event
ordering authority는 wall clock이 아니라 persisted sequence다. `observedAt`이
역행하면 순서를 바꾸지 않고 `clockQuality=regressed`로 기록한다.

## 3. 판정 가능한 사실

| 입력 event | 이 버전이 말하는 사실 | 말하지 않는 것 |
|---|---|---|
| `turn_started` | Codex turn 시작을 직접 관찰 | task 진전, 정상 범위 수행 |
| `item_started/completed` | sanitized item category 활동을 직접 관찰 | command 성공, diff 적용, test 통과 |
| `turn_completed: completed` | Codex turn이 completed에 도달 | managed run 종료, 제품 task 완료 |
| `turn_completed: failed` | Codex turn 실패를 직접 관찰 | 실패 원인, 사용자 개입 필요성 |
| `turn_completed: interrupted` | Codex turn 중단을 직접 관찰 | 장애인지 사용자 의도인지 |
| `run_failed` | Blabase managed 실행/transport 실패를 직접 관찰 | Codex turn 자체의 실패 |
| `stream_disconnected/reconnected` | 관찰 연속성의 단절 | Codex 작업 실패·중단·정체 |
| `run_closed` | managed 관찰 run 종료 | 업무 완료 |
| thread `systemError` | thread status를 직접 관찰 | active turn failure |
| waiting flag | 그 시점의 waiting 상태를 직접 관찰 | 안정적인 요청 lifecycle 또는 escalation |

정상 `item_completed(file_change)`도 task-level meaningful progress로 승격하지
않는다. 현재 store에는 적용된 diff, artifact state, command exit/result,
test/build 결과와 expected outcome relation이 없기 때문이다.

## 4. Detector 의미

`assessment`는 다음 관찰 상태만 제공한다.

```text
turn_running | turn_completed | turn_failed | turn_interrupted | thread_idle
managed_run_failed | managed_run_closed | activity_observed
observation_gap | observation_unavailable | insufficient_evidence
```

failure lifecycle은 서로 다른 사실을 분리한다.

- `latest_direct_turn_failure`: retained window의 최신 직접 turn failure
- `latest_direct_managed_run_failure`: managed launch/transport failure
- `superseded_by_newer_turn`: 실패 뒤 새 turn이 관찰됨. **회복 완료를 뜻하지 않음**
- `not_observed_in_retained_window`: 완전한 retained window에서 failure 미관찰
- `unknown`: prefix pruning 또는 continuity gap 때문에 현재 lifecycle 단정 불가

다음 세 verdict는 v0.1에서 의도적으로 고정한다.

- `meaningfulProgress=unknown` — task/outcome 근거 없음
- `stall=not_evaluable` — phase, heartbeat, expected next event와 outcome marker 없음
- `requestEscalation=unsupported` — stable request ID와 pending/resolved lifecycle 없음

정체 시간 임계값은 아직 존재하지 않는다. 조용한 장기 build/test/install을
정체로 오탐하지 않기 위해 임의의 10분·20분 threshold를 적용하지 않는다.

## 5. Gap, pruning과 최신 상태

- reconnect 직후 새 native event가 없으면 `observation_gap`이고 current
  nonterminal state는 `unknown`이다.
- reconnect 뒤 새 notification을 직접 관찰하면 그 notification이 말하는 현재
  상태는 표시할 수 있다. gap 동안의 사건은 복원하거나 추정하지 않는다.
- reconnect 전의 running turn을 reconnect 뒤 current running으로 재사용하지
  않는다.
- retention anchor가 있으면 `historyCompleteness=prefix_pruned`이며 detector
  assessment와 failure lifecycle을 보수적으로 낮춘다. retained direct events는
  timeline evidence로 남는다.
- 과거 failure 뒤 새 turn이 시작되면 과거 failure를 현재 failure로 추천하지
  않지만, 이를 `recovered`라고 부르지도 않는다.

## 6. Public/Privacy 경계

semantic projection은 public run identity와 다음 sanitized metadata만 포함한다.

- local sequence와 observed time
- normalized source event, execution state와 item category
- direct reason code
- content-derived semantic evidence ID
- completeness, continuity와 clock diagnostic

2초 polling 응답은 run별 최근 semantic evidence와 timeline을 각각 최대 24개로
제한한다. 더 오래된 retained evidence는 detector 계산에는 사용하되 API에
반복 전송하지 않고 전체 input SHA-256과 omitted count만 남긴다.

다음 값은 input window, API, UI와 synthetic fixture에 포함하지 않는다.

- native thread/turn/item ID
- owner instance, private scope와 connection/stream generation
- managed event hash chain
- prompt, 답변, reasoning text
- command, output, diff와 file path
- tool arguments/result와 cwd

semantic output은 별도 production store에 저장하지 않고, verified history와
동일한 atomic read snapshot에서 순수 함수로 생성한다. 따라서 source retention
또는 disconnect cleanup 뒤 파생 결과가 별도로 남지 않는다. production event와
UI 반응은 Gold가 아니며 자동으로 평가 dataset에 승격하지 않는다.

## 7. API, UI와 Attention 격리

`GET /api/managed-codex-runs`는 같은 Work Resumption authority lease와 managed
store lock에서 public projection과 semantic projection을 함께 만든다.
`sourceRevision`, `generatedAt`, run/binding/execution identity가 일치하지 않으면
응답을 fail closed한다.

Work Cockpit은 다음을 명시한다.

- 직접 이벤트 해석
- task 진전 판단 불가
- 정체 평가 불가
- 최근 bounded direct timeline
- 관찰 전용이며 추천 우선순위에 반영하지 않음

모든 semantic result는 `attentionDisposition=not_connected`와
`forbiddenAsAttentionCandidate=true`다. 다음 파일/경계에는 semantic projection을
연결하지 않는다.

- Attention input/result schema와 router
- eligibility, lane, ranking과 selection
- Attention replay artifact와 monitor hash
- snapshot revision invalidation

## 8. 평가 계약

기존 `suggestion-cross-source-dev-v0.1` revision 2는 이미 normalized signal을
입력으로 받으므로 수정하지 않는다. raw managed history→semantic detector는
별도 mutable synthetic Dev Candidate로 검증한다.

- dataset: `suggestion-codex-detector-dev-v0.1`
- revision: `1`
- input boundary: `managed_codex_event_history`
- synthetic metadata only
- dataset SHA-256:
  `5436c590c8768b8b2732d675e96b6bd0d837e882dccffbeec67602466e76c838`
- detector config SHA-256:
  `70df024c080ee8b7407273bd7005e2b5ebed9f8cf0c97994b0cf6a28dbeb47a7`

필수 gate:

- completed/failed/interrupted exact 구분
- failure 뒤 새 turn의 현재 failure leakage 0
- reconnect 뒤 stale nonterminal state leakage 0
- `systemError` false failure 0
- stall/request escalation 생성 0
- sequence 기반 deterministic output/hash
- raw/private sentinel 비노출

이 데이터셋은 human-reviewed Golden이 아니며 제품 추천 품질 baseline으로
부르지 않는다.

2026-08-01 첫 targeted Dev Candidate baseline은 18/18 exact match,
latest-direct failure precision/recall 1.0/1.0을 기록했다. superseded failure,
gap stale state, systemError false failure와 unsupported stall/request emission은
모두 0이었다. materialized input SHA-256은
`d161272fe5815e42a7ac9fe30caf2ad45e2189e6acee9cdd5c5d1a0aedcaa747`,
deterministic output SHA-256은
`60292c648f169be965c2da239d4b21315004c730c02455b4042dfacd2f69fd81`이다.

## 9. 후속 evidence

실제 task progress와 verified stall을 만들기 전에 최소한 다음 계약이 필요하다.

- private run-scoped opaque turn/item identity와 lifecycle pairing
- item outcome `succeeded | failed | declined | unknown`
- sanitized command/tool/test/build 결과 category
- stream/thread heartbeat와 monotonic phase duration
- explicit execution↔task/artifact relation
- project workflow와 expected next event
- stable approval/input request ID와 pending/resolved/expired lifecycle

이 evidence, Phase 3 relation과 별도 regression gate가 준비되기 전에는 managed
semantic 결과를 Attention candidate로 승격하지 않는다.
