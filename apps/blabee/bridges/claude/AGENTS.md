# Claude Bridge 작업 지침

`apps/blabee/AGENTS.md`의 책임 구분·보호 규칙을 그대로 따른다. 이 폴더의 상세 안내는 같은 폴더의 `CLAUDE.md`가 기준이며,
이 파일은 Codex 같은 다른 에이전트를 위한 요약이다. 둘이 다르면 `CLAUDE.md`, `README.md`, `package.json`을 우선한다.
(2026-11-06 갱신. 이전 판은 2026-09-20 디렉터리 이동 전 `claude/` 구조를 설명했다.)

## 범위와 위치

- 이 영역: `bridges/claude/`(Swift `swift/`, Node Hook/MCP `src/`, 개발 launcher `launchers/`), `Contracts/bridge/`,
  `Tests/bridges/claude/`, `scripts/prepare-claude-runtime.mjs`, `scripts/sign-claude-runtime.mjs`, `dev/claude-standalone/`.
- 제품 연결은 설치된 Blabee의 자동 연결 shim(`shell/claude-v1/bin/claude`)이 실행마다 임시 Hook·MCP 설정을 주입하는 구조다.
  `launchers/claude-shared.mjs`(`claude:shared`, `claude:live`)는 레거시 개발 경로다.
- Hook 주입은 boundary 한 줄뿐이고 규칙은 MCP instructions에만 둔다. 성공한 `emit_decision_v1`이 readiness를 5분 갱신한다(2026-11-06).
- `dev/claude-standalone/`은 이전 독립 앱 보존용이다. 제품 코드를 그곳에 복사하거나 자동 승격하지 않는다.

## 명령 (이 폴더에서 실행)

- 문법 확인: `npm run check`
- Node 테스트: `npm test` (`Tests/bridges/claude/*.test.mjs`)
- Swift 빌드가 필요한 통합 테스트: `npm run test:shared-engine`, `test:product-ingress`, `test:native-session`,
  `test:product-registration`, `test:product-lifetime`, `test:product-lifecycle`, `test:installed-session`,
  `test:product-pet`, `test:runtime-payload`, `test:common-pet`
- Swift 테스트는 루트 `npm run test:swift`의 잠금(`/tmp/blabee-coordinator-swift-tests.lock`)을 공유한다. 두 세션이 동시에 돌리지 않는다.
- 생성물은 루트 `build/claude-tests/`에 둔다.

## 바꾸면 안 되는 것

- `@modelcontextprotocol/sdk` 1.30.0, `MCP_PROTOCOL_NEGOTIATION=legacy`. `zod`·`fast-uri`는 `package.json`의 `overrides`로 고정하고
  올릴 때 `scripts/prepare-claude-runtime.mjs`의 `CLAUDE_RUNTIME_PACKAGES`도 같이 바꾼다.
- 서버명 `blabee-claude`, `_v1` 도구 이름 다섯 개, 스키마 문자열(`blabee.claude-session.v3` 등), 식별자·Keychain account·env 접두사.
  목록은 `CLAUDE.md`의 같은 절.
- `src/` 파일을 추가·이름 변경하면 `CLAUDE_RUNTIME_SOURCE_FILES`를 함께 갱신한다.
- Fallback 금지: Codex socket·서비스로 넘어가지 않는다. 공통 `BLABEE_*` 설정을 재사용하지 않는다. 실패한 mutation을 자동 재전송하지 않는다.
  이전 boundary·선택을 추측하지 않는다.

## 공통 규칙

- 설치된 `/Applications/Blabee.app`, shim, `.zshrc` 관리 블록, 실행 중인 서비스·세션을 바꾸지 않는다.
- 다른 세션의 미커밋 변경을 되돌리거나 stash하지 않는다. 명시적 요청 없이 commit·push·merge·이력 변경을 하지 않는다.
- 비밀값·인증 정보·토큰은 수정하거나 출력하지 않는다. 의존성은 이유를 설명한 뒤 추가한다.
- 동작이나 계약을 바꾸면 테스트와 문서를 함께 갱신하고, 보고에 테스트·빌드·설치·실사용 결과를 구분해 적는다.
