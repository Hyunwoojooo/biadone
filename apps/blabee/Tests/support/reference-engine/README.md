# Coordinator Core

T-007a의 런타임 중립 ESM 코어다. `decide(state, command)`는 외부 상태를
바꾸지 않고 v1 runtime event와 원자 배치에 필요한 불변 자료만 반환한다.
`replay(events, artifacts)`가 유일한 상태 projection 경로다.

외부에서 들어오거나 영속 저장소에서 읽는 v1 event, document, request는
command 처리 전에 strict JSON Schema 검증을 마쳤다는 것이 이 코어의 전제다.
코어는 action/option 식별자 유일성, baseline checkpoint 결합, rollback 정책,
같은 turn의 prompt/checkpoint lineage 등 중요한 의미 규칙과 상태 전이를 다시
fail-closed로 검사하지만 범용 JSON Schema validator를 내장하지 않는다.
T-007b-A의 `src/coordinator-swift/` 어댑터는 persistence 입구의 4개 v1 계약
타입에 strict 검증과 contract hash pin을 적용한다. T-007a에서는 rollback
실행이 지원되지 않으므로 slot 4가 enabled인 packet 자체를 거부한다.

저널 포트의 논리적 쓰기 단위는 다음 호출 하나다.

```js
append(expectedSequence, events, { documents, verificationRecords })
```

- `expectedSequence`는 optimistic CAS다.
- `documents`는 `decision_packet_sealed`와 같은 배치에 저장하는 원문 v1
  DecisionPacket이다. 이벤트에 없는 option/action 조회만 담당한다.
- `verificationRecords`는 `decision_selection_claimed`와
  `continuation_dispatched` 두 이벤트와 같은 배치에 저장하는 내부 버전
  레코드다. 전체 dispatch binding과 token fingerprint만 가지며 원문 token과
  action body는 저장하지 않는다.
- lifecycle, claim, repair, transport, work outcome의 진실 원본은 계속 v1
  runtime event다. 두 sidecar는 스키마가 생략한 봉인 본문과 검증 자료다.

`InMemoryJournal`은 이 원자 계약의 reference adapter일 뿐 durable storage,
SQLite, 프로세스 간 잠금, 실제 IPC를 제공하지 않는다. T-007b-A Swift
어댑터는 같은 포트를 SQLite `BEGIN IMMEDIATE` 트랜잭션과 expected-sequence
CAS로 구현했다.

`InMemoryJournal` 내부의 in-process 상태는 외부에 immutable snapshot으로만
노출되지만, constructor와 `load()`를 통해 재시작 시 들어오는 event/document/
verification artifact는 신뢰된 storage-port 입력이라는 전제다. T-007a는 해당
artifact의 변조 증거를 제공하지 않는다. T-007b-A는 SQLite 외부의 32-byte
키로 runtime event MAC chain·인증된 head anchor와 packet/verification row-bound
HMAC을 구현했다. exact packet/seal/selection/action/verification binding,
손상·교체·행 삭제·orphan/missing artifact는 fail-closed한다.

T-007b-A2는 이 파일 집합 외부의 OS Keychain에 strict `initializing`/`committed`/
`pending` freshness record와 불변 DB identity·generation·sequence·head를
저장한다. digest CAS와 process mutex·`0600` `flock`을 append 전이에 결합해
과거 authentic DB snapshot, DB·키 loss와 anchor 누락을 event 반환 전에
fail-closed한다. `pending + source DB`는 exact canonical batch 재시도 외에는
자동 복구하지 않고, 기존 DB·키에 anchor가 없는 pre-A2 상태도 자동
migration/adoption하지 않는다.

현재 unsigned CLI는 entitlement 부재로 legacy login Keychain을 사용한다.
signed Data Protection Keychain/access group·`LAContext`, same-UID anchor
삭제·교체, DB·키·anchor 동시 제거와 일반 운영자 복구·키 회전은 T-012 또는
후속 보안 범위다.

외부 런타임은 `executeCommand(journal, command)`를 사용한다. 이 서비스가
필요한 일회성 token을 내부에서 만들고 CAS commit에 성공한 뒤에만 envelope
effect를 반환한다. 충돌에서 진 command의 token/effect는 외부에 노출되지
않는다. `decide`는 결정론 테스트와 어댑터 구현을 위한 낮은 수준의 순수
함수이며, 그 결과의 effect를 commit 전에 전달해서는 안 된다.

T-007b-A/A2는 영속·freshness 커널, B1은 Swift lifecycle
command/reducer와 latest revision·stale·expiry·rollback-disabled·reseal 의미,
B2는 세션 대기열·명시적 전면 카드와 연속 단조 deadline 범위의 조건부 완료다.
제품 NDJSON은 B1/B2 경계를 거쳐야 하며 raw `append`는 compile-time 테스트
하네스에만 존재한다. T-007b-C는 실제 Hook 반복과 제품 same-turn 경계 1→2를
분리된 게이트로 검증했다. T-011의 Hook→Swift adapter가 완성되기 전에는
Hook·Pet·비신뢰 IPC에 대한 공개 dispatch를 활성화하지 않는다.
