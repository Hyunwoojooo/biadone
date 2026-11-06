# ADR-0004: 외부 키 인증 SQLite journal과 Keychain freshness를 사용

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: 결정 이벤트, packet/verification sidecar, 재시작 복구와 과거 DB 복원 탐지
- Evidence maturity: persistence/freshness 소스와 자동 자격 증거 존재; signed Data Protection Keychain·same-UID 공격 방어·운영 복구는 열린 게이트

## Context

Blabee의 결정과 전달 상태는 프로세스 재시작 뒤에도 재생돼야 한다. 단순 SQLite 영속화만으로는 DB 행의 교체·삭제, sidecar 바인딩 손상, 과거의 정상 DB snapshot 복원을 구분하기 어렵다. DB와 동일 위치에 키를 넣는 것만으로도 freshness 권위가 독립되지 않는다.

## Decision drivers

- 이벤트 batch와 packet/verification sidecar를 원자적으로 저장한다.
- 손상, 행 삭제·교체, orphan/missing sidecar를 재생 전에 탐지한다.
- 프로세스 간 expected-sequence CAS와 crash ambiguity를 명시적으로 처리한다.
- 인증된 과거 DB snapshot으로의 복원을 fail-closed한다.
- 원문 continuation/correlation secret을 영속 데이터에 남기지 않는다.

## Considered options

원래 옵션 표는 확인되지 않았다. 아래는 현재 설계와 구현에서 재구성했다.

1. SQLite WAL + 외부 32-byte 키의 MAC/HMAC + Keychain freshness checkpoint.
2. 인증 없는 SQLite event log.
3. DB 내부에만 key/head checkpoint를 보관.
4. 파일 기반 append log 또는 메모리 전용 상태.

## Decision

로컬 journal은 SQLite를 사용하되 별도의 인증·freshness 경계를 둔다.

- SQLite는 WAL, `synchronous=FULL`, foreign key를 요구한다.
- runtime event는 이전 MAC과 sequence/row identity를 잇는 MAC chain으로 보호한다.
- packet document와 verification sidecar는 SQLite 밖의 32-byte 키로 exact row binding을 HMAC 인증한다.
- append는 `BEGIN IMMEDIATE`, expected sequence, sidecar 원자성, 중복·선택·queued-action claim 불변식을 함께 확인한다.
- Keychain에는 `initializing`/`pending`/`committed` freshness record와 DB identity, generation, sequence, head를 저장하고 digest CAS를 사용한다.
- `pending + target DB`는 전체 authenticated replay 뒤에만 finalize한다. `pending + source DB`는 exact canonical batch 재시도 외에는 자동 진행하거나 취소하지 않는다.

## Consequences

긍정적 결과:

- 정상 SQLite snapshot이라도 freshness checkpoint보다 오래되면 차단할 수 있다.
- commit 전후 crash와 응답 유실을 구분해 재조정할 수 있다.
- sidecar와 event의 바인딩 손상을 startup/replay 단계에서 fail-closed한다.

비용과 제약:

- SQLite, 외부 key file, Keychain anchor의 수명 주기를 함께 관리해야 한다.
- 현재 unsigned CLI는 legacy login Keychain을 사용한다. signed Data Protection Keychain/access group 자격은 별도다.
- 같은 UID가 Keychain item을 삭제·교체하거나 DB·키·anchor를 함께 제거하는 공격은 이 결정만으로 완전히 구분하지 못한다.
- exact batch가 없는 `pending + source DB`는 운영자 복구가 필요하다.

## Evidence

- 구현/소스: [journal append, MAC head, freshness pending/commit/replay](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/SQLiteJournal.swift#L278-L445), [WAL/FULL/foreign-key 설정](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/SQLiteJournal.swift#L628-L670), [Keychain load/create/CAS](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/KeychainFreshnessAnchorStore.swift#L5-L100).
- 계약: [저장 대상, 외부 키 인증, freshness 순서와 crash 처리](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L733-L770).
- 자동 자격 및 제한: [persistence 테스트 소유 불변식](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L588-L600), [구현·자동 자격과 설치형 Keychain 잔여 게이트](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L856-L860).

## Supersedes / Superseded by

- Supersedes: 인증되지 않은 local journal 또는 DB 내부 checkpoint만을 권위로 삼는 모델.
- Superseded by: None known.

## Related views

- [C4 컨테이너](../c4/container.html)
- [Coordinator 컴포넌트](../c4/coordinator-components.html)
- [결정 경계 수명 주기](../runtime/decision-boundary.html)
