# ADR-0005: Native Codex Preservation과 비대칭 실패 정책을 불변 조건으로 둠

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: 기본 Codex 명령, Hook/MCP failure semantics, 명시적 관리형 실행의 fallback 경계
- Evidence maturity: 정책과 launcher/관리형 소스 구현 확인; 자동 자격 자산 존재; 깨끗한 다른 Mac의 설치부터 실사용까지는 미완료

## Context

Blabee는 Codex에 추가 기능을 제공하지만, Blabee 자체 장애가 사용자의 기존 Codex 작업을 가로막거나 명령 의미를 바꾸면 안 된다. 동시에 구조화된 제안 제출이나 관리형 권한 중계처럼 Blabee가 권위를 주장하는 경계에서는 오류를 성공으로 숨겨서도 안 된다.

## Decision drivers

- Blabee 설치 여부와 무관하게 기본 `codex` 명령의 의미를 보존한다.
- Hook 보조 기능의 장애가 Codex 수명 주기를 막지 않게 한다.
- MCP write 실패를 성공한 제안 제출로 오인하지 않는다.
- 관리형 자식의 중복 실행 가능성을 차단한다.
- 사용자 opt-in 없이 PATH, shell startup, official Codex를 바꾸지 않는다.

## Considered options

원래 대안 기록은 완전하지 않다. 아래는 현재 문서와 제거된 구형 경로에서 재구성했다.

1. 기본 native 경로를 그대로 두고 Hook만 fail-open, MCP/관리형 경계를 fail-closed한다.
2. 모든 `codex` 호출을 Blabee wrapper로 강제한다.
3. 모든 통합 실패를 fail-open해 MCP/관리형 결과도 성공처럼 처리한다.
4. 모든 통합 실패를 fail-closed해 기본 Codex까지 차단한다.

## Decision

`Native Codex Preservation`을 제품 불변 조건으로 둔다.

- 기본 `codex`, `resume`, `fork`, `exec`, `plugin`, 프롬프트와 명시적 `--remote`는 공식 native Codex 경로를 유지한다.
- Hook launcher는 setup, process, transport, timeout, 부분 출력, cleanup 실패를 빈 stdout/stderr와 성공 종료로 수렴시켜 Codex가 원래 흐름을 계속하게 한다. 자동 동작은 수행하지 않는다.
- 로컬 MCP는 제안 write 실패를 JSON-RPC 오류로 반환하는 fail-closed 채널이다.
- 명시적 `blabee-codex`는 syntax, executable, trust, allowlist 자격 실패를 fail-closed한다.
- 관리형 fallback은 검증된 private bundle이 있고 첫 자식 시작 전 준비 실패인 경우에만 정확히 한 번 허용한다. 자식 시작 뒤에는 자동 native 재실행을 금지한다.

## Consequences

긍정적 결과:

- Blabee 장애가 기본 Codex 사용의 단일 실패점이 되지 않는다.
- 제안 제출과 관리형 권한의 성공 여부는 모호하게 통과되지 않는다.
- 자식 시작 뒤 장애에서 동일 작업의 중복 실행을 피한다.

비용과 제약:

- Hook과 MCP가 같은 오류에 서로 다른 결과를 내므로 운영·QA에서 경계를 분리해야 한다.
- Hook fail-open은 Blabee 기능이 조용히 비활성화될 수 있으므로 Doctor와 가시적인 상태 표시가 필요하다.
- 관리형 mode는 기본 경로보다 좁고 엄격하며, 자동 fallback이 대부분 허용되지 않는다.
- 이 결정은 실제 명령 성공을 보증하지 않고 네이티브 실행 의미와 중복 방지를 보존한다.

## Evidence

- 결정 계약: [Native Codex Preservation과 관리형 비대칭 경계](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L26-L45), [기본 native와 opt-in 관리형 실행 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L635-L677).
- 구현/소스: [Hook 실패를 silent success로 수렴하는 launcher](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/Plugin/blabee/scripts/blabee-launcher#L116-L203), [관리형 신뢰 원칙과 native 미변경](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L7-L16), [pre-child only fallback](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L53-L84).
- 자동 자격과 라이브 게이트: [T-011 fail-open 등 테스트 소유 범위](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L588-L603), [다른 Mac 설치·첫 Pet·관리형 승인은 단위 테스트로 완료 처리하지 않음](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L138-L150).

## Supersedes / Superseded by

- Supersedes: shell marker, stable launcher, 자동 연결 등 제거된 강제 중계 경로.
- Superseded by: None known.

## Related views

- [C4 시스템 컨텍스트](../c4/system-context.html)
- [Hook 권한 요청 시퀀스](../runtime/hook-permission.html)
- [관리형 승인 시퀀스](../runtime/managed-approval.html)
