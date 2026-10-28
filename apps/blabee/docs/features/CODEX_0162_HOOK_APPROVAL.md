# Codex 0.162.0·0.162.1 Hook 일회성 승인

2026-10-10, macOS arm64. 이 변경은 일반 Codex `PermissionRequest`의
Pet 일회성 승인 자격만 추가한다. 전체 Plugin CLI·관리형 App Server 지원이나
업데이트 종료·복원 검증으로 확대 해석하지 않는다.

## 비활성 원인

신고 화면에는 남은 시간이 약 5분인데도 `이번만 승인`이 비활성화돼 있었고,
일회성 승인이 검증되지 않았다는 안내가 표시됐다.

읽기 전용 확인 당시 설치된 Blabee는 r80이었다. 설치된 coordinator에는
0.160.0까지의 검증 CDHash가 있었으며, 아래 두 CDHash는 없었다. 현재 소스의
`HookPermissionPolicy`도 같은 범위였다. `allow_once_available=false`이면
Pet은 일회성 승인 버튼과 ⌘1을 사용할 수 없게 한다.

Homebrew의 `codex` 경로는 0.162.0이었지만, 실제로 Blabee helper를 자식으로
실행하는 Codex App Server는 별도로 설치된 0.162.1이었다. CLI 경로의 버전만
확인해서는 Hook을 처리하는 실행 파일의 버전을 알 수 없다. 관측 당시의
프로세스 관계이며 과거 스크린샷 각각의 프로세스를 소급 식별한 것은 아니다.

## 검증한 공식 실행 파일

공식 GitHub release API의 archive 크기·SHA-256을 다운로드와 대조했다.
아래는 **단일 실행 파일** `codex-aarch64-apple-darwin.tar.gz`의 값이다.
두 실행 파일은 이 Mac의 각각의 설치 파일과 SHA-256이 일치했다.

| 버전 | archive SHA-256 | native CDHash |
| --- | --- | --- |
| 0.162.0 | `98e9413a1bd167ae573723939ff178e6d44f1bb21d5cda960dbeb2fa65f49104` | `5f410845b5189c21ca0aa20c2ef91293e3145b13` |
| 0.162.1 | `b293a0fcdd871900a44c0a4f40a1aa401b31e02854f790ebdb8bd5d1177fd1fe` | `9ddc61acceef79aa2aad437ba1fe94239f2e0423` |

`codesign --verify --strict`에서 Apple anchor, identifier `codex`, OpenAI Team ID
`2DC432GLL2`, 위 CDHash를 모두 요구해 통과했다. 처음에는 도구 샌드박스의
서명 검사가 실패했고, 승인된 읽기 전용 검사로 재확인했다. 실행 파일 자체를
실행하거나 설치·교체하지 않았다.

출처: [0.162.0 release](https://github.com/openai/codex/releases/tag/rust-v0.162.0),
[0.162.1 release](https://github.com/openai/codex/releases/tag/rust-v0.162.1).

## 승인 범위 검토

공식 소스 tag 0.160.0(`79b1b66`), 0.162.0(`1f3f934`),
0.162.1(`7a078f6`)를 비교했다.

- `PermissionRequest` 입력·출력 schema, 이벤트 처리, output parser,
  `core/src/hook_runtime.rs`, `core/src/tools/approvals.rs`의 승인 경로를 확인했다.
  `Allow`는 계속 `ReviewDecision::Approved`로 변환한다.
- 세션 단위 승인 cache는 `ApprovedForSession`일 때만 기록한다.
  `Approved`를 반환하는 Hook 승인은 세션 전체 허용을 저장하지 않는다.
- Hook matcher 변경은 정규식을 미리 컴파일하는 방식이다. Blabee의 `Bash`
  matcher와 명령 Hook 실행 경로는 유지된다.
- 0.162의 승인 후 sandbox 구성에는 변경이 있다. 파일 읽기 거부 등의 정책은
  Codex가 계속 적용하며, Blabee는 그 정책을 수정하지 않는다. 승인은 명령 성공을
  보장하지 않는다.

근거: [공식 Hook 규약](https://learn.chatgpt.com/docs/hooks#permissionrequest),
[0.162.1 승인 변환](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/tools/approvals.rs),
[세션 승인 cache](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/tools/sandboxing.rs).

## 변경과 검증 범위

- 두 정확한 서명 profile만 `HookPermissionPolicy.qualifiedProfiles`에 추가했다.
- 실행 중인 호출자·부모 체인·사용자 ID·시작 시각·서명 재확인, 세션·턴·명령·cwd
  결합, Pet focus·생존 확인, 만료, 단일 전달 및 ACK 검증을 유지한다.
- 0.162.2 등 미등록 버전, 다른 아키텍처, 바뀐 서명, 버전·해시 교차 조합은
  계속 거절한다. PATH나 입력 payload의 자기신고를 승인 근거로 사용하지 않는다.
- 새 profile의 자격·교차 조합 거부 및 Pet ⌘1 전달 회귀를 추가했다. 기존
  profile별 일회성 승인 테스트도 두 버전을 포함한다. 이 검사는 같은 명령의
  다음 요청이 별도 승인을 요구하고 기존 영수증을 재사용할 수 없는지 확인한다.

직렬 Swift 회귀 **87개 통과**: Coordinator 31개, Pet·Hook 56개다. 테스트
대역·메모리 journal·임시 경로를 사용했으며 기존 `npm run test:swift` 잠금을
유지했다. 컴파일을 포함한 테스트 결과이고, 제품 앱 빌드 결과가 아니다.

```sh
npm run test:swift -- --filter \
  'CodexHookApprovalQualificationTests|hookPermission|PetApprovalHotKeyTests|operational.*Permission|blabeePetPermission'
```

공식 package archive와 설치 실행 파일의 digest 일치, 두 정확한 서명 요건 및
`git diff --check`도 확인했다. 관리형 Codex의 전체 package fingerprint,
업데이트 저장·복원, 전체 Swift 테스트는 이번 범위에서 실행하지 않았다.

설치 앱 교체·재시작·실사용 승인은 이번 소스 변경에 포함하지 않는다. 새 앱을
빌드하고 정상 설치한 뒤 **새로 발생한** 승인 요청에서 버튼·⌘1·한 번의 실행·
다음 요청의 재승인을 확인해야 한다. 과거 요청을 재전송하거나 자동 승인하지 않는다.

검사 근거와 작업 시작 사본: `/private/tmp/blabee-hook-0162-jgbhzopf/`.
