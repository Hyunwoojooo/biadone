# Codex 0.164.0 호환성 갱신

2026-10-24, macOS arm64. 공식 최신 안정 버전은 0.164.0이며 공개 시각은
2026-10-23 04:48:10 UTC다. 0.163.0 이후 안정 버전 목록과 공식 전체 패키지를
확인했다. Swift 컴파일·테스트와 앱 빌드·설치는 실행하지 않았다.

## 변경

- 일반 Plugin CLI·관리형 App Server capability matrix, Pet 일회성 승인 caller
  profile, 전체 runtime catalog, 서버 소유 workspace 라우팅과 별도 update
  lifecycle에 정확한 0.164.0을 등록했다.
- 0.164.0 arm64의 41파일·29 native 구성을 패키지 검사기에 등록했다. 이전
  0.163.0 구성과 구버전 42/5파일의 필수 `zsh`는 유지한다. 0.164.0에 `zsh`를
  섞거나 미검토 0.164.1·0.165.0 및 다른 target에 voice 구성을 적용하면 거부한다.
- 파일별 digest·전체 fingerprint·공식 voice JSON fixture와 지원·미지원·alpha
  회귀 기대값을 함께 갱신했다. Doctor는 기존 공통 버전 정책을 사용한다.
- `DoctorHookTrustInspector`의 read-only 주석과 `PetHookReadiness`의 읽기 전용·
  실패 시 신뢰 정보 미변경 안내를 바로잡았다. 검사 전·진행 중·실패 시 Codex가
  기존 Hook 신뢰 정보를 갱신할 수 있음을 알린다. 공식 검사 경로, 신뢰 판정,
  사용자 요청 조건은 유지한다. 복합 hash의 trusted 수용·modified 거부 회귀도 추가했다.

Engine·Claude·공통 UI 구현, 사용자 설정·인증정보·실행 중인 앱·세션·DB는
변경하지 않았다. 신뢰 해시 직접 작성·신뢰 검사 우회·자동 승인 흐름을 제품에
추가하지 않았다. commit·push도 하지 않았다.

## 공식 패키지와 신뢰 근거

출처: [공식 0.164.0 release](https://github.com/openai/codex/releases/tag/rust-v0.164.0).
단일 실행 파일 archive가 아닌 `codex-package-aarch64-apple-darwin.tar.gz`를 사용했다.

| 항목 | 확인한 값 |
| --- | --- |
| annotated tag object | `fe3b29455488c2e189e43ad5526a107900c5e1b7` |
| source commit | `6aaac694803004a63c6f393d153c96d22521a6b9` |
| archive 크기 | 136,007,998 bytes |
| archive SHA-256 | `dd99e9092270691a67bdde7be04ac283dea9da8e86cbde356c2cc851a79205fa` |
| primary native CDHash | `3a7d7f1461a52f92f4a4fdc2cc70fc06bee91285` |
| signing Team ID | `2DC432GLL2` |
| managed fingerprint | `d517a3752fe11e23aae487b07d6a9699b55031bc118253159c8d23bd26c01fb3` |

다운로드 크기·SHA-256을 공식 API와 대조했다. 41개 파일의 해시와 voice manifest의
37개 해시를 검증했으며, native 29개는 arm64와 Team ID를 확인하고 서명·공증
검사 58개를 통과했다. voice `runtime.json`의 원본 바이트·실행 권한을 보존했다.
정확한 catalog digest와 경로를 가진 이 JSON만 기존 정책대로 데이터로 분류한다.

전체 fingerprint는 manifest와 49개 entry(41파일·8디렉터리)의 경로·종류·digest·
실행 분류·Team ID·architecture를 길이 구분 직렬화한 SHA-256이다. 기존 0.163.0
catalog fingerprint를 재현해 계산 방식을 대조했고, 별도 QA에서도 새 fingerprint와
archive·파일 digest·fixture를 독립 확인했다. Swift inspector 실행 증거는 아니다.

## 공식 소스 비교와 Hook 신뢰 변경

0.163.0과 0.164.0 공식 소스를 비교했다.

- Plugin CLI와 queue CLI·receipt 계약은 유지된다. 릴리스의 pending permission
  selection 대기는 TUI의 `/permissions` 프로필 선택 확인을 뜻하며, Blabee Pet의
  PermissionRequest 선택이나 ref claim 규칙을 바꾸는 내용이 아니다.
  [queue 처리](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/session_queue_commands.rs).
- Hook JSON의 기존 이벤트·`additionalContext`와 `Allow → Approved` 일회성
  승인은 유지된다. `ApprovedForSession`만 세션 승인 cache를 만든다. 추가된
  모델 Hook은 Blabee의 기존 네 Hook을 변경해야 하는 요구가 아니다.
  [승인 처리](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/approvals.rs).
- 새 Plugin Hook 신뢰 검증은 선언 해시와 전체 Plugin 내용 해시를 함께 사용한다.
  기존 선언 승인이 유효하지만 내용 기준이 없는 경우 `hooks/list`도 사용자 config
  디렉터리의 `.hook-trust` 기준 파일을 생성할 수 있다. 검사 실패·시간 초과가
  발생했다는 사실만으로 파일이 전혀 바뀌지 않았다고 보장할 수 없다.
  [신뢰 이전](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/plugin_trust.rs),
  [목록 discovery](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/discovery.rs).
- 기존 승인에는 마이그레이션 경로가 있으며 모든 사용자의 재승인을 요구하지 않는다.
  이후 Plugin 내용이 달라져 modified가 되면 `/hooks`에서 다시 검토해야 한다.
  Blabee installer는 공식 Plugin CLI를 사용하고 자체 신뢰 hash를 생성하지 않는다.
  Doctor parser는 새 복합 hash를 수용할 수 있으며 Codex의 trust status를 따른다.
- MCP enterprise OAuth는 별도 인증 분기다. Blabee 로컬 tools-only stdio에 새
  인증 필드를 요구하지 않는다. rmcp 3.5.1 표기는 같지만 revision이
  `4048ac40…`에서 `98a54789…`로 바뀌어 별도 실제 MCP 검사를 수행했다.
- remote workspace·resume 인자와 종료 ACK/closed/EOF 계약은 유지된다. thread별
  unload 설정을 사용하도록 바뀌었지만 서버 CLI override가 유지되어 Blabee의
  `thread_unload_delay_secs=0` 설정을 바꿀 근거는 없다. 종료 장벽을 완화하지 않았다.
- 압축 복원은 소유권·mode·macOS ACL을 보존하도록 바뀌었다. 저장된 모델 설정
  복원과 여러 subcommand의 `-c` 병합도 개선됐다. Blabee가 native에 위임하는
  기존 구조를 유지한다. [압축 복원](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/rollout/src/compression/access_metadata.rs),
  [설정 병합](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/cli/src/config_override_args.rs).

## 실행 검증

- Node/Python 회귀 **233/233 통과**. 아래 실행 범위이며 패키지·native harness 입력
  검사의 **89/89는 이 수치에 포함**된다. Swift 회귀 코드는 갱신했지만 실행하지 않았다.
- 공식 런타임 **69개 smoke 통과**: native 29파일의 서명·공증 58검사를 모두 마친 뒤
  정확 버전, Plugin 조회·격리 설치·제거, queue 도움말을 확인했다.
- 네트워크·실제 사용자 홈을 OS에서 차단한 native App Server **5단계 통과**:
  workspace-write 시작 → 동일 UUID/cwd cold resume → 압축 기록 resume,
  read-only 시작 → 테스트 기본 설정을 workspace로 바꾼 뒤 override 없는 resume.
  추가 writable root·network false·tmp 제외 정책과 저장된 read-only 권한을 확인했다.
- 각 단계의 unsubscribe ACK·해당 thread/closed·stdout/stderr EOF·exit 0과 강제
  정리 없음이 확인됐다. 동일값 settings/update 알림을 기다리지 않고, 종료 후
  실제 `thread_settings_applied`에 저장된 권한·cwd를 검사했다.
- 압축 fixture는 테스트가 zstd로 만들었다. native 복원에서 원본 JSONL 내용과
  mode `0640`·uid/gid·명시적 `everyone deny execute` ACL의 보존을 확인했다.
- 공식 MCP 클라이언트와 inert tools-only 서버의 initialize·tools/list·tools/call,
  text/structuredContent 응답과 자식 종료를 확인했다. 모델 turn·실제 proposal·
  사용자 queue는 전송하지 않았다.
- 별도 inert Plugin의 Hook 신뢰 native 검사 **16개 통과**: 신규 미신뢰 상태,
  기존 선언 승인에서 내용 기준 파일 생성, 일부 Hook이 modified여도 기준 파일은
  생성되는 상황, 전체 legacy 신뢰, 공식 config/batchWrite를 통한 승인·재승인,
  Plugin 내용 변경 후 modified 판정을 확인했다. 원본 runtime은 유지됐고 검사에
  사용한 다섯 자식 프로세스가 강제 정리 없이 exit 0으로 종료됐다.

Hook 검사는 테스트 전용 설정에만 과거 승인 형식을 만들었다. 네 Hook 중 세 개는
trusted·하나는 modified인 상태에서 `.hook-trust` 생성이 관찰되어, 전체 신뢰 확인에
실패해도 신뢰 정보 이전은 이미 일어날 수 있음을 확인했다. RPC timeout·비정상 응답·
중단 경쟁 상황을 재현한 것은 아니며, 실제 Hook 명령이나 사용자 작업도 실행하지 않았다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

도구 sandbox 안에서는 첫 서명 검사가 실패했고, 허가된 별도 실행에서 같은 공식
파일의 모든 서명·공증 검사가 통과했다. 이 첫 시도를 성공 증거에 포함하지 않았다.

공식 원본·검토 자료: `/private/tmp/blabee-codex-review-20261024-kwn2s8a6/`.
이번 baseline·검사 자료: `/private/tmp/blabee-codex-0164-update-kr850o6i/`.
주요 결과는 `native-qualified-0.164.0.json`, `regression.tap`,
`native-compat-524a8vxg/result.json`, `hook-trust-fixture-jih5vp6a/result.json`이다.

## 검증 경계

Swift 컴파일·실행, 제품 private runtime·remote TUI, 설치된 앱의 Hook ancestry,
Hook → Pet 승인·선택 → queue → 실제 완료, 실제 앱 업데이트 왕복은 별도 검증이다.
MAv2 child 종료, saved service tier·reasoning summary·personality, 다단계 `-c`
병합은 이번 native fixture가 직접 다루지 않는다. 음성·모델 응답도 검사하지 않았다.
소스 변경은 설치된 앱에 아직 적용하지 않았다.
