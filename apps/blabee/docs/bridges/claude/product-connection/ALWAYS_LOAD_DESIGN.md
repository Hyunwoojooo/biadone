# Blabee 도구를 항상 싣기 (설계, 2026-11-19)

상태: 사용자 승인(2026-11-19). r94 대상.

## 문제

연결은 정상인데 카드가 뜨지 않는다. Claude Code는 MCP 도구를 tool search 뒤로 미뤄 두고 이름만 보여 준다.
모델이 ToolSearch로 `emit_decision_v1`을 불러와야 호출할 수 있고, 불러오지 않으면 카드는 만들어지지 않는다.

근거 (2026-11-19, Claude Code 2.1.328, r93 설치 직후):

- 일반 터미널에서 연 자동 연결 세션은 SessionStart·UserPromptSubmit(boundary)·Stop Hook과 MCP 서버가 모두 동작했다.
  transcript의 `deferred_tools_delta`에 `mcp__blabee-claude__*` 다섯 개가 들어 있었고 `emit_decision_v1` 호출은 없었다.
- 최근 6일의 Blabee 연결 세션 transcript 9개: ToolSearch로 Blabee 도구를 불러온 3개만 카드를 만들었다(5·6·3회).
  불러오지 않은 6개는 0회였다.

## 접근

| 방법 | 판단 |
| --- | --- |
| **`mcp.json`의 `blabee-claude` 서버에 `"alwaysLoad": true`** | 채택. 한 줄이고 Blabee가 직접 만드는 파일이다. |
| 도구별 `_meta["anthropic/alwaysLoad"]` | 2.1.328 코드에서 동작을 확인했지만 `true`의 도입 버전을 모른다. 서버 옵션과 달리 시작을 붙잡지 않는 장점이 있다. 도구 다섯 개 정의가 합쳐 약 4천 자(UTF-8 4.8KB)라 골라 실을 이유는 작다. |
| 안내문에 "ToolSearch로 불러오라"고 쓰기 | 문구가 늘고 여전히 모델 판단에 기댄다. |
| 사용자에게 `ENABLE_TOOL_SEARCH=false` 요구 | 다른 MCP 도구까지 전부 실린다. 사용자 조치가 필요하다. |

`alwaysLoad` 서버 옵션은 Claude Code 2.1.121에서 추가됐다(Claude Code CHANGELOG). Blabee 최소 지원 버전은 2.1.282다.

## 변경

- `bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift` `documents(...)`: `mcpServers["blabee-claude"]`에 `"alwaysLoad": true`.
  자동 연결(`observeSession`)과 고정 세션 두 경로 모두 같은 문서를 쓴다.
- `bridges/claude/launchers/shared-launcher.mjs` `createSharedLaunchConfiguration`: 같은 키(개발 경로를 제품과 같게 유지).

바꾸지 않는 것: 서버 이름, `_v1` 도구 이름과 schema, Hook, `Contracts/bridge`, MCP instructions.

## 부작용

`alwaysLoad: true`인 서버는 Claude 시작이 그 서버 연결까지 기다린다(표준 연결 제한 5초). Blabee MCP 서버는 번들 Node로 바로 뜬다.

## 검증

1. 사전 확인(완료): 도구 하나짜리 stdio MCP 서버를 `--mcp-config --strict-mcp-config`로 붙여 `claude -p`를 두 번 실행했다.
   옵션이 없으면 그 도구가 `deferred_tools_delta`에 있었고, `"alwaysLoad": true`면 없었다(2.1.328, Sonnet 5.5).
2. 단위 테스트: Swift `ClaudeInstalledLauncherTests`(생성 문서의 서버 항목), Node `shared-launcher.test.mjs`.
3. r94 설치 뒤: 새 자동 연결 세션의 transcript에서 Blabee 도구가 `deferred_tools_delta`에 없고, 작업 뒤 `emit_decision_v1`이 호출되는지 본다.

## 기대하지 않는 것

한 일이 없는 짧은 대화에서는 이 변경 뒤에도 카드가 뜨지 않는다. MCP instructions가 "작업 결과와 후속 작업 2–4개가 있을 때만"으로 정했다.
