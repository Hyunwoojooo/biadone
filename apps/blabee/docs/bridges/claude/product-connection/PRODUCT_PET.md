# CP-06 공통 Pet의 Claude 연결

[통합 Blabee 앱](UNIFIED_DISTRIBUTION.md)은 공통 Pet 하나에서 Codex와 여러 Claude 세션을
구분한다. Claude 전용 Preview 화면은 제거했다. Claude만 사용하면 첫 실행에서 Codex
연결을 건너뛸 수 있으며, Claude 시작 메뉴가 필요한 앱 서비스 설정을 안내한다.
공통 계정·설정·단축키·업데이트를 유지하고 provider/session별 인증은 분리한다.

2026-09-20. 공통 Pet에서 Codex와 여러 Claude 세션을 구분하고, 프로젝트 선택·새 Claude 시작·연결 확인·연결 해제를 연결했다. 소스 구현이며 설치 앱 적용·실제 모델 수용과 구분한다. 최종 검증은 [TASK_STATUS](TASK_STATUS.md), 다음 패키징 범위는 [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)을 따른다.

## 앱 전용 인증과 세션 계약

`AppOwnedServiceProcess`는 새 서비스마다 32바이트 난수로 만든 64자리 소문자 hex capability를 생성한다. 공개 플래그 `app-service --pet-bootstrap-v1`을 사용하고, capability는 기존 부모 수명 감시 anonymous pipe의 첫 bounded 프레임으로만 전달한다. 자식은 bootstrap 검증 뒤 같은 pipe의 EOF를 감시한다. argv·환경·설정·stdout ready 응답에는 capability를 넣지 않는다.

`PetAppServiceController.petProviderAccess`는 앱이 소유한 자식이 살아 있고 서비스를 공개한 동안만 접근 자격을 반환한다. 앱 generation과 capability를 함께 검사한다. 공개 runtime identity나 같은 UID만으로 selector 권한이 생기지 않는다. 기존 bootstrap 없는 daemon은 제품 selector를 제공하지 않는다.

일반 UDS에는 `pet_provider_v1`과 `pet_directory_v1` 두 type을 추가했다. 요청 wrapper는 `auth_token`과 `envelope`로 닫혀 있으며 capability는 입력 wrapper에만 사용한다. `PetProviderService`가 먼저 인증한 뒤 해당 계약을 검사한다. registry의 Claude scope별 selector capability는 서비스 내부에 남는다. Hook·MCP·모델은 앱 selector를 획득하지 않는다. 응답에는 known-secret 검사를 적용하고 입력 토큰의 request-local 검사를 유지한다.

기존 [pet-provider.v1](../../../../Contracts/bridge/pet-provider.v1.json)은 유지한다. 별도 [pet-directory.v1](../../../../Contracts/bridge/pet-directory.v1.json)을 추가해 목록과 연결 해제를 표현한다. `Contracts/v1`과 core 저장 schema는 변경하지 않는다.

| Directory operation | 요청 payload | 성공 result |
| --- | --- | --- |
| `list` | `after_scope_id`: null 또는 마지막 scope UUID | `codex_target`, `claude_available`, `sessions`, `next_cursor` |
| `disconnect` | 정확한 Claude `target` | `disconnected: true` |

응답은 request ID·operation·service incarnation을 확인하며 실패는 기존 UDS error를 사용한다. 한 페이지에는 Claude 최대 32개를 담는다. registry는 활성 scope 최대 32개와 최근 연결 해제 32개를 메모리에 보관한다. 목록은 디스크 이력 조회나 native 초기화를 수행하지 않으며, mapping이나 목록을 읽어 만료된 권한을 복원하지 않는다.

Claude target은 `scope_id`, `service_incarnation`, `session_incarnation`, `authority_epoch`, `ui_generation`을 고정한다. generation은 UInt64 십진 문자열이다. Codex 대상은 기존 pool 한 행이며 epoch를 추가하지 않는다. 각 행은 provider·target·core project/session ID·native session UUID·cwd·state만 제공한다. `connected`는 활성 registry 행을 뜻하고 실제 Channel ACK를 뜻하지 않는다.

## 화면·선택·결과 처리

`PetProviderTransport`는 목록과 선택한 provider의 projection을 분리한다. Claude가 선택되면 그 scope만 조회하며 Codex의 consumer heartbeat나 승인 목록을 함께 조회하지 않는다. 기존 Codex event navigation·native 승인·선택 receipt는 기존 dispatcher에 맡긴다. Claude에서는 native 승인 relay·rollback을 제공하지 않으며 공통 제품 설정은 유지한다.

클릭·단축키·확인 창은 렌더링 시점의 context를 사용한다. 서비스 generation, provider 전환 generation, scope/incarnation/UI generation을 await 전후로 검사한다. A→B→A 전환도 옛 A 요청을 복구하지 않는다. 전환 시 위험 확인·preview·focus·반환 앱 상태를 정리한다. transport의 별도 snapshot generation은 겹친 조회 중 늦은 응답이 최신 행이나 카드 캐시를 덮어쓰는 것을 막는다.

Claude 선택은 UUID selection ID와 현재 binding·packet·revision·option을 검사한다. `awaiting_claude_claim`은 전달 대기이며 실행 완료가 아니다. 실제 모델의 claim과 complete 결과를 구분해 표시한다. 과거 A 결과가 도착해도 새 C/D 카드의 경계는 변경하지 않는다. 잘못된 응답·유실된 mutation을 자동 재전송하지 않는다.

directory나 provider wrapper 장애 시 Codex는 명시적인 legacy fallback을 사용할 수 있다. 이 fallback도 관측한 앱 자격에 고정하며, 자격이 사라졌다는 이유로 진행 중 mutation을 다른 endpoint로 넘기지 않는다. 선택한 Claude가 사라졌을 때 Codex로 자동 전환하지 않는다.

연결 해제는 해당 authority만 회수하고 Claude 프로세스나 다른 scope를 종료하지 않는다. 마지막으로 조회한 결과·전달/보고 대기 수는 directory에 남은 scope 범위의 제한된 메모리 캐시로 보존하되, 실행 가능한 카드는 제거한다. 이 값은 마지막 관측이며 해제 이후 완료·취소를 추정하지 않는다. 서비스 재시작 뒤 저장된 이력을 실행 권한으로 복구하지 않는다.

## 초기 readiness

registry는 실제 `SessionStart(startup)`과 논리 bridge 연결을 관측한 뒤 최초 probe를 한 번 생성한다. 도착 순서는 자유다. startup이 늦어 첫 heartbeat가 만료됐다면 같은 bridge poll 회복 후 scheduler가 아직 시도하지 않은 첫 probe를 처리한다. poll·Pet 조회는 이 과정에서 core 저장을 수행하지 않는다.

초기 probe 만료 뒤 자동 반복이나 주기적인 모델 호출은 없다. 사용자가 누르는 **연결 확인**은 명시적인 새 probe다. Pet에는 nonce를 공개하지 않으며 ACK를 대행하지 않는다. 실제 Channel을 받은 모델이 `ack_readiness_probe_v1`을 호출해야 준비 상태가 된다. MCP 등록·heartbeat·알림 전송만으로 ready를 설정하지 않는다.

명시적 재확인은 유효한 기존 카드를 보존할 수 있지만 ACK 전에는 선택을 막는다. 이미 만료되거나 새 입력·compact 등으로 폐기한 카드는 ACK로 되살리지 않는다. 캐시된 card와 routing의 join을 검증하고 현재 상태에 맞지 않는 routing은 제거한다.

## Claude 시작과 아직 남은 패키징

`PetApplication`이 `PetViewModel`에 시작 동작을 주입한다. `PetClaudeLauncher`는 프로젝트 chooser가 끝난 뒤 앱 자격과 runtime/socket을 재검증하고, [CP-05 native 실행기](INSTALLED_SESSION.md)의 Terminal 경로를 blocking worker queue에서 호출한다. 사용자 프로젝트 enable·MCP·셸 설정은 수정하지 않는다. 사용자의 기존 Claude 터미널에 입력하지 않는다.

현재 검사하는 CP-07 bundle 후보 경로는 다음과 같다.

```text
Contents/Resources/claude/payload/src/session-v2-hook.mjs
Contents/Resources/claude/payload/src/session-v2-mcp.mjs
Contents/Resources/claude/node/bin/node
```

Claude 실행 파일은 `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude` 순서로 확인한다. bundle 안의 Node·bridge 파일이 없으면 고정된 안내와 함께 중단한다. 개발 checkout·global Node·npm을 제품 fallback으로 사용하지 않는다.

**CP-07의 payload/Node 번들·manifest 자격·불변 payload·업데이트 guard는 구현·격리 검증을 완료했다.** ad-hoc 후보는 제품 owner의 Apple 서명 인증을 충족하지 않으므로 CP-08에서 내부 Developer ID 후보를 별도로 준비한다. 경로·파일 검사만으로 설치 실행을 검증한 것으로 보지 않는다. 실제 Terminal 앱 조작·Claude 모델 왕복·설치 제품·장시간 사용은 [CP-08 수용](ACCEPTANCE.md)에서 확인한다.

## 검증

저장소 루트에서 실행한다.

```sh
npm --prefix bridges/claude run test:product-pet
```

| 추가 인자 | 범위 |
| --- | --- |
| `-- --pet` | 앱 bootstrap·launcher·registry·실제 UDS·transport·UI와 기존 Pet 회귀 |
| `-- --source` | native 상태·Channel 출처·product authority |
| `-- --native` | native launcher·실제 Hook/MCP·PTY·registry 회귀 |
| `-- --node` | 기존 v1/v2 Node 코드 및 provider/directory schema |
| `-- --production` | 테스트 define 없는 `blabee-coordinator` 빌드 |

runner는 Swift의 공통 `/tmp/blabee-coordinator-swift-tests.lock`을 사용해 직렬 검증하며 생성물은 `build/claude-tests/cp06/`에 둔다. 운영 앱·세션·DB를 사용하지 않는다. 단계별 최종 결과와 초기 실패는 [TASK_STATUS](TASK_STATUS.md)에 구분해 기록한다.
