# 공통 Swift 엔진 연결 — 첫 통합 계층

후속 선택 작업으로 [공통 Coordinator의 인증된 접속 경로](PRODUCT_INGRESS.md)를 추가했다. 어댑터의 canonical 소스는 이제 상위 Swift package의 `Sources/ClaudeCoreAdapter/`에 있으며 이 검증 패키지도 같은 target을 사용한다. 아래의 `claude/` 한정 변경·본체 변경 없음은 첫 계층 구현 당시의 범위를 설명한다.

2026-09-18 사용자가 다른 세션의 본체 작업이 끝났음을 확인하고 현재 코드 기준의 통합을 선택했다. 이 단계는 Claude 쪽 제안을 **기존 `CoordinatorSwift` 라이브러리에 직접 전달하는 연결 코드와 통합 검증**이다. 설치된 Blabee 앱의 Claude 접속·공통 화면·배포 전환은 아직 연결하지 않는다.

## 코드와 기준점

- [`shared-engine/Package.swift`](shared-engine/Package.swift)는 `../../src/coordinator-swift`의 공개 `ClaudeCoreAdapter` 라이브러리를 로컬 의존성으로 사용한다. 엔진 소스를 별도로 복사해 유지하지 않는다.
- Swift 어댑터는 제안 DTO 변환과 원래 선택의 연결 정보를 담당한다. 카드 검증·선택·일회용 소비·작업 결과 전이는 공통 `CoordinatorRoutingApplication`과 `SQLiteJournal`이 처리한다.
- [`shared-core-client.mjs`](src/bridge/shared-core-client.mjs)는 검증용 Swift 자식 프로세스와 제한된 JSONL로 통신한다. 응답을 잃으면 연결을 폐기하며 자동 재전송하지 않는다.
- 기준 사본은 `build/shared-core-baseline-q6lsr39x/`다. 현재 `src/coordinator-swift`와 `Contracts`의 246개 파일을 생성물 없이 보존하고 SHA-256을 기록했다. 캡처 전후 원본 일치를 확인했다. 사용자가 승인한 미커밋 변경을 포함하며, clean commit이나 배포 기준점이라는 뜻은 아니다.

이번 소스 변경은 `claude/` 안에 한정한다. 공통 엔진·기존 Codex 진입점·고정 `Contracts/v1`의 변경 없이 연결 가능성과 차이를 검증한다. 공통 제품을 변경할 때는 이 결과와 그 시점의 본체 변경을 다시 대조한다.

## 연결 규칙

1. 실제 관측한 native prompt ID는 `source_prompt_id`에 보존한다. `source_turn_id`는 별도로 발급하는 **Blabee 내부 turn**이다. Claude가 발급한 turn이라고 표현하지 않는다. 현재 통합 테스트는 이 관측값을 fixture로 공급한다.
2. 제안은 `task_goal`, outcome, reported side effects와 각 선택의 ID·제목·설명·작업·제약·완료 기준을 명시적으로 요구한다. 누락된 성공 상태나 제약을 추정해 채우지 않는다.
3. 코어 packet의 `evidence`는 빈 배열로 둔다. Claude 보고에 `codex_reported`나 `local_verified`를 붙이지 않는다. 전체 Claude 제안은 별도 DTO로 유지한다.
4. UI 선택에 해당하는 요청은 코어의 실제 선택 전이를 호출한다. 코어의 일회용 envelope는 어댑터 내부에만 둔다. Channel 쓰기만으로 전송 완료나 실행을 기록하지 않는다.
5. claim에 해당하는 요청에서 코어의 `consume_pet_action`과 `complete_transport`가 성공해야 action을 반환한다. 두 기록 사이에 실패하거나 응답을 잃으면 실행 여부를 추정하거나 자동 재전송하지 않는다.
6. 결과는 원래 binding·continuation에 기록하고 그 boundary만 닫는다. 새 입력의 C/D 카드가 생긴 뒤에도 원래 A의 결과를 저장할 수 있어야 한다. 결과는 Claude 모델 보고로 표시하며 검증된 실행 성공과 구분한다.

검증 프로토콜은 `0.1`, 프레임 한도는 128KiB다. 제안은 24KiB 이하이며 전체 live routing·카드 투영도 64KiB 내 예산을 기록 전에 검사한다. 결과 이력 투영은 최근 최대 32개·48KiB로 제한하고 `history.omitted_outcomes`를 명시한다. 영속 감사 이력은 그대로 보존한다. 결과 저장 후 응답이 실패한 경우에도 정확히 일치하는 영속 결과를 확인해 보고 한도를 회수하며, 실행 권한을 복원하지 않는다.

현재 코어의 선택 이벤트에는 `dispatch_mode=queued_next_turn`과 `queued_action_context_claim_protocol=v1`이 고정되어 있다. 이 검증에서는 Codex queue 호출·receipt·queued claim을 생성하지 않는다. **그 기존 내부 표식을 실제 Claude 전송 증거로 해석할 수 없으므로**, 공통 제품 연결 전에 provider별 전송 의미와 감사 계약을 명시적으로 처리해야 한다.

## 실행과 검증 범위

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm run test:shared-engine
```

명령은 별도 Swift package를 빌드·테스트하고, Node에서 실제 Swift 실행 파일을 호출하는 왕복 테스트를 실행한다. 빌드·캐시·임시 DB는 `build/` 아래에 둔다. 기존 `npm run app`과 `npm run claude`는 독립 개발 버전의 기존 실행 경로를 유지한다.

최종 실행에서 Swift 12개 테스트 그룹과 Node 12개 테스트가 통과했다. 기본 Command Line Tools에 테스트 매크로가 없으면 스크립트는 설치된 Xcode를 해당 실행에만 선택하며, 전역 개발 도구 설정은 바꾸지 않는다.

검증용 실행 파일 `blabee-claude-core-fixture`는 `--fixture-runtime`으로 명시한 임시 공간에서만 사용한다. fixture freshness 저장소는 테스트 전용이며 제품의 Keychain·저장소 rollback 보호를 검증한 것이 아니다. 프로세스 재시작 때 실행 권한을 복원하지 않는다. 모델용 도구나 기존 앱의 UDS endpoint로 직접 공개하지 않는다.

Node 왕복 테스트는 실제 core/SQLite를 사용하지만, 테스트가 binding을 공급하고 파일을 쓰며 결과를 보고한다. 따라서 실제 Claude 모델·Hook·MCP Channel·Pet 클릭의 통과 증거가 아니다. 실행 결과와 확인한 실패 조건은 [QA_REPORT.md](QA_REPORT.md)에 기록한다.

## 공통 앱 연결에 남은 작업

1. **인증된 bridge ingress:** 현재 앱의 runtime identity는 공개된 빌드 구분자다. provider 권한으로 사용하지 않는다. 기존 UDS의 secret 반사 방지·Codex caller 검증을 보존하면서 별도의 버전 있는 등록·도구 요청·자격 증명 전달 경로를 추가한다.
2. **저장·감사 계약:** Claude 전용 DB/key 부모·freshness account·authority를 제품이 선택한다. native session/cwd/연결 세대와 모델 보고 출처의 영속 감사, 부분 commit·재시작 규칙을 확정한다. 현재 어댑터의 프로세스 내 DTO를 durable session registry라고 부르지 않는다.
3. **공통 Pet:** 기존 Codex-only v1 snapshot을 보존하고 별도 scoped projection을 추가한다. provider 표시뿐 아니라 focus·선택·이벤트 ID·늦은 응답도 scope에 결합한다. Claude 대기를 Codex queue receipt로 표시하지 않는다.
4. **launcher·패키징·실제 검증:** Claude 연결 모드와 runtime 수명·업데이트 잠금을 연결한 뒤 두 도구의 실제 제안 → 선택 → 실행 → 결과를 검증한다.

이 첫 계층은 S-01의 일부 통합 fixture다. full S-01 또는 S-02~S-08, 공통 제품 전환 완료로 계산하지 않는다. 기존 독립 Claude 앱을 삭제하거나 자동 전환하지 않는다.
