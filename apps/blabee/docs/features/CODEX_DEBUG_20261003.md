# Codex 브릿지 소스 점검 — 2026-10-03

특정 재현 증상 없이 Plugin·Hook·MCP·queue와 관리형 App Server·업데이트 복원
경로의 오류 처리를 점검했다. 이번 기록은 소스 수정과 빌드 없는 검사에 한정한다.
Swift 컴파일·테스트, 앱 빌드·설치, 실행 중인 앱·세션·DB 변경 및 commit·push는
수행하지 않았다. 앞선 버전 지원 변경과 다른 작업자의 변경은 시작 사본을 기준으로
보존했다.

## 확인한 문제와 수정

| 경로 | 문제 | 수정 |
| --- | --- | --- |
| MCP 입력 | 여러 정상 메시지가 한 번에 읽히면 전체 버퍼 길이를 메시지 한 개의 제한과 비교해 연결을 종료할 수 있었다. 정확히 1 MiB인 메시지도 개행 때문에 거부됐다. | 첫 개행 앞의 메시지 길이를 검사한다. 개행 없는 미완성 입력은 다음 읽기 전에 제한을 검사해 버퍼 한도를 유지한다. |
| Pet Hook 상태 검사 | Plugin 조회는 주입된 환경을 정리해 사용하지만 Hook 검사는 실행 중인 프로세스의 환경을 상속해 다른 HOME·설정을 조회할 수 있었다. | 두 검사에 같은 환경 정리 정책을 적용한다. 일반 Doctor의 기존 3인자 호출은 기존 환경 상속 의미를 유지한다. |
| Hook 초기화 진단 | socket client의 runtime identity 검사가 요청 정책 밖에서 실패하면 queued Hook의 고정 오류 코드 진단이 누락됐다. | 초기화 결과를 한 번 저장하고 기존 요청 정책 안에서 오류를 처리한다. identity 오류는 재시도하지 않는다. |
| 관리형 WebSocket 종료 | 다른 스레드가 읽는 동안 descriptor를 닫으면 번호가 새 연결에 재사용되어 이전 읽기가 다른 연결을 건드릴 수 있었다. | 종료 시 shutdown으로 I/O를 깨우고, 진행 중인 읽기·쓰기가 모두 끝난 뒤 descriptor를 닫는다. 종료 함수는 reader handler나 writer 잠금을 기다리지 않는다. |
| 관리형 stderr 정리 | primary/auxiliary 프로세스 시작 전 검증이 실패하면 진단 파이프의 parent writer가 남아 EOF와 self-retaining callback 해제가 일어나지 않았다. | 진단 파이프 생성 직후 정리 defer를 등록한다. 실행 중인 child의 writer와 stderr 읽기는 유지한다. |
| 업데이트 중단 경합 | Host가 running을 확인한 직후 작업이 시작되면, freeze 이전의 busy 거절도 영구 host failure로 기록됐다. | Runtime 잠금 안에서 중단 전 busy 거절을 별도 타입으로 구분하고, Host가 이전 transaction과 현재 runtime 상태를 복구하도록 보완한다. 중단 시작 후 불확실한 실패는 계속 차단한다. |

제품 파일:

- `bridges/codex/swift/hooks/OperationalCLI.swift`
- `bridges/codex/swift/hooks/DoctorHookTrustInspector.swift`
- `bridges/codex/swift/hooks/PetHookReadiness.swift`
- `bridges/codex/swift/runtime/ManagedCodexWebSocket.swift`
- `bridges/codex/swift/runtime/ManagedCodexLauncher.swift`
- `bridges/codex/swift/update/UpdateManagedCodexHost.swift`
- `bridges/codex/swift/update/UpdateManagedCodexRuntime.swift`

## 검증 범위

Node/Python 계약·Plugin·패키지 및 lifecycle 검증기 회귀는 시작 상태와 제품
수정 후에 각각 **199/199 통과**했다. 수정 후 실행 시간은 약 33.1초다.

```sh
node --test --test-concurrency=1 \
  Tests/Contracts/*.test.mjs \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

다음 Swift 회귀 정의를 추가·보완했다. **이 테스트들은 실행하지 않았다.**

- `MCPInputLineReaderTests.swift`: 실제 reader와 파일 descriptor로 연속 메시지,
  정확한 1 MiB 경계, 초과 입력, 빈 줄과 EOF를 검사한다.
- `DoctorApplicationTests.swift`: 별도 child handshake로 명시한 HOME·PATH·LANG과
  정리된 환경이 전달되는지 검사한다.
- `HookRequestPolicyTests.swift`: 초기화 identity 오류의 고정 진단 코드와
  단일 시도 정책을 검사한다.
- `ManagedCodexBrokerTests.swift`: 읽기·쓰기와 종료의 경합, 반복 종료,
  parser/handler 오류 및 primary/auxiliary 시작 실패 시 진단 정리를 검사한다.
- `UpdateManagedCodexHostTests.swift`: 실제 Host·Runtime·registry·pipe를 사용해
  중단 전 busy 경합의 상태·transaction 복구, 재요청의 admission 도달,
  중단 후 실패와 rollback 저장 실패의 차단을 검사한다.

독립 소스 검토와 변경 범위의 whitespace 검사를 적용했다. Node/Python 통과는
수정한 Swift의 컴파일·실행 성공을 증명하지 않는다. 이후 빌드 허용 시
`npm run test:swift`의 기존 직렬 실행·잠금을 유지해 새 회귀를 실행하고,
설치된 앱의 Hook → Pet → queue 및 실제 관리형 중단·복원을 별도로 확인해야 한다.

## Engine/app 세션 인계

`app/coordination/CoordinatorOperationalApplication.swift`의 queue dispatch 오류
처리에는 별도 공통 문제가 남아 있다. 이번 Codex 변경에는 포함하지 않았다.

1. queue CLI 응답을 기다리는 동안 Hook이 선택을 durable claim한다.
2. Hook이 transport 완료와 prompt boundary 종료를 저장한다.
3. 뒤늦게 queue CLI 실패가 돌아온다.
4. dispatch catch가 이미 저장된 완료 상태를 확인하지 않고
   `nextTurnDispatchPhase = .failed`와 실패 응답을 기록한다.

검토 시점 근거는 dispatch catch **3721–3736행**, Hook claim·transport 완료와
boundary 종료 **4403–4422행**이다. 영속 완료 기록 자체를 롤백하지는 않지만,
완료 기록과 UI 호출 결과·dispatch 진단이 서로 모순될 수 있다.

Engine 세션에서는 terminal 상태와 늦은 receipt의 조정 정책을 정하고,
위 순서와 반대 순서의 회귀를 함께 검증해야 한다. 이를 이전 사용자의 선택 시간 초과
증상 전체에 대한 실사용 원인 확정으로 해석하지 않는다.

시작 사본과 검사 기록: `/private/tmp/blabee-codex-debug-20261003-i_2m8c59/`.
