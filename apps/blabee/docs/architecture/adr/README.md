# Blabee Architecture Decision Records

이 디렉터리는 2026-09-05에 소스와 프로젝트 기록을 기준으로 복원한 회고형 ADR 모음이다. 2026-09-07에는 커밋 [`a352baa773e11a9be96c9d5b5aafca19aa5fb543`](https://github.com/Hyunwoojooo/biadone/commit/a352baa773e11a9be96c9d5b5aafca19aa5fb543)의 변경 영향을 대조하고 ADR-0006/0007/0008의 구현·증거 설명을 갱신했다. 원래 `Recorded` 날짜와 결정 의도는 보존하며, 작업 트리의 미커밋 변경은 포함하지 않는다.

각 문서의 `Accepted (Retrospective)`는 기록한 소스가 해당 결정을 따른다는 뜻이지, 원래 결정 시점과 토론 기록이 완전하게 보존돼 있다는 뜻은 아니다. 전체 스냅샷 범위와 갱신 이력은 [EVIDENCE.md](../EVIDENCE.md)를 따른다.

## 상태 읽는 법

- **구현/소스**: 현재 저장소에서 구조 또는 정책을 직접 확인했다.
- **자동 자격**: 테스트·정적 검사·격리 dogfood 보고서가 존재한다. 실행 중인 설치본의 동작과는 구분한다.
- **설치/라이브**: 실제 설치 앱, 로그인 서비스, 사용자 Hook 신뢰, 실제 Codex/App Server 또는 운영 작업공간에서 확인한 상태다. 문서에 완료라고 명시되지 않은 항목은 열린 게이트다.

## 결정 목록

| ADR | 결정 | 현재 범위 |
|---|---|---|
| [ADR-0001](ADR-0001-hook-first-plugin-and-local-mcp.md) | Hook-first Plugin과 로컬 MCP를 기본 통합 경계로 사용 | 구현됨; Pre/PostToolUse 제외, 사용자 Hook 신뢰는 별도 게이트 |
| [ADR-0002](ADR-0002-swift-coordinator-as-product-runtime.md) | Swift Coordinator를 제품 런타임으로 사용 | 구현 및 자동 자격; 실제 설치 환경 자격은 별도 |
| [ADR-0003](ADR-0003-same-uid-uds-and-runtime-identity.md) | same-UID UDS, runtime identity, 요청 allowlist를 함께 적용 | 구현 및 자동 자격; same-UID 전체 신뢰는 아님 |
| [ADR-0004](ADR-0004-authenticated-sqlite-journal.md) | 외부 키 인증 SQLite journal과 Keychain freshness를 사용 | 구현 및 자동 자격; signed Data Protection Keychain은 미완료 |
| [ADR-0005](ADR-0005-native-codex-preservation.md) | Native Codex Preservation과 비대칭 실패 정책을 불변 조건으로 둠 | 기본 Hook은 fail-open, MCP/관리형 경계는 fail-closed |
| [ADR-0006](ADR-0006-global-fifo-and-queued-next-turn.md) | exact identity 전역 FIFO와 queued-next-turn 전달을 사용 | 구현 및 자동 자격; 큐 접수와 작업 성공은 별도 증거 |
| [ADR-0007](ADR-0007-opt-in-managed-codex-app-server.md) | App Server 경로를 명시적 opt-in 실험으로 격리 | 소스/자동 자격 진행; 설치본 라이브 경로 미완료 |
| [ADR-0008](ADR-0008-bundled-macos-app-and-service.md) | 앱 번들에 Coordinator, Plugin, 계약, 정적 서비스 계약을 패키징 | fresh arm64 내부 DMG와 제한된 r8 설치·서비스 기록; clean Mac·Hook/Pet·공개 배포 미완료 |

## 공통 해석 규칙

- 현재 Hook 구현은 `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest` 네 종류다. Pre/PostToolUse는 As-Is 범위가 아니다.
- 실제 사용자 저장소 롤백은 공개 기능으로 완료된 것으로 보지 않는다.
- Pet receipt, Hook/MCP/App Server 응답 write, downstream 소비, 실제 명령 완료는 서로 다른 증거다.
- ad-hoc 서명과 로컬 번들 조립 통과는 Developer ID 서명, 공증, Gatekeeper 또는 설치형 라이브 자격을 뜻하지 않는다.
- r8의 한 개발 Mac 설치·서비스 복구 기록은 해당 날짜의 제한된 `LIVE`다. 2026-09-07 문서 재검증이 자동 시험이나 설치본 왕복의 재실행을 뜻하지 않는다.

상위 설명과 뷰 인덱스는 [arc42-lite 문서](../README.md)를 따른다.
