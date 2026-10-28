# 공통 Coordinator의 Claude 접속 경로

2026-09-18의 사전 등록 ingress 구현 기록: 기존 Blabee Coordinator가 Claude 요청을 인증하고 공통 엔진 어댑터로 전달한다. 이후 추가된 launcher·실제 Hook/MCP 경로는 [NATIVE_SESSION.md](NATIVE_SESSION.md)를 따른다. 이 문서의 `claude_bridge_v1`과 새 세션의 `claude_session_v1`을 구분한다. 설치된 앱 교체·기존 세션 재시작·공통 Pet 화면 연결은 수행하지 않았다.

## 실행 경로

```text
Claude용 Node product-core-client
  → 기존 Coordinator UDS의 claude_bridge_v1
  → scope / session / role / capability / expiry 검사
  → ClaudeCoreAdapter
  → 기존 CoordinatorSwift + scope별 SQLite
```

어댑터의 단일 소스는 [`../src/coordinator-swift/Sources/ClaudeCoreAdapter/`](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter)에 있다. 공통 앱과 `shared-engine` 검증 패키지가 같은 Swift target을 사용한다. 엔진·어댑터 구현을 복제하지 않는다. 기존 Codex operational handler, 호출자 검사, 고정 `Contracts/v1`은 유지한다.

## 활성화와 인증 자료

제품 daemon은 `--claude-bridge-config /absolute/private/claude-bridge.json`을 명시하면 접속 경로를 활성화한다. 제품의 `service`/`app-service`는 기존 `config/service.json` 옆의 `config/claude-bridge.json`을 선택적으로 읽는다. 파일이 없으면 Claude 경로는 비활성 상태다. 선택적 설정이 만료·손상되거나 Claude 저장소 초기화에 실패하면 Claude 경로만 `claude_bridge_unavailable`로 응답하고 Codex 앱은 계속 시작한다. 명시한 CLI 설정이 잘못되면 시작에 실패한다. 일반 UDS 요청으로 세션을 등록하거나 자격 증명을 발급받을 수 없다.

설정은 신뢰한 로컬 실행 주체가 미리 준비하는 입력이다. 이 ingress는 이를 읽기만 한다. 이후 추가된 [native session launcher](NATIVE_SESSION.md)는 설정 파일 대신 전용 파이프로 새 세션의 자격을 발급·전달한다. 두 방식을 혼합하거나 사용자의 설치 경로에 이 설정을 자동 생성하지 않는다.

설정 규격:

- `schema_version`: `blabee.claude-bridge.config.v1`
- `scopes`: 최대 16개의 `{scope_id, project_id, session_id, bridge_token, selection_token, expires_at}`
- `scope_id`: 정규화한 소문자 UUID. `expires_at`은 ISO 8601 만료 시각.
- 두 capability는 각각 독립적인 32바이트 난수의 64자리 소문자 hex 표현이다. scope와 역할을 통틀어 중복되면 거부한다.
- 설정은 현재 사용자 소유의 `0600` 일반 파일이며, 부모는 `0700` 실제 디렉터리다. 심볼릭 링크·하드 링크·초과 크기·잘못된 schema를 거부한다.

capability를 argv나 runtime identity에 넣지 않는다. Node 클라이언트에는 소유한 실행 주체가 명시적으로 전달한다. 서버 응답·진단·SQLite에 capability를 돌려주거나 기록하지 않는다. OS의 동일 사용자 검사는 기존 UDS에 남아 있고, 공개 runtime identity는 빌드 구분에만 쓴다. capability 인증은 등록된 로컬 주체의 권한을 확인하며 실제 Claude 모델이나 native Hook 출처를 증명하지 않는다.

| 역할 | 허용 요청 |
| --- | --- |
| `bridge` | `activate`, `claim`, `complete`, `invalidate`, `snapshot` |
| `selector` | `select`, `snapshot` |

브릿지가 사용자 선택을 직접 실행하지 못하도록 선택 자격을 분리한다. 모든 binding의 project/session은 인증된 scope와 일치해야 한다. 같은 native ID를 서로 다른 scope에서 사용해도 저장소와 자격은 공유되지 않는다. 이 경로는 기존 Codex 요청을 승인할 권한을 추가하지 않는다.

## 버전 있는 요청과 응답

기존 UDS의 바깥쪽 요청 형식과 `blabee.runtime-identity.v1/` 접두사를 유지한다. 새 요청 type만 `claude_bridge_v1`이다. payload는 다음 필드를 정확히 요구한다.

```text
schema_version = blabee.claude-bridge.v1
provider = claude
scope_id, session_id, role, auth_token
request = {schema_version: 0.1, request_id: UUID, operation, ...}
```

`request`는 [공통 어댑터](SHARED_ENGINE_INTEGRATION.md)의 입력 규칙을 사용한다. 인증 검사를 통과해도 정해진 operation 외의 core 명령을 전달할 수 없다. 제안·제약·결과 메모에 capability가 포함되면 변경을 기록하기 전에 거부한다.

응답은 `schema_version/provider/scope_id/session_id/role/request_id/ok`와 `result` 또는 `error`를 포함한다. snapshot에는 `cards/outcomes/history`만 투영하고 raw core routing을 공개하지 않는다. 선택 직후에는 `delivery: awaiting_claude_claim`, 실제 claim 이후에는 `delivery: claimed`다. 이것을 Codex queue receipt나 실행 성공이라고 표시하지 않는다. 완료는 계속 모델 보고로 기록한다.

기존 UDS의 request-local/global secret 검사와 raw token key 거부는 유지한다. 실제 설정으로 확인한 capability만 전역 corpus에 등록한다. 실패한 인증 입력은 해당 요청의 응답 검사에만 사용하므로 다른 세션의 출력을 오염시키지 않는다.

클라이언트는 응답의 버전·request ID·runtime identity·scope·session·role을 검사한다. 응답 유실·잘못된 프레임 이후 연결을 실패 처리하고 변경 요청을 자동 재전송하지 않는다.

## 저장소와 검증 경계

설정 디렉터리 아래 `claude-stores/<scope_id>/`에 DB와 key, `claude-authority/`에 실행 권한 잠금을 둔다. Keychain freshness account는 canonical DB 경로의 digest를 포함하는 `claude-v1-...`이며 Codex `primary`와 다르다. 요청 데이터로 저장 경로나 Keychain account를 지정할 수 없다.

자동 검증은 다음 명령으로 실행한다.

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm run test:shared-engine
npm run test:product-ingress
```

두 번째 명령은 실제 공통 `blabee-coordinator`와 UDS·SQLite를 사용한다. 테스트 빌드에만 포함되는 fixture 명령에서 freshness 저장소를 메모리 구현으로 주입하므로 설치된 앱·프로세스·Keychain을 변경하지 않는다. 이 검증은 실제 Claude 모델/Hook/Channel/Pet 클릭이나 제품 Keychain 동작의 통과 증거가 아니다. 최종 실행 결과는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)에 기록한다.

현재 `npm run app`과 `npm run claude`는 기존 독립 개발 경로를 실행한다. `npm run claude:shared`는 별도 fresh runtime에서 공통 실행 파일과 실제 Hook/MCP의 버전 DTO를 사용한다. readiness ACK도 새 세션 경로에 구현했으며 공통 Pet 선택 화면과 패키징은 남아 있다. 기존 MCP의 간단한 proposal에서 누락된 outcome·제약을 임의로 합성하지 않는다.
