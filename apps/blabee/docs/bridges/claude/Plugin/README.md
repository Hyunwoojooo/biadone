# blabee-claude 플러그인 참고 파일

이 디렉터리는 패키징 전의 참고용 workflow skill을 보관한다. 아직 독립 설치 가능한 플러그인 패키지가 아니다.

현재 개발 실행은 `scripts/`의 launcher가 세션별 Hook 설정과 MCP 설정을 생성하고 로컬 bridge를 실행한다. 런타임은 `src/bridge/`에 있다. 이 참고 디렉터리를 `--plugin-dir`에 넣거나 임의의 `plugin@local` selector를 사용하지 않는다.

완성 플러그인 배포에는 플러그인 캐시 안에서 실행할 수 있는 자체 포함 산출물과 검증된 설치 경로가 필요하다. 현재 파일은 캐시 밖 상대 경로를 참조하는 `.mcp.json`이나 Hook 실행 설정을 제공하지 않는다.

- `skills/blabee-claude-workflow/SKILL.md`: 모델 작업 흐름 초안. 현재 launcher의 Hook·MCP instructions가 같은 핵심 규칙을 전달한다. skill 자동 선택에 세션 binding이나 실행 권한을 맡기지 않는다.
- 도구 승인은 Claude 네이티브 화면을 사용한다. 이 버전은 permission relay를 선언하지 않는다.
