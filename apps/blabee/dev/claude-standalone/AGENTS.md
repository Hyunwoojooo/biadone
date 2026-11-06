# 독립 Claude 개발 앱 작업 규칙

루트 AGENTS.md와 같은 디렉터리 README.md를 먼저 따른다.
이 코드는 별도 Node Coordinator·Swift Pet 검증 앱이며 공통 제품 엔진이 아니다.
제품 식별자·runtime·socket·데이터 경계는 docs/APP_SEPARATION.md를 보존한다.
설치된 Blabee/Codex, 원래 사용자 세션이나 제품 DB를 변경하지 않는다.
자동으로 공통 Codex 서비스에 fallback하지 않는다. 다른 작업자 변경을 보존한다.
빌드는 루트 build/claude-standalone/, 테스트는 루트 build/claude-tests/를 사용한다.
소스 경로 이동과 내부 구현/동작 변경은 분리해 검증한다.
