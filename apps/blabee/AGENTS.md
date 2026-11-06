# Blabee 작업 지침

상위 저장소 지침을 따르며 아래 책임 구분을 유지한다.

- engine: 공통 의미·상태·라우팅·저장·검증.
- bridges/codex, bridges/claude: 도구별 Hook·MCP·전달·연결 수명.
- app: 공통 Pet UI·서비스 조립·제품 기능.
- dev: 독립 앱·데모·실험. 제품 구현으로 자동 승격하지 않는다.
- Tests/support/reference-engine: Node 계약 참조 구현. 제품 권위 엔진은 Swift다.

Swift 모듈명과 물리 디렉터리는 다르다. root Package.swift의 명시 sources를 확인하고
파일은 정확히 하나의 target에만 포함한다. 모듈 분리·접근수준 변경과 파일 이동을
같은 변경에 섞지 않는다. 혼합 책임은 docs/development/DIRECTORY_MIGRATION.md에 기록한다.

소스 Plugin 위치와 번들 내부 경로를 구별한다. Contracts/v1, bundle ID,
서비스·Keychain 식별자, 저장 schema, 세션 연결 규칙은 단순 정리 중 변경하지 않는다.
실행 중인 사용자 앱·세션·DB와 기존 소스 경로를 보호하고 필요하면 별도 worktree에서 작업한다.
무관한 파일과 다른 작업자의 변경을 보존한다. 비밀 환경 파일·인증정보는 수정하지 않는다.
명시적 요청 없이 commit·push·merge·branch 삭제·이력 변경을 하지 않는다.

명령은 README.md와 package.json에 있다. Swift 전체 검증은 npm run test:swift의
직렬 실행과 잠금을 유지한다. Claude의 제품/독립 개발 명령은 해당 package에서 실행한다.
기존 실패와 새 회귀를 구분하고, 테스트/빌드/패키징/서명/설치/실사용 결과를 별도로 보고한다.
