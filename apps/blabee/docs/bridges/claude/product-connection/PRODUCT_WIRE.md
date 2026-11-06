# 제품 통신 계약 — CP-01B

2026-09-19. [제품 설계](TECH_SPEC.md)의 owner/session/Pet 메시지를 기존 v1과 분리한다. CP-01B의 산출물은 JSON Schema, 부작용 없는 Swift codec, 공유 fixture다. 후속 dispatcher·권한 연결 구현은 [CP-03](SESSION_LIFETIME.md)을 따른다. 설치 launcher·Hook/MCP v2 client·Pet provider wire 연결과 구분한다.

## 계약과 책임

| 계약 | 호출자와 책임 |
| --- | --- |
| `blabee.claude-owner.v1` | 인증된 native owner의 등록·갱신·종료 |
| `blabee.claude-session.v2` | Hook의 native 관측과 MCP bridge의 연결 확인·제안·claim·결과 보고 |
| `blabee.pet-provider.v1` | 앱 selector의 provider별 조회·선택·Claude 연결 확인 시작 |

Schema는 `Contracts/bridge/`에 두며 `Contracts/v1`, 기존 `CoordinatorBinding`, 개발용 `blabee.claude-session.v1`의 의미를 변경하지 않는다. 내부 transport 버전과 모델 도구 이름의 `_v1`은 서로 독립이다.

- [owner schema](../../../../Contracts/bridge/claude-owner.v1.json), [session schema](../../../../Contracts/bridge/claude-session.v2.json), [Pet schema](../../../../Contracts/bridge/pet-provider.v1.json), [공통 값](../../../../Contracts/bridge/common.v1.json)
- [Swift codec](../../../../bridges/claude/swift/adapter/ClaudeProductWireCodec.swift)

**codec 통과는 인증 성공이 아니다.** peer 검증·private challenge·실제 grant pipe/FD 전달·owner 연결 종료는 [CP-02 transport/registry](SESSION_REGISTRATION.md)가 담당한다. [CP-03](SESSION_LIFETIME.md)은 그 private 연결의 owner 갱신·종료와 일반 UDS의 Hook/MCP 역할 인증을 연결한다. 이 codec 자체는 네트워크를 열거나 권한을 발급하지 않고, authority lease를 갱신하거나 모델을 실행하지 않는다. `OwnerHandle`과 `Ticket`은 계속 프로세스 내부 값이며 wire로 직렬화하지 않는다.

제품 Hook/MCP의 UDS 입력 payload는 `{auth_token, envelope}`이며 `envelope`만 이 codec으로 검사한다. role capability를 codec의 닫힌 schema 안으로 넣거나 일반 응답 비밀값 검사를 완화하지 않는다. owner는 계속 별도 인증된 private socket만 사용한다. 이 입력 wrapper는 이전 개발 v1의 암묵적 승격 경로가 아니다.

| Swift API | 검증 범위 |
| --- | --- |
| `init(credentialCorpus:)` | 실제 발급한 장기 자격의 in-memory corpus 주입. 입력에서 임의 값을 수집하거나 corpus를 변경하지 않음 |
| `inspectEnvelope(_:)` | 구조·비밀값만 검사. 응답을 실제 호출 결과로 수용하는 API가 아님 |
| `decodeRequest(_:)` | 방향이 request인 구조 검사. 실제 peer/role/현재 authority는 별도 인증 필요 |
| `decodeResponse(_:matching:connection:)` | 원 요청과 검증한 연결의 공개 참조로 응답 correlation·operation별 결과 binding 검사 |
| `encodeResponse(_:matching:connection:)` | 같은 검사 뒤에만 응답 직렬화 |

`ExpectedConnection`을 생성하는 행위 자체는 인증이 아니다. `Envelope.requiresInnerValidation`이 true면 named opaque DTO의 검증이 남아 있다. false여도 인증·권한·실행 허가를 뜻하지 않는다. frame은 UTF-8 256 KiB, JSON 깊이는 32로 제한하며, 채널 참조를 포함할 수 있는 `canonicalJSON`을 로그나 영속 metadata에 저장하지 않는다.

## 요청·응답과 대상 고정

각 메시지는 계약 버전, 방향(`request`/`response`), request UUID, provider, role, operation을 명시한다. 새 요청마다 request UUID를 만들고 응답은 해당 값을 그대로 사용한다. 요청의 `payload`와 응답의 `ok`·`result`/`error`를 구분한다. 성공 결과와 오류를 동시에 담거나 응답에 요청 payload를 붙이지 않는다.

등록 후 owner/session 메시지는 scope·native session·session incarnation·service incarnation·owner connection·authority epoch의 여섯 UUID를 가진다. 클라이언트는 요청할 때 보관한 맥락을 기준으로 응답을 검증한다. 응답에서 기대값을 다시 꺼내 서로 비교하는 방식은 사용하지 않는다. 오류 응답도 동일한 correlation 검사를 거친다.

Hook payload의 `native_session_id`는 실제 관측값이다. 등록 예상값과 다른 관측도 구조 검사 단계에서는 읽을 수 있어야 한다. 불일치를 정상 세션으로 수용한다는 뜻이 아니라, CP-03에서 해당 Hook을 인증한 뒤 미지원 세션 전환으로 등록을 폐기할 수 있게 하기 위함이다. 잘못된 관측을 버리고 이전 권한을 계속 유지해서는 안 된다. codec은 실제 cwd/main-agent/Hook 출처나 현재 lifecycle을 검증하지 않는다.

등록 전 `enroll`은 아직 발급되지 않은 전체 세션 identity를 요구하지 않는다. 이때의 service/owner/challenge/pipe 식별자는 앞서 인증한 private 연결과 대조할 공개 참조다. 이 문자열을 알고 있다는 사실 자체는 등록 권한의 증명이 아니다. 등록 성공 JSON에는 발급 identity와 lease 등 공개 metadata만 들어가며, 실제 역할 자격은 전용 private pipe로 전달한다.

2026-09-21 [자동 연결](AUTO_CONNECT.md)은 같은 private owner 계약에 별도
`enroll_observed` operation을 추가한다. 기존 `enroll` 필드에 실제 Hook에서 관측한
`native_session_id` UUID와 `source` (`startup`, `resume`, `fork`)를 요구하며, 성공 응답은
요청의 native ID와 정확히 일치해야 한다. 나머지 scope·incarnation·epoch와 자격은
서버가 새로 발급한다. 기존 challenge·서명 peer·일회용 grant pipe 인증은 동일하며,
일반 Hook/MCP UDS에서 등록을 호출할 수는 없다. 기존 `enroll`과 공통 v1은 유지한다.

Pet 요청은 provider·scope·incarnation·UI generation을 고정한다. Claude는 authority epoch도 구분한다. 선택 요청은 원래 카드·revision·option·selection과 core binding을 보존한다. 동일한 프로젝트 경로나 표시명이 scope를 바꾸는 권한이 되지 않는다. 현재 카드와의 일치, 소비 여부, UI generation의 최신성은 실제 registry/Pet 연결 시 다시 검사해야 한다.

## 숫자·비밀값·내부 DTO

- 갱신 번호, 단조 시각의 nanosecond, 새 UI generation은 canonical UInt64 decimal string으로 전달한다. 부호·선행 0·지수·공백·범위 초과를 거부한다. JavaScript number로 변환하지 않는다.
- CP-04 제품 `bridge.poll`의 non-null event는 양의 UInt64 문자열 `delivery_sequence`도 요구한다. 처음 poll되어 소비될 때 번호를 부여하며 client는 마지막 sequence와 digest만 보관한다. 아직 미배포인 제품 v2의 확장이므로 schema·codec·v2 helper를 같은 소스 버전으로 사용한다. 개발 session v1과 core `Contracts/v1`은 바뀌지 않는다.
- 기존 카드 revision의 숫자 의미는 유지하며 새로운 wire에서 다룰 수 있는 정확한 정수 범위를 검증한다.
- opaque 데이터 안의 JSON 숫자도 기존 strict parser와 맞춰 ±9,007,199,254,740,991 범위의 정수로 제한한다. 소수는 허용하지 않는다. Pet core binding의 문자열은 기존 `CoordinatorBinding`의 NFC 규칙도 검사한다.
- 장기 capability·owner handle·ticket을 일반 성공/오류/Pet 응답에 넣지 않는다. 추가 키와 중첩된 opaque 데이터도 비밀값 검사 대상이다. 실제 등록한 secret 값의 반사는 codec에 전달한 corpus로 별도 검사한다.
- probe nonce/선택 참조는 필요한 bridge 채널 전달 결과와 해당 응답 요청에서만 허용한다. 이것은 장기 역할 자격과 별개이며 readiness ACK 일반 응답에 다시 싣지 않는다.
- envelope와 operation별 필드는 닫힌 객체다. 명시적으로 버전을 붙인 기존 proposal/Pet DTO의 opaque 영역만 내부 해석을 별도 validator에 맡긴다. **이 영역을 envelope 통과만으로 dispatch하거나 화면에 투영해서는 안 된다.**

기존 Pet parser는 `BlabeeCoordinator` executable target 안에 있다. `ClaudeCoreAdapter`에서 역으로 import하지 않는다. CP-01B의 provider envelope와 CP-06의 전체 Pet DTO 검증·projection을 구분하며, Claude 결과를 Codex queue receipt로 바꾸지 않는다.

## 검증과 남은 연결

Swift codec과 Node Ajv가 `Tests/bridges/claude/fixtures/product-wire/cases.json`을 함께 읽는다. Node는 기존 root 개발 의존성과 `Tests/Contracts/contract-harness.mjs`의 Draft 2020-12 검증기를 재사용하며 production dependency를 추가하지 않는다.

Ajv의 parsed-object 검증만으로 JSON 중복 키나 잘못된 UTF-8를 검증했다고 처리하지 않는다. raw byte, frame 크기/깊이, 응답 correlation, 등록 secret 값은 Swift codec 테스트에서 별도로 검사한다. 문자열 schema 길이와 UTF-8 byte 한도도 서로 다른 검사다.

전체 관련 회귀는 `bridges/claude/`에서 `npm run test:shared-engine`으로 실행한다. 이 명령은 Swift suite와 기존 Node 왕복, 새 schema fixture를 포함한다. Schema만 빠르게 확인하려면 같은 폴더에서 다음을 실행한다.

```sh
node --test ../../Tests/bridges/claude/integration/product-wire-schema.test.mjs
```

최종 파일·테스트 결과는 [작업 상태](TASK_STATUS.md)를 따른다. CP-03의 양쪽 인증 계층 주입·owner timer를 구현했고, [CP-04](SESSION_LIFECYCLE.md)에 수명 처리와 Channel sequence를 추가한다. CP-05 launcher 연결은 남아 있다. 현재 개발 경로의 고정 1시간 만료는 아직 바뀌지 않았다. 이 계약 구현은 실제 채널 왕복·장시간 사용·설치 배포 통과의 증거가 아니다.

## CP-06 앱 전용 directory 추가

`pet-provider.v1`의 기존 envelope는 유지한다. [pet-directory.v1.json](../../../../Contracts/bridge/pet-directory.v1.json)은 앱 전용으로 인증된 일반 UDS wrapper 안에서 목록 조회와 정확한 target의 연결 해제를 추가한다. 구조 codec은 `app/service/PetProviderModels.swift`에 있으며, secret/capability 검증과 dispatch는 `PetProviderService`가 담당한다. owner/session wire나 `Contracts/v1`에 provider field를 추가하지 않는다. 요청·응답 형태와 신뢰 경계는 [PRODUCT_PET](PRODUCT_PET.md)을 따른다.
