# 하나의 Blabee 앱과 DMG

2026-09-21 최종 결정: 사용자는 `Blabee.app` 하나와 DMG 하나를 설치한다.
Codex와 Claude 중 하나만 사용하거나 둘 다 사용해도 설치 제품은 같다.
별도 [Claude Preview 제품](PREVIEW_ISOLATION.md)은 과거 검증 기록으로 남긴다.

## 제품과 버전

| 항목 | 기준 |
| --- | --- |
| 앱 / bundle ID | `Blabee.app` / `com.biadone.blabee` |
| 설치 위치 | `/Applications/Blabee.app` |
| DMG | `Blabee-<version>-<architecture>-r<build>.dmg` |
| 제품 버전 | 하나의 앱 버전·build 번호. 기존 설치 build보다 높게 증가 |
| 브릿지 버전 | Codex plugin manifest와 Claude runtime의 package/descriptor를 각각 유지 |
| 데이터 / 서비스 | 기존 `Blabee` Application Support와 공통 앱 소유 서비스 |
| 사용자 화면 | 공통 Pet 하나에서 Codex와 여러 Claude 세션을 선택 |

공통 엔진 수정은 두 브릿지가 사용하는 동일 엔진에 반영한다. 브릿지의 버전·호환성은
각 manifest와 서명된 assembly/runtime descriptor로 식별한다. 브릿지를 별도 앱으로
복제하거나 같은 이름의 두 설치를 요구하지 않는다. 이번 작업은 기존 디렉터리를
다시 이동하거나 `Contracts/v1`을 변경하지 않는다.

## 연결과 업데이트

Claude만 사용하는 경우 Codex 설치·Plugin·관찰 프로젝트 등록은 필요하지 않다.
첫 실행의 로그인·약관은 공통 제품 정책대로 진행하고, Codex 연결은 **연결은 나중에**로
넘길 수 있다. 설정의 연결 탭에서 **앱 실행형 서비스 켜기**를 선택한다.
r63의 [터미널 자동 연결](AUTO_CONNECT.md)을 한 번 켜면 새 zsh 터미널의 `claude`와
`claude --resume`으로 연결된다. 패널 메뉴의 **Claude 시작**과 작업 폴더 선택도 유지한다.
공통 picker에서 해당 Claude 세션을 선택한다.

기존 macOS 자동 시작 서비스가 등록된 사용자는 진행 중인 Blabee 선택을 마친 뒤
등록을 해제하고 앱 실행형 서비스로 전환해야 한다. 이미 켰으나 등록 충돌로 차단된
상태라면 등록 해제 후 **서비스 다시 시작**을 선택한다. 자동으로 등록을 해제하거나
기존 프로세스를 종료하지 않는다. Claude의 프로젝트 신뢰·MCP 승인은
그대로 유지한다. 실행 중인 일반 Claude에 사후 연결하는 기능은 포함하지 않는다.

공통 업데이트는 Codex와 Claude 양쪽에 영향을 준다. 기존 coordinator inode lease,
활성 프로세스 검사, Claude runtime 사용 기록과 설치 admission lock을 유지한다.
활성 또는 불명확한 Claude 사용 기록이 있으면 교체를 보류한다. 번들 Node가 있으면
전체 payload의 lease 최적화 대신 기존 보수적인 프로세스 검사도 수행한다.

## 내부 후보와 공개 배포

과거 개발 Channels 후보는 `build:macos-app`과 `build:internal-dmg`의 기존 경로에서 명시적인
`--claude-runtime-directory`, `--internal-signing-identity`, `--internal-signing-team-id`
옵션으로 통합 내부 후보를 만든다. 별도 Preview CLI·제품 profile은 제거한다.
`distribution-profile`은 `blabee`만 반환하며 구식 Preview 컴파일 define은 실패한다.

일반 fresh DMG 경로는 소스에서 새로 빌드하며 임의 `--binary`를 받지 않는다.
준비한 runtime은 빌드 전·패키징 전에 다시 검증하고 원본을 수정하지 않는다.
staging의 Node를 서명·검증한 뒤 runtime descriptor, assembly manifest, 앱, DMG를 봉인한다.

2026-09-27 공개 연결은 [일반 MCP·Hook 계약](PUBLIC_MCP_HOOK.md)을 따른다.
새 준비기는 `blabee.claude-runtime.v2`, `delivery_mode=mcp-hook-v1`,
`blabee.claude-session.v3` manifest를 생성한다. Channel mode·source·selector 키는 없다.
`build:release-dmg -- --claude-runtime-directory /absolute/prepared-runtime`은 이 형식만
허용하며 Node의 Developer ID·allow-jit 검증 후 descriptor·assembly manifest·앱·DMG를
차례로 봉인한다. 설치 런처는 개발 Channels 옵션 없이 MCP 설정을 전달한다.
Stop만 `asyncRewake=true`, timeout 660초이고 나머지 lifecycle Hook은 동기다.
기존 카드·authority 만료는 유지하며, Claude 2.1.282는 후보 최소 버전 검사다.
실제 native 연결 검증이나 이후 모든 버전의 호환성을 통과했다고 뜻하지 않는다.

일반 runtime 검증기는 과거 `blabee.claude-runtime.v1` 개발 Channels manifest도 읽지만
형식이나 배송 모드를 바꾸지 않는다. 공개 signer와 기본 `public` 공증은 실제 payload를
검사하여 이 과거 형식을 거부한다. 새 설치 런처도 과거 runtime을 받지 않는다.

내부 시험용 Apple 공증은 `notarize:dmg -- --distribution-mode internal-preview`로
명시적으로 선택할 수 있다. 정확한 내부 안내문·앱·runtime 검증을 통과해야 하며,
`Accepted`와 stapling 완료 후에도 `claude_channel_mode=development-preview`,
`public_distribution_ready=false`를 유지한다. 기록된 내부 모드를 공개 모드로 바꿔
재개할 수 없다. [내부 후보 공증 절차](../../../development/RELEASE_DMG_PACKAGING.md#개발용-claude-channels-내부-후보-공증)를 따른다.

Apple 공증은 native Hook·MCP 동작 검증을 대신하지 않는다. 과거 개발 Channels DMG를
새 공개 runtime으로 다시 이름 붙이거나 다운로드·자동 업데이트 대상으로 자동 게시하지 않는다.

설치 전 서명·manifest·번들 Node 검증과 실제 설치·모델 ACK·사람 클릭은 다른 증거다.
현재 산출물·검증 결과는 [작업 상태](TASK_STATUS.md), 설치 이후 절차는
[수용 안내](ACCEPTANCE.md)에 기록한다. 이번 후보는 실행 중인 앱에 자동 적용하지 않는다.

과거 내부 후보 `Blabee-0.1.0-arm64-r63.dmg`는 앱 `0.1.0 / 63`, Codex 브릿지
`0.1.2`, Claude 브릿지 `0.1.0`을 포함하며 일반 Claude 명령의 자동 연결을 추가했다.
Developer ID 앱·DMG 서명과 저장소 밖의 532개 payload·번들 Node/SDK·자동 연결 모듈
검사를 통과했다. 공증·새 후보 설치·실제 모델 연결은 수행하지 않았다. 파일은
`build/claude-tests/auto-connect/artifacts/`에 있다. 사용자가 이미 설치한 r62의 결과는
`build/claude-tests/cp08-unified-app/`에 과거 기록으로 유지한다.
