# ADR-0006: exact identity 전역 FIFO와 queued-next-turn 전달을 사용

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: Pet 전면 카드 선택, Hook/관리형 권한 요청 순서, 선택된 action의 Codex 전달
- Evidence maturity: routing/dispatcher 소스와 자동 자격 증거 존재; 큐 receipt는 실제 작업 시작·완료의 라이브 증거가 아님

## Context

여러 Codex 세션과 두 권한 transport가 동시에 대기할 수 있다. Pet에서 뒤 요청이 앞 요청을 추월하거나 stale 카드가 선택되면 다른 세션·프로젝트에 잘못된 action이 전달될 수 있다. 또한 과거의 same-turn 이어가기 방식은 현재 응답을 다시 여는 의미와 전달 결과를 혼합했다.

## Decision drivers

- 시스템 전체에서 사람이 보고 선택하는 대상 하나를 명확히 한다.
- transport 종류나 세션에 따른 임의 우선순위를 금지한다.
- project/session/turn/prompt/episode/packet/revision/option을 exact하게 묶는다.
- 사용자가 고른 완전한 action을 같은 Codex 세션의 새 사용자 턴으로 보낸다.
- 선택 claim, queue receipt, 작업 outcome을 분리하고 자동 중복 전송을 막는다.

## Considered options

원래 옵션 기록은 확인되지 않았다. 아래는 코드와 마이그레이션 기록에서 재구성했다.

1. 단일 foreground + immutable identity FIFO + `codex queue` 새 턴 전달.
2. 세션별 카드를 동시에 선택 가능하게 함.
3. Hook 또는 관리형 요청에 고정 우선순위를 부여함.
4. 선택을 같은 assistant turn의 Stop 재개로 전달함.
5. 숫자 `1`~`4`만 Codex에 보내 의미를 다시 추론하게 함.

## Decision

- 결정 카드 queue는 생성 anchor와 immutable binding으로 정렬하고 선두 하나만 foreground가 된다.
- Pet focus와 선택은 현재 선두의 exact identity 전체가 일치할 때만 허용한다.
- Hook PermissionRequest와 관리형 App Server approval은 각 transport binding을 유지하면서 공통 단조 `arrival_sequence`의 전역 FIFO를 사용한다.
- 선택된 `pet_action`은 `queued_next_turn`만 사용한다. 원문 일회성 token은 process-local에서 dispatch 전에 소비한다.
- `codex queue --thread <session> --message <reference envelope>`에는 continuation ID와 cwd에 결속된 참조값을 보낸다. 전체 action 본문은 인증된 journal에 유지한다.
- 정확한 `UserPromptSubmit` 재진입에서 봉인 action을 한 번 claim하고 Hook context에 제공한다. 임의 사용자 입력은 이 참조를 대신하지 않는다.
- exact queue receipt 또는 기대한 queued-prompt digest가 일치하는 재진입으로 transport 완료를 판단한다. 재진입이 receipt보다 먼저 도착할 수도 있으며, 실제 작업 성공은 별도 outcome이다.
- 불명확한 dispatch, timeout 또는 재시작 ambiguity에서는 자동 재전송하지 않는다.

## Consequences

긍정적 결과:

- 다중 세션과 혼합 권한 요청에서 no-steal 순서를 유지한다.
- stale 숫자 입력이나 부분 identity로 다른 action을 실행할 수 없다.
- 전달 인수와 실제 작업 결과를 독립적으로 감사할 수 있다.

비용과 제약:

- 앞 요청이 선택·만료·종료될 때까지 뒤 요청은 노출되지 않는다.
- process-local token/monotonic authority를 잃으면 안전하게 `unknown`으로 닫고 자동 복구하지 못할 수 있다.
- 큐 receipt만으로 실제 Codex 소비, 명령 실행 또는 작업 성공을 주장할 수 없다.
- 실제 사용자 저장소 롤백은 이 FIFO/전달 결정에 포함되지 않으며 공개 완료 기능이 아니다.

## Evidence

- 2026-09-07 대조: [참조 envelope 생성과 기대 digest 기록](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3041-L3066), [exact 재진입을 통한 완료](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L1200-L1217), [journal action claim과 Hook context 복원](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3542-L3657). 과거 계약의 `<structured action>` 표현보다 이 커밋의 실제 전달 코드를 우선한다.

- 구현/소스: [exact foreground와 selection binding](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorRoutingApplication.swift#L491-L620), [Hook/관리형 요청의 공통 global head 계산과 downstream 증거 분리](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L2545-L2567), [`codex queue` 호출과 strict receipt parsing](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift#L218-L299).
- 계약: [FIFO와 Native/관리형 공통 arrival sequence](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L41-L45), [queued-next-turn, 일회성 token, 자동 재전송 금지](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L144-L174), [receipt와 outcome의 분리](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L195-L218).
- 자동 자격 및 비범위: [운영/timeout 테스트 소유와 완전 롤백 비범위](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L588-L613).

## Supersedes / Superseded by

- Supersedes: 신규 전달에서의 `same_turn_stop` 방식. 과거 event는 replay 호환 목적으로만 남는다.
- Superseded by: None known.

## Related views

- [결정 연속 진행 시퀀스](../runtime/decision-continuation.html)
- [Hook 권한 요청 시퀀스](../runtime/hook-permission.html)
- [관리형 승인 시퀀스](../runtime/managed-approval.html)
- [결정 경계 수명 주기](../runtime/decision-boundary.html)
