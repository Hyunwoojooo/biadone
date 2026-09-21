# Claude 공통 엔진 브릿지

제품 Swift 엔진/공통 Pet에 연결하는 Claude Hook·MCP·세션 adapter입니다.
Swift 소스는 `swift/`, Node 통신 코드는 `src/`, 개발 세션 launcher는 `launchers/`에 있습니다.
기존 SDK 1.30.0과 lockfile을 사용하며 새 의존성을 추가하지 않았습니다.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run claude:shared -- --coordinator-bin /absolute/product/blabee-coordinator --cwd /absolute/project/path --pet
```

위 명령은 이 디렉터리에서 실행합니다. launcher가 여는 새 Claude 세션에 `_v1` 도구를
등록합니다. 이미 열린 일반 Claude 세션에 자동 등록하지 않습니다. `--pet`은 해당 host의
공통 Pet UI를 열며, 설치 앱에 여러 provider를 함께 등록하는 최종 통합과는 구분합니다.
`claude:live`는 저장소 루트의 `build/claude-tests/shared-pet-live`에 개발 빌드가
미리 준비된 환경에서만 사용합니다.

공통 검증 명령 `test:shared-engine`, `test:native-session`, `test:product-ingress`,
`test:product-registration`, `test:installed-session`, `test:product-pet`, `test:runtime-payload`, `test:common-pet`은 `../../Tests/bridges/claude/`의 runner를 사용합니다.
생성물은 루트 `build/claude-tests/`에 두어 macOS socket 경로 길이를 제한합니다.

[CP-05 제품 실행기와 v2 Hook/MCP](../../docs/bridges/claude/product-connection/INSTALLED_SESSION.md)는
공통 서비스에 등록한 native owner가 새 Claude 자식과 권한 갱신을 관리합니다.
기존 `claude:shared` 명령과는 별도 경로입니다. [CP-06 공통 Pet](../../docs/bridges/claude/product-connection/PRODUCT_PET.md)는
Claude 시작·세션 선택·연결 확인·해제 UI와 앱 전용 인증을 연결합니다.
[CP-07 runtime 패키징](../../docs/bridges/claude/product-connection/RUNTIME_PAYLOAD.md)은 Node/SDK 번들·불변 사본·사용 중 업데이트 보류를 구현합니다. 실제 설치·모델 수용과 일반 Channels 배포 승인은 별도 CP-08 조건입니다.

[터미널 자동 연결](../../docs/bridges/claude/product-connection/AUTO_CONNECT.md)은 설정의 연결 탭에서
한 번 켠 뒤 새 zsh 터미널의 `claude`, `claude --resume`, `claude --continue`를 설치된 런처로
연결합니다. 실제 첫 SessionStart로 대화 ID를 확인한 뒤 새 Blabee 권한을 발급합니다.
재개한 대화의 이전 선택·권한은 복원하지 않으며, 이미 실행 중인 세션에 사후 적용하지 않습니다.
관리 명령·비대화형 실행·사용자가 별도 Hook/MCP/Channel 설정을 지정한 실행은 원래 Claude로
전달합니다. 개발 Channels 승인과 모델의 실제 ACK는 계속 필요합니다.

[CP-08 실제 연결 수용](../../docs/bridges/claude/product-connection/ACCEPTANCE.md)에 설치 전 점검과 연결 확인·A/B 선택 프롬프트를 나눠 정리했습니다. ad-hoc 후보는 제품 owner 인증을 통과하지 못하므로 내부 Developer ID 후보가 필요합니다. [하나의 Blabee 앱과 DMG](../../docs/bridges/claude/product-connection/UNIFIED_DISTRIBUTION.md)에 두 브릿지를 담습니다. 앱 버전은 하나이며 브릿지 버전·세션은 내부에서 구분합니다. 통합 후보 검증은 기존 설치·실행 세션을 교체하지 않고 수행합니다.

독립 Node Coordinator·별도 Pet는 [dev/claude-standalone](../../dev/claude-standalone/README.md)에 있습니다.
현재 상태는 [제품 연결 작업 상태](../../docs/bridges/claude/product-connection/TASK_STATUS.md)와
[공통 Pet 안내](../../docs/bridges/claude/COMMON_PET.md)를 확인합니다.
이전 실행 기록은 [이동 전 README](../../docs/history/claude/README_PRE_LAYOUT.md)에 보존합니다.
