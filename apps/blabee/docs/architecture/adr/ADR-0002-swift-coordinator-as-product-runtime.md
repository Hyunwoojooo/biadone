# ADR-0002: Swift Coordinator를 제품 런타임으로 사용

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: 제품 Coordinator의 언어·프로세스 경계와 계층 책임
- Evidence maturity: Swift 제품 코드와 자동 자격 증거 존재; 설치된 제품 daemon과 장시간 운영 자격은 별도 게이트

## Context

Blabee에는 계약 의미를 빠르게 검증하는 런타임 중립 참조 구현과, macOS Pet·Keychain·UDS·SQLite를 결합하는 제품 런타임이 모두 필요했다. 제품 경계는 저수준 journal append를 외부에 노출하지 않고, 의미·라우팅·운영 adapter를 거쳐야 한다.

## Decision drivers

- macOS의 Security, Keychain, AppKit/SwiftUI, UDS와 직접 통합한다.
- 하나의 제품 프로세스에서 Coordinator와 Pet/service 진입점을 조립한다.
- 계약 참조 구현과 제품 권위 런타임을 구분한다.
- 저수준 persistence를 외부 transport에서 직접 호출하지 못하게 한다.
- exact binding, 재생, CAS, deadline, 복구 정책을 한 제품 경계에서 시행한다.

## Considered options

원래 전체 점수표는 보존돼 있지 않다. 아래 선택지는 T-005 결과와 남은 코드에서 재구성했다.

1. Swift 네이티브 helper를 제품 Coordinator로 사용한다.
2. Node ESM 참조 코어를 그대로 제품 Coordinator로 승격한다.
3. C health 기준선을 제품 Coordinator로 확장한다.
4. Coordinator 권위를 Plugin 또는 Pet UI 안에 분산한다.

## Decision

Swift Package의 `CoordinatorSwift`/`BlabeeCoordinator`를 제품 Coordinator 런타임으로 사용한다.

- persistence kernel, semantic application, routing/time, operational application을 계층화한다.
- 운영 UDS는 `CoordinatorOperationalApplication`의 고수준 operation만 노출한다.
- Node 구현은 계약 참조와 빠른 검증 자산으로 유지한다.
- C 구현은 health/performance 기준선으로만 본다.
- journal append, direct semantic selection, token consume 같은 저수준 operation은 제품 외부 API가 아니다.

## Consequences

긍정적 결과:

- macOS 제품 기능과 보안 primitive를 한 toolchain에서 결합할 수 있다.
- 도메인/의미 계층과 OS adapter의 의존 방향을 분리할 수 있다.
- persistence와 routing 권위를 외부 Plugin/Pet에서 중앙화한다.

비용과 제약:

- Swift 제품 구현과 JavaScript 참조 구현 간 의미 동등성을 계속 검증해야 한다.
- 단위·통합 테스트 통과는 로그인 service, 실제 Keychain, WindowServer와 장시간 sleep 동작을 증명하지 않는다.
- Coordinator 단일 프로세스의 availability가 Blabee 기능에 영향을 주지만 기본 Codex 실행을 막아서는 안 된다.

## Evidence

- 결정 기록: [T-005의 Swift 제품 런타임 선택](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L852-L854), [제품 계층별 구현·자동 자격 요약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L856-L860).
- 구현/소스: [고수준 operational dispatch와 제한된 operation](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L537-L637), [제품 소스 구조와 계층 책임](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L150-L240).
- 제한: [실제 사용자 작업공간·제품 daemon·WindowServer·장시간 운영의 열린 게이트](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L858-L860).

## Supersedes / Superseded by

- Supersedes: Node/C 후보를 제품 Coordinator로 취급하는 초기 탐색 상태.
- Superseded by: None known.

## Related views

- [C4 컨테이너](../c4/container.html)
- [Coordinator 컴포넌트](../c4/coordinator-components.html)
- [결정 경계 수명 주기](../runtime/decision-boundary.html)
