# Codex 0.159.3·0.160.0 지원 검증

2026-10-05, macOS arm64. 공식 최신 안정 버전은 0.160.0이다. 기존 0.159.2 지원에
후속 안정 버전 두 개의 소스 지원과 검증 데이터를 추가했다. 앱은 빌드하지 않았다.

## 반영 범위

- `CodexCompatibility`: 일반 Plugin CLI와 관리형 App Server의 정확 버전 등록.
- `HookPermissionPolicy`: 공식 primary `bin/codex`의 정확한 CDHash 등록.
  세션·턴·명령·cwd 결합과 기존 일회성 명령 승인 범위는 유지한다.
- `CodexRuntimeBundle`: 버전별 42파일 digest와 10디렉터리를 포함한 전체 fingerprint.
  voice JSON 실행 비트 예외도 공식 경로와 정확한 digest를 계속 요구한다.
- `ManagedCodexLauncher`: 서버가 workspace 설정을 소유하는 버전 목록 확대.
- `UpdateManagedCodexProfile`: 별도 업데이트 저장·종료·재개 지원 목록 확대.
- 패키지 검사기, voice JSON fixture 및 기존 버전별 회귀 검사 확대.

미등록 patch·minor·prerelease를 자동 허용하지 않는다. Engine·Claude·공통 앱 소스와
실행 중인 사용자 설정·세션·DB는 변경하지 않았다.

## 공식 패키지 식별

다음 SHA-256은 단일 실행 파일 archive가 아닌 전체
`codex-package-aarch64-apple-darwin.tar.gz`의 값이다. GitHub release API의 크기·digest와
실제 다운로드를 대조하고, 원본 bytes·권한을 보존했다.

| 버전 | 전체 archive SHA-256 | primary native CDHash |
| --- | --- | --- |
| 0.159.3 | `fad57a5681cabcef21d322af5aec938975cfb711b5f25d4ce4907e6561616d07` | `dcfc226a89d9cf1c997395978f9bc26308038ca5` |
| 0.160.0 | `007df41b607dbbc8d204b9746ce7fed2d4ce6c813f44c32ceee54175ca796525` | `4684feae17bed05191fd828bb819c61cb70db4f9` |

출처: [0.159.3 release](https://github.com/openai/codex/releases/tag/rust-v0.159.3),
[0.160.0 release](https://github.com/openai/codex/releases/tag/rust-v0.160.0),
[공식 변경 기록](https://learn.chatgpt.com/docs/changelog).

Swift catalog의 전체 managed fingerprint:

- 0.159.3: `6decf4a44bcdc6affc04398edcfc778605d3264dea29f4f387a06fb2b7b0b4f2`
- 0.160.0: `4f6a4a3db956806862596c026345284181337cf60e3168ce549cf864f1c596bf`

manifest와 정렬된 52개 entry의 경로·종류·digest·실행 분류·서명 Team ID·CPU type을
길이 구분 직렬화하여 계산했다. 동일한 entry 구성에 기존 0.159.2 catalog의 digest와
version을 넣어 기존 fingerprint를 재현한 뒤 신규 값을 계산했다. 이는 기존 패키지를
다시 실행한 검증이나 Node smoke의 snapshot fingerprint와 구분한다.

## 공식 소스 비교

0.159.2와 비교하여 두 버전의 `app-server-protocol` 1,119파일, Hook 59파일,
`rmcp-client` 101파일, App Server request processor 64파일, rollout 36파일이 동일했다.
Hook runtime·MCP executor·queue command 구현도 동일했다. 따라서 wire 변환,
일회성 승인 결합, 선택 ref 검증, 업데이트 종료 조건을 변경하지 않았다.

- `PermissionRequestDecision::Allow`는 기존 일회성 `Approved` 경로를 따른다.
  기존 `write_stdin`/`writeStdin`은 Codex 기본 승인으로 전달하며 Pet Bash 승인으로
  해석하지 않는다.
- 0.160의 projectless TUI 기본권한은 `uses_remote_workspace()`이면 적용되지 않는다.
  Blabee managed remote에 별도의 projectless 기본권한을 주입하지 않는다.
  [적용 조건](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/tui/src/projectless.rs).
- Remote start/resume은 workspace roots와 저장된 permission/provider를 서버가
  결정하도록 유지한다. 기존 CLI override 원문·순서 전달 및 `--add-dir`·`--no-daemon`,
  workspace override와 `--profile` 혼용 거부도 새 버전에 적용한다.
  [workspace·resume](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/tui/src/app_server_session.rs).
- Plugin manifest 캐시는 매번 읽은 manifest·overlay 내용의 SHA-256으로 적중을
  판단한다. manifest schema나 Hook 경로는 변경되지 않았다.
  [캐시 구현](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core-plugins/src/manifest/manifest_cache.rs).
- 재연결 뒤 미전송 입력을 복구하는 TUI 변경은 Blabee의 `thread/queue/add` 호출과
  queue 영수증 형식을 바꾸지 않는다.
  [queue 경로](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/tui/src/session_queue_commands.rs).
- unsubscribe ACK와 실제 종료를 뜻하는 `thread/closed`는 별개다. 모든 thread 종료,
  stdout/stderr EOF, exit 0, 저장 root 검증을 계속 요구한다.
  [종료 처리](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs).

## 실행 검증

- Node/Python 회귀 **207/207 통과**. 계약·Plugin·패키지·native lifecycle 검사기 테스트를
  직렬 실행했다. Swift 컴파일·테스트는 실행하지 않았다.
- 공식 두 패키지 각각 **71개 account-free smoke 통과**. 전체 layout·voice manifest,
  native 30파일의 Apple anchor/OpenAI Team ID/identifier·공증, 정확 버전, 격리된
  Plugin 0.1.3 설치·조회·제거, queue 도움말을 확인했다.
- 두 버전 모두 격리된 native App Server의 저장·정상 종료·동일 UUID/cwd 재개를
  통과했다. 빈 테스트 thread는 metadata 작업으로만 저장했고 모델 turn은 보내지 않았다.
- 두 버전 모두 `.jsonl.zst`만 남긴 테스트 기록을 재개하여 plain 기록 복원과 원본
  prefix bytes 보존을 확인했다. start/cold resume/compressed resume 세 단계에서
  workspaceWrite·추가 writable root·networkAccess=false·임시 폴더 제외 정책을 확인했다.
  `writableRoots`는 추가 root를 나타내며 현재 cwd는 기본 writable root다.
- 실행 검사는 별도 OS sandbox로 네트워크와 사용자 홈 접근을 막고, 새 임시 폴더만
  쓰도록 제한했다. 기본 도구 sandbox 안의 codesign 및 중첩 sandbox 실행은 실패하여
  별도 허가된 실행으로 다시 검사했다. 실패한 초기 보고서도 증거 폴더에 남겼다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

설치된 Blabee의 Swift private runtime/remote TUI, fresh/reused daemon의 실제 Hook
ancestry, Hook → Pet 승인·선택 → queue 실행·완료, 실제 앱 업데이트 복원은 별도
실사용 검증이 필요하다. 음성 캡처·처리와 모델 완료도 검사하지 않았다.

## 같은 작업 중 발생한 Codex 네트워크 권한 오류

2026-10-05 19:33 KST의 로컬 Codex 로그에서 다음 흐름을 확인했다.

1. `Too many open files (os error 24)`로 `/etc/codex/requirements.toml` 읽기 실패.
2. 같은 시간대 설정 재로딩에서 `application network permission was revoked` 발생.
3. 공식 소스상 정책 로딩 실패는 현재 application network policy를 unavailable로
   만들고 기존 요청의 permit을 회수한다.

[정책 로딩 실패 처리](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/app-server/src/application_network.rs),
[permit 회수·오류 변환](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/http-client/src/network_policy.rs).

읽기 전용 관찰에서 Codex App Server는 열린 FD 207개, 최대 번호 255, 그중 pipe 94개였다.
`launchctl limit maxfiles` 기본 soft limit는 256이었으나 해당 PID의 실제 rlimit를 직접
측정한 것은 아니다. Blabee coordinator는 FD 15개였다. 이는 파일 핸들 고갈과 정책
읽기 실패의 연결을 뒷받침하며, 특정 코드의 누수나 Blabee 귀책까지 증명하지 않는다.
사용자가 네트워크 권한을 직접 해제했다는 근거도 없다.

핸들 증가 원인은 별도 추적 대상으로 남는다. 이번 버전 등록으로 이 오류가 해결됐다고
판정하지 않는다. 실행 중인 앱·세션 종료, 설정 변경, 시스템 한도 변경은 하지 않았다.

작업 시작 사본·공식 원본·검사 보고서·격리 native fixture:
`/private/tmp/blabee-codex-0160-20261005-nhd6_s8b/`.
