# CP-07 Claude 런타임과 업데이트 보호

2026-09-21. 공통 Blabee 앱에 Claude 브릿지와 실행용 Node를 포함하는 소스 구현이다. 기존 Codex 실행 경로와 개발용 `claude:shared`는 유지한다. 실제 설치 앱·모델 수용과 일반 Channels 배포 승인은 별도 단계다. 검증 결과는 [작업 상태](TASK_STATUS.md)에 기록한다.

## 앱 안의 구성

```text
Blabee.app/Contents/Resources/
  assembly-manifest.json          # 기존 v2 키/규칙 유지
  claude/
    manifest.json                # blabee.claude-runtime.v1
    node/bin/node                # Node 22.23.2, arm64 또는 x64
    node/LICENSE                 # Node 및 포함된 제3자 고지 전체
    node/Node.entitlements        # preview 서명용 allow-jit
    payload/src/                 # 제품 v2 Hook/MCP와 기존 helper 11개
    payload/node_modules/         # SDK 포함 실행 패키지 9개
    payload/package.json
    payload/package-lock.json
```

CLI·로그인·사용자 자격은 번들하지 않는다. 기존 MCP SDK 1.30.0의 ESM 실행 부분과 필요한 zod/Ajv 파일만 복사하며 테스트·타입·map·`.bin`·symlink는 제외한다. 현재 구성은 해시로 색인한 529개 파일이다. 새 npm 의존성을 추가하지 않는다.

descriptor는 bridge/Node/SDK 버전, Node architecture, owner/session/Pet 계약 버전, `legacy` MCP 협상, Channels mode/source/selector, 파일별 path·SHA256·size·실행 여부를 고정한다. canonical JSON은 키 정렬·공백 없음·slash 비이스케이프이며, `payload_digest`를 제외한 전체 내용의 SHA256을 `sha256:` 접두사로 기록한다. 파일별 SHA256은 접두사 없는 64자리 소문자다. manifest 자체를 제외한 전체 파일과 directory 구조가 일치해야 한다.

준비 도구는 명시적 Node 바이너리를 실행하지 않고 Mach-O 구조/architecture를 검사한다. 설치 실행기는 실제 Node version probe도 descriptor의 고정 버전과 일치해야 허용한다. Node 배포본의 출처·archive checksum 검증은 패키지 작성자가 먼저 한다. 이번 arm64 검증 입력은 공식 Node 22.23.2 archive이며 SHA256은 `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`이다. x64 archive의 공식 값은 `58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026`이며 실제 x64 실행은 이번 arm64 컴퓨터의 검증에 포함하지 않는다. [공식 릴리스](https://nodejs.org/en/blog/release/v22.23.2), [바이너리 검증](https://github.com/nodejs/node#verifying-binaries).

## 실행 중 파일 고정

Pet과 native owner는 설치된 앱의 정확한 resource 경로를 사용한다. native owner는 실행 중/디스크 앱의 서명 identity를 대조하고, 검증된 assembly bytes의 SHA256에 묶인 Claude descriptor 해시를 넘긴다. 서명 검사 직후 자기 해시만 다시 만든 다른 descriptor를 넣어도 허용하지 않는다.

검증된 파일은 사용자 전용 `~/Library/Application Support/Blabee/claude-runtime/payloads/<digest>`에 새 사본으로 게시한다. 파일은 0400, directory와 Node는 0500이다. 기존 digest에 다른 내용을 덮어쓰거나 symlink/hardlink로 공유하지 않는다. owner가 만드는 Hook/MCP 설정은 이 사본의 절대 경로를 사용한다. 원래 앱이 없어져도 나중에 필요한 Node module을 읽을 수 있다.

private store의 `uses/<uuid>.json`에는 public 사용 ID·payload digest·runtime identity만 기록한다. 세션 authority/token과 별개이며 자식 시작 전에 저장한다. owner가 비정상 종료하면 기록이 남는다. PID 부재나 registry가 비어 있다는 이유로 지우지 않는다. 정상 자식 reap 또는 spawn 전 실패를 확인한 owner만 자기 기록을 정리한다. 잠깐의 admission 경합은 제한 시간 동안 재시도하며, 손상·교체·확인 실패는 보존한다. 정상 종료 후에도 payload 사본은 유지하고 자동 GC는 하지 않는다.

## 설치·업데이트

설치의 Claude admission EX lock은 사용 등록과 같은 잠금을 사용하고 publish·rollback 전체 동안 유지한다. active·불명·손상 기록은 새 설치/기존 교체/legacy/v1 어느 경로에서도 차단하며 legacy 종료 확인 버튼으로 우회할 수 없다. updater는 준비·helper ready·Codex pause 직전·실제 설치 직전에 다시 검사한다. Claude를 Codex pause/resume journal에 넣지 않는다.

Node 때문에 기존 전체-payload v1 판정은 보수적 fallback을 유지한다. fallback에서도 v1 coordinator의 inode EX lease와 기존 process guard를 함께 잡아 새로운 coordinator 시작과 파일 읽기 경합을 막는다. 공통 엔진 권한/SQLite 계약은 변경하지 않는다.

불명 기록은 자동 복구하거나 삭제하지 않는다. owner 강제 종료 뒤 남은 기록 때문에 업데이트가 계속 보류될 수 있으며, 별도 복구 정책이 필요하다. 사용자에게 파일 삭제를 자동으로 지시하지 않는다.

## 개발 preview 패키지 만들기

아래는 저장소 루트에서 패키지 작성자가 실행하는 명령이다. 일반 사용자의 세션 시작 명령이 아니다. `runtime` 출력은 아직 없어야 한다. Node 경로는 공식 archive를 검증·추출한 경로로 지정한다.

```sh
node scripts/prepare-claude-runtime.mjs \
  --bridge-root "$PWD/bridges/claude" \
  --node-binary /absolute/verified-node/bin/node \
  --node-license /absolute/verified-node/LICENSE \
  --node-version 22.23.2 --node-arch arm64 \
  --output "$PWD/build/claude-tests/cp07/runtime"
```

기존 assembler에 명시적으로 넣는다. Node를 안쪽부터 ad-hoc 서명하고, 변경된 Node 해시→Claude descriptor→기존 assembly manifest→앱 서명 순서로 묶는다. 입력을 생략하면 기존 Codex 전용 패키지를 만든다.

```sh
node scripts/build-macos-app.mjs \
  --binary /absolute/verified-build/blabee-coordinator \
  --output /absolute/new-output/Blabee.app \
  --claude-runtime-directory "$PWD/build/claude-tests/cp07/runtime" \
  --adhoc-sign
```

`prepare-local-dogfood.mjs`도 같은 `--claude-runtime-directory` 인자를 받는다. fresh internal DMG는 명시적 runtime·내부 서명 옵션으로 Claude를 포함할 수 있다. 일반 release pipeline은 개발 Channels payload를 포함하지 않는다. descriptor는 `development-preview`, selector는 `server:blabee-claude`이며 launcher의 명시적 development Channels 활성화를 유지한다. 이 preview를 Developer ID 일반 배포로 넘기면 assembler가 거절한다. 승인된 plugin 경로로 자동 전환하거나 등록 승인을 꾸며내지 않는다. 일반 plugin 패키징과 launcher source 전환은 승인 조건 확인 뒤 추가 구현·검증해야 한다. [공식 Channels](https://code.claude.com/docs/en/channels), [배포 경로](https://code.claude.com/docs/en/channels-reference).

## CP-08 내부 Developer ID preview

ad-hoc 후보는 산출물 검사와 격리 fixture용이다. 제품의 private owner 등록은
Apple anchor·동일 Team ID·동일 CDHash를 요구하므로 ad-hoc 후보로 실제 제품
연결을 시도하면 거절된다. 내부 실사용 수용에는 별도 명시적 패키징 경로를 쓴다.

```sh
npm run build:macos-app -- \
  --binary /absolute/verified-build/blabee-coordinator \
  --output /absolute/new-output/Blabee.app \
  --claude-runtime-directory "$PWD/build/claude-tests/cp07/runtime" \
  --bundle-version 62 \
  --internal-signing-identity 'Developer ID Application: Your Name (TEAMID1234)' \
  --internal-signing-team-id TEAMID1234
```

`62`는 이번 점검에서 확인한 설치 build `61` 다음의 내부 후보 번호다. 다음
실행 때도 최신 설치 build를 확인하며, 이미 서명된 Info.plist를 직접 고치지 않는다.
출력 부모는 미리 존재해야 하고 출력 앱은 없어야 한다. 이 CLI는 설치·notarization·
배포나 인증서 생성/수정을 하지 않는다.

API의 `internalClaudeSigning`은 `releaseSigning`·ad-hoc와 함께 쓸 수 없고
명시적 runtime·build 번호를 요구한다. 원본 runtime은 유지하고 staging의 Node를
Developer ID로 서명한다. 정확한 Node identifier·Team·Apple 인증서·Hardened Runtime·
timestamp와 allow-jit 단일 entitlement를 검사한 뒤 descriptor와 assembly manifest를
봉인한다. 앱은 기존 Apple-events 단일 entitlement로 마지막에 서명한다.
임의의 추가 Mach-O나 실행 파일은 허용하지 않는다.

일반 `signReleaseApp`의 executable 허용 범위와 일반 release의 preview 거절은
그대로다. 내부 후보는 `development-preview`·`server:blabee-claude`를 유지하며
Channels 승인/일반 배포 자격을 부여하지 않는다. 실제 설치·모델·사람의 선택은
[수용 절차](ACCEPTANCE.md)를 따른다.

## 격리 검증

```sh
node Tests/bridges/claude/scripts/test-runtime-payload.mjs --packaging
node Tests/bridges/claude/scripts/test-runtime-payload.mjs --swift
node Tests/bridges/claude/scripts/test-runtime-payload.mjs --packaged
node Tests/bridges/claude/scripts/test-runtime-payload.mjs --production
```

`--swift`/`--packaged`는 위 runtime 경로를 사용하며 다른 후보는 `BLABEE_CP07_RUNTIME_ROOT`로 지정한다. 테스트 전용 freshness·peer·store·PTY만 사용한다. Swift 빌드는 공통 lock과 CP-07 scratch/cache로 직렬화한다. `--packaged`는 checkout 밖 사본과 `PATH=/usr/bin:/bin`에서 실제 command Hook·stdio MCP를 실행하고, owner kill 후 분리된 Node의 늦은 SDK import와 업데이트 차단을 검사한다. 실제 Claude 모델 호출·Terminal 앱 조작·설치/전역 설정 변경은 하지 않는다.
