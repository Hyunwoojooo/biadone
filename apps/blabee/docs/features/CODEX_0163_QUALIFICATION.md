# Codex 0.163.0 호환성 갱신

2026-10-16, macOS arm64. 공식 release API의 최신 안정 버전은 0.163.0이며,
공개 시각은 2026-10-15 21:30:38 UTC다. 0.162.1 이후의 안정 버전 목록도 대조했다.
Swift 컴파일·테스트와 앱 빌드·설치는 실행하지 않았다.

## 변경

- 일반 Plugin CLI·관리형 App Server capability matrix, Hook 일회성 승인 profile,
  managed runtime catalog, 서버 소유 workspace 라우팅, 별도 update lifecycle에
  정확한 0.163.0을 등록했다.
- 공식 패키지는 patched `zsh`를 제거했다. 이제 41개 파일·8개 디렉터리이며 native
  파일은 29개다. 패키지 검사기는 **0.163.0 arm64에만** 이 구성을 적용한다.
  기존 voice 포함 42파일·legacy 5파일은 여전히 `zsh`를 요구한다.
- 이전 패키지와 섞인 `zsh`, 필요한 파일이 없는 구버전, 미등록 버전·target의
  41/42파일 voice 구성은 실제 후보 실행 전에 거부한다. voice manifest·파일 해시·
  서명·공증 조건은 유지한다.
- Swift catalog의 파일별 digest와 전체 fingerprint, voice JSON fixture 및 버전별
  지원·미지원 회귀 기대값을 갱신했다. Doctor는 기존 공통 정책을 계속 참조한다.

Engine·Claude·공통 UI, 사용자의 설정·인증정보·실행 중인 앱·세션·DB는 변경하지
않았다. commit·push도 하지 않았다.

## 공식 패키지 근거

출처: [공식 0.163.0 release](https://github.com/openai/codex/releases/tag/rust-v0.163.0).
다음 SHA-256은 단일 실행 파일 archive가 아닌 전체
`codex-package-aarch64-apple-darwin.tar.gz`의 값이다.

| 항목 | 확인한 값 |
| --- | --- |
| archive 크기 | 133,412,281 bytes |
| archive SHA-256 | `b0344fc2e41f15e0071147e5869008047b8ff4bf2c4a8897975d3bae3f103b34` |
| primary native CDHash | `5a4eec85679683d4b137579cb2555fe0b42a02dd` |
| signing Team ID | `2DC432GLL2` |
| managed fingerprint | `8455dbc0e6ca06359af0b7bf675767273c063ed92fa7a881380efc34771836b8` |

GitHub API의 크기·digest를 다운로드와 대조한 뒤 모든 파일 해시를 계산했다.
native 29개는 서명·공증과 arm64 아키텍처를 확인했다. fingerprint는 manifest와
49개 entry의 경로·종류·digest·실행 분류·Team ID·CPU type을 길이 구분 직렬화한
결과다. 기존 0.162.1의 52개 entry와 catalog fingerprint를 재현하여 계산 방식을
대조했다. 별도 검토에서도 archive·catalog·fixture·fingerprint가 일치했다.

## 공식 소스 비교

0.162.1(`7a078f6`)과 0.163.0(`129b8ec`)를 비교했다.

- Hook schema·event·command runner·output parser는 동일하다. `Allow`는 계속
  일회성 `Approved`로 변환하며, `ApprovedForSession`만 세션 승인 cache를 만든다.
  제거된 승인 분기는 폐기된 patched-zsh 경로다. 현재 명령·cwd·session·turn 결합을
  유지한다. [승인 처리](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/approvals.rs).
- Plugin CLI는 stdout flush와 BrokenPipe 처리를 개선했으며 JSON 계약은 유지한다.
  queue CLI·service·store와 영수증 문자열도 동일하다.
  [Plugin CLI](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/cli/src/plugin_cmd.rs),
  [queue](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/session_queue_commands.rs).
- MCP SDK는 rmcp 3.5.1로 갱신됐다. sandbox launcher 메타데이터는 MCP 서버가
  별도 실험적 capability를 선언해야 제공된다. Blabee의 tools-only 응답이나
  `2025-06-18` stdio 프로토콜을 바꿀 필요는 없다.
  [MCP 메타데이터](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/README.md).
- 이번 기본값 변경은 `CodeModeInterrupt`의 활성화다. `InstantInterrupt`는 이미
  0.162.1에서도 활성화돼 있었다. 호출 대기 취소가 저장 취소를 뜻하지 않으므로,
  기존 MCP 응답 미확인 시 자동 재전송 금지를 유지한다.
  [기능 기본값](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/features/src/lib.rs).
- remote TUI는 workspace roots를 서버가 결정하게 하며, resume 시 권한 override를
  임의로 주입하지 않는다. 관련 함수는 이전 버전과 동일하다. 새 cold resume는
  자기 thread의 저장된 설정을 복원하면서 현재 managed requirements를 다시 적용한다.
  [remote 세션](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/app_server_session.rs),
  [복원 처리](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_processor.rs).
- 기본 thread unload 대기가 60초에서 1,800초로 바뀌었지만 Blabee 업데이트 런타임은
  명시적으로 0을 사용한다. 기존 종료 지연 WARN의 정확한 조건도 유지된다.
  unsubscribe ACK·모든 thread/closed·양쪽 EOF·exit 0·저장 root·40초 제한은 그대로다.
  새 MAv2 child eviction도 shutdown 성공 뒤에만 closed를 보낸다. 이 child 경로는
  소스로 확인했으며 root-only native 검사로 검증했다고 간주하지 않는다.
  [종료 수명](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs).
- connection-bound reply handle은 원래 연결과 요청 ID에 한 번만 응답하는 Rust 내부
  개선이다. 신규 read-state RPC도 기존 Swift 요청 추적·통과 처리와 양립한다.
  압축 기록·writer lock 핵심 구현은 이전 버전과 동일하다.

## 실행 검증

- Node/Python 회귀 **228/228 통과**. 새 41파일 구성과 구버전 42/5파일 유지,
  서명·공증·manifest 실패 및 미등록 버전·target의 voice 구성 거부를 포함한다.
- 공식 런타임 **69개 native smoke 통과**. native 29파일의 서명·공증 58검사를
  모두 마친 뒤 정확 버전, Plugin 조회·격리 설치·제거, queue 도움말을 확인했다.
  검사 수가 이전 71개보다 줄어든 이유는 제거된 `zsh`의 서명·공증 2검사다.
- 네트워크·사용자 홈 접근을 OS에서 차단한 공식 native App Server의 **5단계**를
  통과했다. workspace-write 시작 → 같은 UUID/cwd로 cold resume → `.jsonl.zst`
  압축 기록 복원, read-only 시작 → 테스트 전용 기본 설정을 workspace로 바꾼 뒤
  override 없는 cold resume에서도 저장된 read-only 권한 유지를 확인했다.
  workspace의 추가 writable root·네트워크 차단·tmp 제외 설정도 유지됐다.
- 각 단계에서 unsubscribe ACK·해당 `thread/closed`·stdout/stderr EOF·exit 0을
  모두 확인했다. 저장 단계는 종료 후 `thread_settings_applied`의 실제 권한·cwd를
  검사했고, 압축 복원에서는 원래 JSONL 내용이 보존됐는지 대조했다.
- 같은 격리 실행에서 공식 rmcp 클라이언트와 tools-only 테스트 서버의
  `initialize`·`tools/list`·`tools/call`, text/structuredContent 응답을 확인했다.
  모델 turn은 제출하지 않았고 테스트 서버의 종료도 확인했다. 실제 Blabee
  proposal이나 사용자 queue를 전송한 검사는 아니다.

추가 native 보고서는 증거 폴더의 `native-compat-t05sigut/result.json`이다.
첫 시도인 `native-compat-q62j0lvq/result.json`은 검사 코드가 동일 설정 저장에도
변경 알림을 기다려 실패했다. 공식 코드는 설정이 달라질 때만 알림을 보내므로
대기를 바로잡았으며, ACK만으로 저장 완료를 판단하지 않고 위의 종료·디스크·복원
검사를 유지했다. [설정 알림 조건](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/bespoke_event_handling.rs).
사용자 홈 차단에 따른 skill scan ERROR는 pause 이전에 발생했다. 제품 observer와
같이 저장 관련 진단은 항상 실패로, 나머지 ERROR는 freeze 이후에 실패로 판정했다.
홈 접근 차단을 해제하거나 제품의 종료 판정을 완화하지 않았다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

기본 도구 sandbox 안의 코드 서명 검사는 실패했고, 허가된 별도 실행에서 공식
동일 파일의 서명·공증 검사를 통과했다. 이 환경 제한을 제품 또는 archive 결함으로
분류하지 않았다. source snapshot, 공식 원본, 검사 보고서는
`/private/tmp/blabee-codex-compat-20261016-q9cbcqay/`에 있다.

Swift 제품 inspector·private runtime·remote TUI의 실행, 설치된 앱의 Hook ancestry,
Hook → Pet 승인·선택 → queue → 실제 완료, 중단과 durable write의 경쟁 상황,
실제 앱 업데이트 복원은 별도 검증이다. 음성 처리·모델 응답도 검사하지 않았다.
소스 변경은 아직 설치된 앱에 적용하지 않았다.
