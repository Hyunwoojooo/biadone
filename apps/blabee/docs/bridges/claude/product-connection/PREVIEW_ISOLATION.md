# Claude Preview 분리 — 폐기된 제품 방향

**이 문서는 과거 기록이다.** 같은 날 후속 사용자 결정으로 [하나의 Blabee 앱과 DMG](UNIFIED_DISTRIBUTION.md)로 변경했다. 아래 명령과 두 제품 프로필은 현재 지원하지 않는다. 예전 산출물·검증 결과는 보존하지만 설치 후보로 사용하지 않는다.

2026-09-21 사용자 결정: 현재 Codex용 Blabee를 유지하며 Claude 개발·수용 검증용
앱과 DMG를 별도로 만든다. 공통 엔진·Pet 소스는 복제하지 않는다.
정식 제품은 한 앱에서 provider를 연결하는 기존 방향을 유지한다.

| 항목 | 기존 제품 | Claude Preview |
| --- | --- | --- |
| 앱 | `Blabee.app` | `Blabee Claude Preview.app` |
| bundle ID | `com.biadone.blabee` | `com.biadone.blabee.claude-preview` |
| 설치 | `/Applications/Blabee.app` | `/Applications/Blabee Claude Preview.app` |
| Application Support | `Blabee` | `BlabeeClaudePreview` |
| 기본 freshness account | `primary` | `claude-preview-primary` |
| DMG | 기존 Blabee 이름·버전 | `Blabee-Claude-Preview-0.1.0-arm64-r1.dmg` |

Preview는 `BLABEE_CLAUDE_PREVIEW`로 컴파일한다. 환경변수·CLI로 제품 프로필을
바꿀 수 없다. 패키징은 native `distribution-profile` 결과를 검사하여 일반 바이너리를
이름만 바꿔 Preview로 포장하지 못하게 한다. 서명된 Info.plist의
`BlabeeDistributionProfile=claude-preview`와 native 프로필도 일치해야 한다.

공통 DB·설정·소켓·Pet/authority 잠금·불변 Claude payload 저장 위치가 Preview
root를 따른다. registry의 Keychain account는 DB 경로 hash로 이미 분리된다.
공통 freshness Keychain service와 저장 schema는 유지하고 account tuple만 분리한다.
private owner는 해당 프로필의 bundle ID 및 기존 Apple anchor·Team·CDHash 조건을
모두 요구한다. 양쪽 ID를 동시에 허용하는 신뢰 규칙은 추가하지 않는다.

첫 Preview는 공통 Pet·앱 소유 서비스·Claude 시작/조회/선택에 집중한다. 계정 복원,
Codex Plugin/Hook 설정, telemetry, 로그인 자동 시작, 전역 단축키, 기존 제품 updater와
자동 설치는 제공하지 않는다. DMG에서 별도 앱을 Applications로 드래그해 설치한다.
기존 앱을 대체하지 않으며 Preview의 build 번호는 기존 제품과 독립적으로 증가한다.

담당: native namespace·peer trust는 native 구현자, 앱/DMG 조립·서명은 packaging
구현자, compiled profile·CLI·UI 조립과 문서는 root가 소유한다. Swift 검증은 root가
공통 잠금을 사용해 직렬 실행한다. 같은 소스를 두 프로필로 빌드하므로 양쪽 회귀를
검증해야 한다. 실제 설치·두 앱 동시 실행·Claude 모델 왕복은 정적/격리 테스트와
별도 수용 항목이다.

구현·검증 결과는 [작업 상태](TASK_STATUS.md)에 기록한다.

## 생성 명령과 현재 산출물

Swift 빌드에 `-Xswiftc -DBLABEE_CLAUDE_PREVIEW`를 전달한다. 배포 후보에는
`BLABEE_JOURNAL_TEST_HARNESS` 같은 테스트 define을 추가하지 않는다.
일반 바이너리는 전용 Preview 패키징에서 거부된다.

저장소 루트에서 준비한 Preview 실행 파일·runtime·Developer ID를 지정한다.
아래 자리표시자는 실제 절대 경로와 인증서 이름으로 바꾼다.

```sh
npm run build:claude-preview-dmg -- \
  --binary /absolute/preview-build/blabee-coordinator \
  --output /absolute/output/Blabee-Claude-Preview-0.1.0-arm64-r1.dmg \
  --claude-runtime-directory /absolute/prepared-runtime \
  --build-number 1 \
  --identity 'Developer ID Application: NAME (TEAMID)' \
  --team-id TEAMID
```

생성된 내부 arm64 후보는
`build/claude-tests/cp08-preview-isolation/artifacts/Blabee-Claude-Preview-0.1.0-arm64-r1.dmg`다.
앱과 DMG의 Developer ID 서명, 읽기 전용 마운트·내용·checksum을 검사했다.
저장소 밖 사본에서 native identity와 Node `22.23.2`·MCP SDK import도 확인했다.
공증·설치·GUI/서비스 시작·모델 연결은 수행하지 않았다.
