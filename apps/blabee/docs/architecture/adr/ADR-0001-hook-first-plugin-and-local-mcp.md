# ADR-0001: Hook-first Plugin과 로컬 MCP를 기본 Codex 통합 경계로 사용

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · `a352baa773e11a9be96c9d5b5aafca19aa5fb543` (커밋된 소스 기준)
- Original decision date: Unknown
- Scope: Codex 턴 수명 주기, 결정 제안 제출, 권한 요청 관찰의 기본 진입 경계
- Evidence maturity: 구현/소스 확인; Plugin 설치·수명 주기 자동 자격 일부 확인; 사용자 설치본 Hook 신뢰와 자동 시작은 미확인

## Context

Blabee는 Codex의 작업 경계를 관찰하고, Codex가 생성한 구조화된 다음 선택을 로컬 Coordinator와 Pet으로 전달해야 한다. 이 통합은 특정 터미널 UI 자동화나 최종 답변 자연어 파싱에 의존하지 않아야 하며, 별도 LLM 추론 서비스도 추가하지 않는다.

현재 Plugin은 네 종류의 Hook과 로컬 MCP 설정을 함께 패키징한다. 현재 As-Is Hook 목록에는 PreToolUse/PostToolUse가 없다.

## Decision drivers

- Codex가 제공하는 확장 지점 안에서 세션·프롬프트·종료·권한 요청 경계를 받는다.
- 사람이 읽는 최종 답변과 기계가 읽는 구조화된 결정 제안을 분리한다.
- 터미널 호스트, OCR, 합성 키 입력에 대한 결합을 피한다.
- app-server를 기본 Hook 루프의 숨은 의존성으로 만들지 않는다.
- Blabee 고장 시 네이티브 Codex 흐름을 보존한다.

## Considered options

원래 옵션 평가표와 결정 회의 기록은 확인되지 않았다. 아래 항목은 남아 있는 설계·소스에서 재구성했다.

1. Codex Plugin의 수명 주기 Hook + 로컬 MCP 보조 채널.
2. 최종 assistant 메시지를 파싱하거나 센티널로 사용하는 방식.
3. App Server 완전 제어를 기본 통합 경로로 사용하는 방식.
4. 터미널 화면/OCR/AppleScript/합성 키 입력을 핵심 통합 경로로 사용하는 방식.

## Decision

기본 통합 경계는 Codex Plugin으로 한다.

- `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest` Hook은 `scripts/blabee-launcher`를 통해 Coordinator에 연결한다.
- `blabee.emit_decision` 로컬 MCP는 Codex 턴 안에서 구조화된 결정 제안을 제출하는 보조 채널이다.
- 일반 최종 답변은 사람이 읽는 본문으로 유지하고 제안 데이터의 권위 원본으로 파싱하지 않는다.
- Plugin은 제안을 제출하고 결과를 전달하는 adapter이며, 로컬 근거·위험·롤백 가능성의 최종 권위가 아니다.
- PreToolUse/PostToolUse 근거 수집은 이 결정의 현재 구현 범위에 포함하지 않는다.
- App Server는 명시적 관리형 실험 경로로 분리한다(ADR-0007).

## Consequences

긍정적 결과:

- 터미널 종류와 무관하게 Codex 확장 계약을 재사용한다.
- 결정 제안과 사용자용 답변의 책임이 분리된다.
- 기본 경로가 App Server 가용성에 종속되지 않는다.

비용과 제약:

- Plugin·Hook 설치 및 신뢰 상태를 별도로 진단해야 한다.
- Hook만으로 얻을 수 없는 도구 단위 근거는 현재 수집하지 않는다.
- Hook 성공, Coordinator 처리, Pet 표시, 사용자 선택, 실제 후속 작업 완료를 각각 검증해야 한다.

## Evidence

- 구현/소스: [현재 네 Hook 정의](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/Plugin/blabee/hooks/hooks.json#L1-L56), [로컬 MCP launcher 설정](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/Plugin/blabee/.mcp.json#L1-L14), [Coordinator의 고수준 요청 surface](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L537-L637).
- 범위 명시: [TECH_SPEC의 T-011 Plugin 경계와 Pre/PostToolUse 제외](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L89-L95), [Hook/MCP 실패 정책과 UDS API](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L102-L146).
- 자동 자격 및 제한: [격리 Plugin 수명 주기 통과와 사용자 Hook 신뢰·자동 시작 미확인](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L844-L850).

## Supersedes / Superseded by

- Supersedes: M0의 임시 최종 메시지 센티널 기반 전달(운영 경로에 한함).
- Superseded by: None known.

## Related views

- [C4 시스템 컨텍스트](../c4/system-context.html)
- [C4 컨테이너](../c4/container.html)
- [결정 연속 진행 시퀀스](../runtime/decision-continuation.html)
- [Hook 권한 요청 시퀀스](../runtime/hook-permission.html)
