# Claude Code 작업 안내

작업 전에 같은 디렉터리의 `AGENTS.md`와 `README.md`를 읽고 따른다.
현재 공통 엔진 연결은 README의 `claude:shared` 경로를 사용한다. 이 launcher가 여는 새 세션에는 `_v1` 도구를 등록한다. 실제 사용 가능한 도구부터 확인하고, 없다면 다른 도구로 대체하지 않는다. 폴더에서 일반 `claude`를 시작한 것만으로 Hook·MCP가 등록되지는 않는다. `app`/`doctor`/`claude` 명령은 ../../dev/claude-standalone package의 독립 개발 앱 경로다.
`--pet` 또는 준비된 `claude:live` 명령으로 기존 공통 UI를 연다. [COMMON_PET.md](../../docs/bridges/claude/COMMON_PET.md)에 구분된 테스트 프롬프트가 있다. 설치된 앱에 여러 provider를 등록하는 최종 배포 단계와 구분한다.
파일 변경은 사용자가 승인한 브릿지·공통 연결 범위에 한정한다. 다른 세션의 변경과 설치된 실행 환경을 보존한다.
