# Codex 0.160.1–0.162.1 지원과 종료 경고 수정

2026-10-11, macOS arm64. 공식 release API를 다시 조회하여 최신 안정 버전이
0.162.1임을 확인했다. 공개 시각은 2026-10-09 19:44:51 UTC다. 10월 10일에 수행한
읽기 전용 호환성 검토와 격리 실행 증거를 바탕으로, 10월 11일 지원 목록과 오류
판정을 수정했다. Swift 컴파일·테스트와 앱 빌드·설치는 실행하지 않았다.

## 발견과 수정

1. **새 버전의 지원 등록 누락.** 기존 일반 Plugin·관리형 App Server·업데이트
   lifecycle은 0.160.0까지 등록돼 있었다. 0.162.0·0.162.1에는 별도 작업으로
   Hook 승인 CDHash만 추가된 상태였다. 이번에는 0.160.1·0.161.0·0.162.0·0.162.1의
   capability matrix, 전체 runtime catalog, 서버 소유 workspace 라우팅, lifecycle
   profile과 패키지 검사기를 함께 갱신했다. 누락된 두 Hook profile도 추가했다.
2. **정상적인 종료 지연 경고를 저장 실패로 오인.** Codex 0.162의 App Server는
   thread 종료가 10초를 넘으면 `codex.app_server.thread_shutdown_slow` WARN을 쓰고
   같은 종료 작업을 계속 기다린다. 기존 observer는 메시지의 `shutdown` 단어만으로
   영구 실패를 기록했다. 따라서 40초 pause 제한 내에 정상 종료해도 업데이트를
   거부할 수 있었다. 정확한 WARN·로그 target·event·정규 UUID·전체 메시지가 일치할
   때만 진행 상황으로 처리하도록 고쳤다. 이는 공식 소스와 분기 조건으로 확인한
   결함이며, 실제 10초 이상 지연을 일으켜 실행 재현한 결과는 아니다.

경고는 종료 성공으로 취급하지 않는다. unsubscribe 응답, 모든 thread의
`thread/closed`, stdout·stderr EOF, exit 0 및 저장 root 검증을 계속 요구한다.
실제 저장 오류와 이미 기록한 실패, 40초 제한도 유지한다. stdout·stderr 도착 순서가
달라도 같은 경고를 처리하며, 출처·레벨·이벤트·내용이 다른 종료 경고는 기존대로 거부한다.

[공식 종료 처리](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_lifecycle.rs).
로컬 변경: `bridges/codex/swift/update/UpdateManagedCodexObserver.swift`.

## 공식 패키지 식별

아래 SHA-256은 전체 `codex-package-aarch64-apple-darwin.tar.gz`의 값이다.
단일 실행 파일 archive와 구별한다. 공식 API의 digest·크기와 다운로드를 대조했고,
10월 11일에도 원본 archive·모든 파일 digest와 catalog fingerprint를 다시 계산했다.

| 버전 | 전체 archive SHA-256 | primary native CDHash |
| --- | --- | --- |
| 0.160.1 | `f73527ee09c6db869acbb37b709866b339ea74ef91d2de255e9c74ec960c6314` | `f69ce2618e3876c26d787ae6fab77376dcc9c6fc` |
| 0.161.0 | `f0feee8537daf8dd6b4e0a36e764549ad14afdbb419d8775aeab9feb20182313` | `59d668365cea9562058b3e42e3e2d4326db43b59` |
| 0.162.0 | `5809ee90a9c3b59d438bb2663aefa0b43d86f825438b65d4504b31f82343628b` | `5f410845b5189c21ca0aa20c2ef91293e3145b13` |
| 0.162.1 | `88e37ccddf5a0f4ea9dc1be13c66a2a94f9c2d1a04f3ace9053d71b3939e885d` | `9ddc61acceef79aa2aad437ba1fe94239f2e0423` |

출처: [0.160.1](https://github.com/openai/codex/releases/tag/rust-v0.160.1),
[0.161.0](https://github.com/openai/codex/releases/tag/rust-v0.161.0),
[0.162.0](https://github.com/openai/codex/releases/tag/rust-v0.162.0),
[0.162.1](https://github.com/openai/codex/releases/tag/rust-v0.162.1).

Swift catalog의 manifest 및 52개 entry를 묶는 fingerprint:

- 0.160.1: `0230997d8fc2c3950e2fe28f07548942b4662666958dd5079eb581922c35f8ee`
- 0.161.0: `26d0cccbb01790e6646f836c0c53afb73e6081626d254984b280a41c06d04652`
- 0.162.0: `5b0eedbe2ec32aa0e61e6ed4956b0a1c42db696613bdf004c55d3050581f4993`
- 0.162.1: `37d07b6af6cd84ff0953704fcd1b8c933b79c360a94d4ceeef5eb07ef77c6961`

10개 디렉터리와 42개 파일의 경로·종류·digest·실행 분류·서명 Team ID·CPU type을
기존 Swift 규약과 같은 길이 구분 형식으로 직렬화했다. 기존 0.160.0 catalog 값으로
계산 방식을 먼저 대조했다. voice `runtime.json` 데이터 예외는 정확한 경로와
해시를 계속 요구하며, 미등록 버전·target·prerelease를 자동 허용하지 않는다.

## 프로토콜·오류 경로 검토

- Hook 이벤트 schema, PermissionRequest 출력 해석, 일회성 `Allow` → `Approved`,
  queue 명령·영수증은 기존 계약을 유지한다. 세션·턴·명령·cwd 결합과 선택 ref 검증,
  만료를 완화하지 않았다. 파일 접근 거부 정책은 승인 뒤에도 Codex가 적용한다.
- remote TUI는 workspace 설정을 App Server에 맡기며, resume에는 저장된 권한과
  provider를 사용한다. 기존 명시적 CLI override 전달 규칙을 네 버전에도 적용했다.
- 0.161의 MCP 라이브러리 갱신과 0.162의 pagination 처리는 Blabee의 stdio MCP
  protocol `2025-06-18` 및 단일 페이지 tool 목록과 양립한다. 아래의 격리 native
  MCP 왕복으로 초기화·목록·호출을 추가 확인했다.
- 재개 충돌 감지는 정확한 요청 ID·thread ID·오류 형식을 계속 요구한다. 업데이트
  대기와 stderr 핸들 정리에서도 이번 경고 오분류 외의 추가 확정 결함은 찾지 못했다.

[승인 변환](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/tools/approvals.rs),
[remote 세션](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/tui/src/app_server_session.rs),
[MCP 처리](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/mcp_processor.rs).

## 검증 결과와 한계

- **10월 11일 Node/Python 회귀 223/223 통과.** 새 버전의 정상 패키지와 누락·추가
  파일, manifest 불일치, 서명·공증 실패, 미등록 버전·target 거부를 포함한다.
- **10월 10일 공식 네 패키지 각각 71개 native smoke 통과.** 42파일 구성,
  native 30파일의 Apple anchor·OpenAI Team ID·identifier·공증, 정확 버전,
  격리 Plugin 0.1.3 설치·조회·제거 및 queue 도움말을 확인했다. 당시 임시 복사
  검사기에만 새 버전을 등록했다. 이번 제품 검사기는 그 복사본과 실행 로직이 같고,
  저장소 root를 찾는 코드만 원래의 상대 경로 방식을 사용한다.
- **네 버전 모두 native 저장·종료·재개 통과.** 새 임시 폴더에서 빈 thread를
  metadata 작업으로만 저장하고, 동일 UUID/cwd 재개와 `.jsonl.zst` 복원을 확인했다.
  start·cold resume·compressed resume의 workspaceWrite·추가 writable root·
  networkAccess=false·임시 폴더 제외 정책과 원본 기록 prefix도 유지됐다.
- **네 버전 모두 native MCP 초기화·목록·도구 호출 통과.** 네트워크와 사용자 홈
  접근을 차단한 App Server에 무해한 임시 echo 서버만 연결했다. 실제 initialize →
  tools/list → tools/call, 연결 상태, 고정 nonce 응답과 정상 App Server 종료를
  확인했다. MCP 자식은 TERM으로 정리됐으며 stdin EOF 종료를 입증한 것은 아니다.
- **Swift 회귀 추가·확대, 실행은 미수행.** 종료 지연 경고 13사례와 버전별 호환성,
  workspace 라우팅, 서명 교차 조합, voice 데이터 예외 및 lifecycle 기대값을 갱신했다.
  Doctor 테스트는 공통 지원 정책을 사용하므로 중복 목록을 추가하지 않았다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

native 실행은 모델 turn·사용자 proposal·실제 queue 전송을 하지 않았다. 기본 도구
sandbox의 codesign·중첩 sandbox 제한은 별도 허가된 실행으로 구별했다.
이번 변경은 소스에 반영됐으며 설치된 앱에는 아직 적용하지 않았다.
Swift 컴파일·테스트, 설치된 앱의 private runtime·remote TUI·실제 Hook ancestry,
Hook → Pet 승인·선택 → queue 실행·완료, 앱 업데이트 복원은 별도 확인이 필요하다.
음성 캡처와 모델 응답도 검사하지 않았다.

이전에 발생한 `application network permission was revoked`의 핸들 고갈 원인을
이번 수정으로 해결했다고 판정하지 않는다. 실행 중인 앱·설정·세션·DB와 시스템 한도,
Engine·Claude 구현은 변경하지 않았다. commit·push도 하지 않았다.

원본·격리 실행·검토 증거: `/private/tmp/blabee-codex-review-20261010-b5n6v4ac/`.
작업 시작 사본·최신 release 조회·회귀 결과: `/private/tmp/blabee-codex-debug-20261011-71r7lcvv/`.
