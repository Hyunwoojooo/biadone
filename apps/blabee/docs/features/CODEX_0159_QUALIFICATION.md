# Codex 0.158.0·0.159.0·0.159.1·0.159.2 지원 검증

2026-09-30, macOS arm64. 공식 최신 안정 버전은 0.159.2다. 이전 지원 이후 발표된
네 안정 버전의 Codex 브릿지 소스·회귀 정의·공식 패키지 신뢰 자료를 추가했다.
이번 작업에서는 Swift 컴파일·테스트, 앱 빌드·설치와 commit·push를 하지 않았다.

## 지원 변경

- `CodexCompatibility`: 네 버전의 Plugin CLI와 관리형 App Server capability 등록.
  Doctor는 공통 정책을 참조하므로 별도의 중복 버전 목록을 만들지 않는다.
- `HookPermissionPolicy`: 공식 primary `bin/codex`의 버전별 CDHash 등록.
  실제 Hook 호출자 식별, 세션·턴·명령·cwd 결합 및 일회성 승인 조건은 유지한다.
- `CodexRuntimeBundle`: 버전별 42개 파일 digest, 10개 디렉터리 및 전체 fingerprint 등록.
  voice JSON의 실행 비트 예외도 정확한 경로와 공식 digest가 일치할 때만 적용한다.
- `ManagedCodexLauncher`: 서버가 workspace 설정을 소유하는 정확한 버전 분기 확장.
  전체 TOML table과 하위 key의 CLI 설정을 원문·순서 그대로 primary/aux 서버로 전달한다.
- `UpdateManagedCodexProfile`: 별도 저장·종료·재개 지원 목록에 네 버전 등록.
- 패키지 검증기와 fixture: 네 버전의 arm64 voice 포함 전체 구성을 명시적으로 등록.

미등록 patch·다음 minor·prerelease는 자동 허용하지 않는다. 기존 capability와 catalog,
literal 인수, fallback 인수, `--add-dir`·`--no-daemon` 및 workspace override와
`--profile` 혼용의 사전 거부 정책을 유지한다. Engine·Claude 구현은 변경하지 않았다.

## 공식 패키지 근거

| 버전 | arm64 archive SHA-256 | primary native CDHash |
| --- | --- | --- |
| 0.158.0 | `09f2a9fde318fbcd384f15b4850c1b90930678f4805647b6bded196ccf32f590` | `7c6ad5b6e049dbb4f6599fd32fea9181bac6cb86` |
| 0.159.0 | `7748d07d7921a67b91d015e9d0f43177c675977e67f955b2f8fb96dc880dd5d7` | `1479dac62b926f92b397043512f50ef17509a114` |
| 0.159.1 | `a8fc76ccb5230dd97fb6db01873fa9c12b5e1efdf32d13c2ba7f6e8489ccd893` | `5dee39e9a5f61fd86c84a3edac863120ca2f09c6` |
| 0.159.2 | `38aaf6dce63099fd10988948d03bbc6c0474253aef6961fcbe60f8d154b39101` | `baf27fc34f7af7acd514bfaa7c7b7313d723da0b` |

GitHub release API의 archive 크기·SHA-256을 실제 다운로드와 대조했다. 각 패키지의
native 30개 파일에 Apple anchor/OpenAI Team ID/identifier 검증과 공증 검사를 적용한
뒤 native CLI를 실행했다. 원본 패키지 bytes·권한은 변경하지 않았다.

출처: [0.158.0](https://github.com/openai/codex/releases/tag/rust-v0.158.0),
[0.159.0](https://github.com/openai/codex/releases/tag/rust-v0.159.0),
[0.159.1](https://github.com/openai/codex/releases/tag/rust-v0.159.1),
[0.159.2](https://github.com/openai/codex/releases/tag/rust-v0.159.2).

전체 managed fingerprint:

- 0.158.0: `c1d34a32761e1c6e6548c009a8af242ce91b60695e9a6f347db3ae61b87d490c`
- 0.159.0: `ee1402b1cd2d00c734557bb02422fe0c80518a978bee481e9313ea5faa5ca77c`
- 0.159.1: `2daa378b3bbe94aeaf45c389d4ec68328b3793502689c2702cf9e6c4de0df4d2`
- 0.159.2: `5ceec30c6abdef67db6df3faca91915574fccb89f6569e37afecb33289a1a05d`

Swift의 길이 구분 직렬화로 manifest와 52개 entry를 계산했다. 기존 0.157.0·0.157.1의
공식 패키지로 현재 catalog의 파일 digest·entry·fingerprint를 먼저 재현했다.
이 값은 Node smoke 보고서의 snapshot fingerprint와 구분한다.

## 새 버전 동작과 유지한 계약

공식 0.157.1 소스를 기준으로 네 버전의 Hook·승인·Plugin·MCP·queue 및 관리형
App Server 계약을 대조했다. `PermissionRequestDecision::Allow`는 계속 일회성
`ReviewDecision::Approved`로 변환된다. 지속 승인인 `ApprovedForSession`으로
확대하지 않으며, Blabee도 기존 native `default`/Bash 명령 승인 범위를 유지한다.
[승인 처리](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/core/src/tools/approvals.rs).

0.158부터 터미널 입력 승인 기능 `write_stdin`이 기본 활성화됐다. Hook의
`tool_name=write_stdin` 및 App Server의 `kind=writeStdin`은 현재 Pet 명령 승인
범위에 들어가지 않는다. 기존 정책대로 Codex 기본 승인으로 전달한다. 관리형 router의
byte-exact 전달 회귀가 이미 있으며, 새 종류를 Bash 명령으로 오인하여 허용하지 않는다.
입력 내용·프로세스·세션에 대한 Pet 전용 승인 UI를 추가한 것으로 보고하지 않는다.

Hook의 Unix 실행기가 POSIX spawn 계열과 새 session 생성 방식으로 바뀌었지만 공개
payload 계약은 유지된다. Blabee는 여전히 실제 호출 조상의 서명·CDHash를 확인한다.
새 기본 daemon을 기존 daemon과 바꾸거나 재시작하지 않는다. fresh/reused daemon에서의
실제 Hook ancestry·환경·MCP 연결은 별도 실사용 검증 대상이다.

0.159의 즉시 중단 기능은 기본 비활성화다. 승인 재시도와 파일 접근 거부 보존 변경도
현재 command 승인 wire를 바꾸지 않는다. 공개 소스의 helper 추가만으로 실제 승인 후
파일 접근 제한이 실행 검증됐다고 판단하지 않는다. 관련 native 동작은 격리된 승인
통합 검증 대상으로 남기며, Blabee의 요청 결합·취소·권한 확장 거부를 완화하지 않는다.

0.159의 Codex 자체 자동 후속 프롬프트 제거는 Blabee Plugin의 Hook/MCP/queue 계약과
별개다. Blabee 선택 메시지나 ref 검증 방식을 변경할 근거는 발견하지 못했다.
0.159.1 모델 목록 변경과 0.159.2 Windows console 수정 때문에 사용자 모델·설정을
바꾸지도 않는다. [공식 변경 기록](https://learn.chatgpt.com/docs/changelog#month-2026-09).

관리형 explicit `--remote`는 자동 daemon 시작에서 제외된다. remote의 workspace는
서버 소유이며 기존 CLI 라우팅을 새 버전에도 적용한다. initialize 필수 wire,
unsubscribe/closed 및 rollout recorder/writer lock 계약은 유지된다.
[시작 검사](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/tui/src/startup_orchestration.rs),
[종료 처리](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/app-server/src/request_processors/thread_lifecycle.rs).

0.159의 빈 thread 변경은 archive 전에 기록을 저장하는 보완이다. 일반 종료만으로
빈 thread가 항상 저장되는 것은 아니다. Blabee는 실제 기록 파일 확인과
`thread/closed`·stdout/stderr EOF·exit 0 조건을 유지한다. 압축 rollout을 이유로
plain `.jsonl` 경로·소유권·파일 검사를 생략하지 않는다.

## 실행한 검증

- 빌드 없는 Node/Python 회귀 **199/199 통과**: 계약·Plugin 144개,
  패키지/lifecycle 검증기 55개. 테스트 파일을 직렬 실행했다.
- 수정한 제품 패키지 검사기로 공식 네 버전 각각 **71개 account-free smoke 통과**.
  전체 layout·voice manifest, native 30파일 서명·공증, 정확한 버전,
  격리된 Plugin 0.1.3 설치·조회·제거, queue 도움말을 확인했다.
- 최신 **0.159.2의 격리된 native lifecycle 통과**: 새 테스트 세션을 metadata 작업으로
  저장한 뒤 unsubscribe/closed, stdout/stderr EOF와 exit 0을 확인했다. 새 프로세스에서
  동일 UUID/cwd를 재개하고, `.jsonl.zst`만 남긴 상태에서도 plain 기록 복원과 원본
  prefix bytes 보존을 확인했다. 세 단계 모두 workspace roots와 networkAccess=false가
  유지됐다. OS에서 네트워크·사용자 홈 접근을 차단했고 모델 turn은 보내지 않았다.
  0.158.0·0.159.0·0.159.1의 같은 추가 검사는 실행 요청 지연으로 결과를 확보하지
  못했다. 이 세 버전의 lifecycle은 소스 비교·회귀 정의 범위이며 실제 실행 통과로
  집계하지 않는다.
- Swift 회귀 정의에 새 버전 허용, 미등록 버전 거부, private runtime 봉인·변조 거부,
  workspace 전달 및 primary/aux 동작 범위를 추가했다. 기존 Hook profile 순회 검사도
  새 네 버전을 대상으로 한다. **Swift 컴파일·테스트는 실행하지 않았다.**
- 독립 정적 QA에서 네 패키지의 42파일 digest·52entry fingerprint와 CDHash를
  실제 파일에서 다시 계산·대조해 일치를 확인했다. 기존 7개 catalog Record와
  0.157 지원 기록은 시작 사본과 바이트 단위로 동일하다. 변경 범위의
  `git diff --check`도 통과했다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs
node --test --test-concurrency=1 \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

## 남은 실사용 검증

설치된 Blabee의 실제 Swift private runtime/remote TUI, fresh/reused daemon에서
Hook → Pet 일회성 승인·선택 → queue 실행·완료, 실제 업데이트 복원은 별도 확인이
필요하다. 패키지 smoke와 fixture 통과가 이 과정을 증명하지 않는다. 새로운 terminal
input 승인 및 approval retry/취소·파일 접근 거부 보존도 실제 native 승인 통합 검증
대상이다. 음성 캡처·처리와 모델 완료는 검사하지 않았다.

기존 tool Hook cwd와 session cwd 차이에 대한 fail-closed 결합은 유지한다. 앞서
발생한 카드 선택 검증 시간 초과가 이번 버전 등록으로 해결됐다고 판정하지 않는다.

이번 작업의 시작 사본·공식 원본·소스 비교·검사 결과:
`/private/tmp/blabee-codex-latest-20260930-6M2xus/`.
실행 중인 사용자 앱·Codex 설정·세션·DB는 변경하지 않았다.
