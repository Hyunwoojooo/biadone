# ADR-0003: same-UID UDS, runtime identity, 요청 allowlist를 결합

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: 로컬 Plugin/Pet/Coordinator 사이 transport admission과 호환성 경계
- Evidence maturity: 구현/소스와 자동 transport 자격 존재; same-UID 악성 프로세스까지 막는 완전한 신뢰 경계는 아님

## Context

Plugin, Pet, Doctor, 관리형 승인 adapter는 로컬 Coordinator에 요청을 보낸다. 파일 권한과 같은 사용자 UID만 확인하면 다른 로컬 사용자와는 격리할 수 있지만, 오래되었거나 바뀐 Blabee 바이너리와 같은 UID의 비협조 프로세스를 충분히 구분하지 못한다. 반대로 서명 identity만 확인하고 socket·peer·operation을 제한하지 않아도 안전하지 않다.

## Decision drivers

- 네트워크 포트를 열지 않고 로컬 사용자 범위에 한정한다.
- 단일 Coordinator owner와 안전한 stale socket 회수를 보장한다.
- 요청 크기·동시성·operation surface를 제한한다.
- 패키지 빌드 identity와 wire 요청을 연결한다.
- 롤링 업데이트 중 허용한 이전 client의 권한을 최소화한다.

## Considered options

원래 토론 기록은 확인되지 않았다. 아래는 구현과 설계에서 재구성한 선택지다.

1. owner-only Unix domain socket + peer UID + signed runtime identity + operation allowlist.
2. localhost TCP 또는 인증 없는 local socket.
3. 파일 mode와 same-UID만 신뢰하고 빌드 identity를 검사하지 않음.
4. 모든 이전 client에 현재 operation 전체를 허용.

## Decision

Coordinator transport에 다음 방어를 함께 적용한다.

- runtime directory는 `0700`, socket과 owner lease는 `0600`으로 제한한다.
- 연결 peer의 effective UID가 현재 사용자와 같아야 한다.
- 요청은 1 MiB 미만의 단일 JSON line이며 동시 admission은 64개다.
- wire type은 `blabee.runtime-identity.v1/` namespace를 사용하고 요청·응답 runtime identity를 대조한다.
- 현재 runtime identity에만 전체 allowlist를 허용한다.
- 서명된 assembly manifest가 명시한 제한된 이전 identity에는 lifecycle 네 operation만 허용한다.
- public UDS surface는 열거된 고수준 operation으로 제한한다.

## Consequences

긍정적 결과:

- 다른 UID와 임의 네트워크 client를 기본적으로 배제한다.
- 낡거나 혼합된 client/server가 mutation 전에 거부된다.
- request type과 제품 build 호환성을 하나의 admission 경계에서 확인한다.

비용과 제약:

- runtime identity는 서명된 앱/manifest 조립과 배포 절차에 의존한다.
- same-UID는 사용자 계정 안의 모든 프로세스를 신뢰한다는 뜻이 아니다.
- 같은 inode를 다른 path identity가 가리키는 특수 경로와 같은 UID 공격자는 잔여 위험이다.
- 정적 Doctor 통과만으로 실행 중 daemon identity나 설치 보안을 증명하지 않는다.

## Evidence

- 구현/소스: [UDS allowlist·runtime identity·connection limit](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift#L704-L768), [peer UID·namespace·identity 검증](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift#L912-L975), [socket/lease 소유권과 mode 검사](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift#L1280-L1397).
- 계약: [UDS 및 signed runtime identity 정책](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L114-L135), [인수 기준의 namespace·호환 identity 제한](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L819-L823).
- 제한: [same-UID와 공개 보안 경계의 구분](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L334-L351).

## Supersedes / Superseded by

- Supersedes: UID 또는 socket path 하나만으로 client를 신뢰하는 단순 local transport 모델.
- Superseded by: None known.

## Related views

- [C4 컨테이너](../c4/container.html)
- [Coordinator 컴포넌트](../c4/coordinator-components.html)
- [Hook 권한 요청 시퀀스](../runtime/hook-permission.html)
