# 세션 권한 기반 — CP-01A

2026-09-19. 이 문서는 [제품 설계](TECH_SPEC.md)의 세션 권한 정책을 독립 Swift 상태 객체로 구현하는 범위를 설명한다. [CP-02 registry](SESSION_REGISTRATION.md)가 scope마다 이 객체를 소유하며, [CP-03 연결](SESSION_LIFETIME.md)은 같은 객체를 native/inner ingress·실제 commit에 주입하고 private owner 갱신·종료를 처리한다. 설치 launcher는 CP-05다. 현재 실행 중인 Claude의 1시간 grant는 아직 연장되지 않는다.

## 책임과 신뢰 경계

`ClaudeSessionAuthority`는 `ClaudeCoreAdapter` 모듈 안에서 한 세션의 lease·회수 상태·commit 진입을 직렬화한다. `CoordinatorContinuousClock`을 주입하고 기본값은 수면 시간을 포함하는 `SystemCoordinatorContinuousClock`이다. Foundation과 기존 공통 모듈만 사용하며 새 패키지 의존성은 없다.

Identity는 scope, 실제 native session, session incarnation, service incarnation, owner 연결, authority epoch의 UUID 조합이다. 값이 다른 세션의 요청이나 다른 객체가 발급한 ticket을 수용하지 않는다. role credential·nonce·raw prompt·readiness·카드·DB는 이 객체에 넣지 않는다.

**Identity/OwnerHandle은 IPC 자격 증명이 아니다.** enrollment/registry가 peer·role·capability·owner 생존을 검증한 뒤 만드는 프로세스 내부 인자다. 모델/Hook이 보낸 UUID를 그대로 이 API에 넣는 것으로 인증을 대신할 수 없다. 이 객체 자체는 외부 JSON codec이나 UDS operation을 제공하지 않는다.

| Swift API | 계약 |
| --- | --- |
| `init(identity:clock:)` | 새 프로세스 내부 권한을 만들며 초기 시각/기한이 표현 불가능하면 거부 |
| `ownerHandle` | 이 객체에 묶인 opaque owner 참조. registry가 인증된 owner 요청을 처리할 때만 사용 |
| `renew(owner:sequence:)` | 현재 유효한 owner만 기한 갱신. `Lease`에 기한·sequence·고정 epoch 반환 |
| `snapshot()` | 만료/시계 오류를 관측해 `active` 또는 최종 `terminated` 반환; 기한 연장 없음 |
| `authorize(identity:)` | 정확한 등록과 현재 권한을 확인해 외부 생성 불가능한 `Ticket` 발급 |
| `withMutationFence(_: _:)` | 최종 짧은 동기 변경 직전에 ticket·시각·회수 여부 재검사 |
| `revoke(reason:)` | 신뢰한 lifecycle 호출자가 해당 객체만 최종 회수; 먼저 관측한 종료 사유 보존 |

OwnerHandle과 Ticket은 내부 instance ID에도 묶이며 공개 initializer나 Codable 복원 경로가 없다. 동일한 공개 Identity를 다른 객체에 주입해도 옛 참조를 사용할 수 없다. `AuthorityError`는 identity/owner mismatch, stale ticket, invalid sequence와 terminal reason을 구분하는 내부 Swift 오류다. 외부 오류 응답으로의 매핑은 CP-01B 이후 별도 계약이다.

## 시간과 갱신

- 최초 기한은 서버의 현재 연속 시각 + 60분이다. owner 호출 권장 간격은 5분이며 이 클래스가 background timer나 프로세스를 시작하지 않는다.
- 갱신은 정확한 OwnerHandle과 증가하는 sequence를 요구한다. 첫 sequence는 1이고, 이후 바로 다음 번호를 받는다.
- **직전 성공 sequence 한 건**만 동일 결과로 재응답한다. 이 재응답은 기한을 더 늘리지 않는다. 그보다 오래된 번호, 건너뛴 번호, 0은 거부한다.
- 새 기한은 갱신 시점의 서버 시각 + 60분이다. 클라이언트의 wall time이나 이전 기한에 시간을 더하는 방식은 사용하지 않는다.
- 정기 갱신에서는 authority epoch가 바뀌지 않는다. 이미 발급한 같은 객체의 ticket은 현재 권한을 다시 확인해 사용할 수 있다.
- `now >= deadline`이면 만료다. 중복 sequence라도 만료/회수 이후 성공 응답을 반환하지 않는다.
- clock 역행이나 deadline 계산 overflow는 권한을 닫는다. 시계가 나중에 정상으로 돌아와도 재활성화하지 않는다.

5분 readiness와 기본 10분 카드 TTL은 이 객체의 권한과 별도다. 조회·ticket 발급·commit 진입은 lease를 갱신하지 않는다. 모델 ACK나 heartbeat를 owner renewal로 해석하는 API도 없다.

## 회수와 mutation 경계

회수 원인은 owner 연결 종료, Claude 자식 종료, SessionEnd, 사용자 연결 해제, 서비스 교체로 구분한다. 회수는 최종 상태이고, 다른 scope의 객체에는 영향을 주지 않는다. CP-03은 private EOF·인증된 end·SessionEnd를 연결한다. 설치 owner의 실제 Claude 자식 종료 관측은 CP-05다.

요청을 받았을 때 발급한 ticket은 작업 시작 시점의 허가를 영구 보장하지 않는다. 시간이 걸리는 준비 작업을 마친 뒤 **최종 commit 직전에** `withMutationFence`를 호출해야 한다. 이 메서드는 ticket의 객체·identity와 현재 시각·종료 상태를 다시 검사한 뒤 같은 lock 아래 짧은 동기 commit closure를 실행한다. 회수와 commit은 이 경계에서 한 순서로 처리된다.

closure는 시간을 멈추거나 이미 실행한 부수 효과를 되돌리는 transaction이 아니다. 네트워크 대기, 비동기 작업 시작, 장시간 준비 작업, 같은 authority 메서드 재진입을 closure 안에 넣지 않는다. callback이 던진 오류는 호출자에게 전달하고 lock을 해제한다. CP-03은 SQLite의 첫 COMMIT만 이 경계로 감싸며, 부분 기록·응답 실패는 registry/metadata가 별도로 격리한다.

재시작 후 같은 공개 Identity를 가진 새 객체를 만들더라도 이전 객체의 ticket은 사용할 수 없다. 이 객체는 권한·ticket을 직렬화/복구하는 API를 제공하지 않는다.

## 검증 범위

새 `SessionAuthorityTests`는 실제 시간 대기나 모델 호출 없이 잠금 fake clock과 동시성 제어로 정책을 검증한다. 수면 복귀는 연속 시각을 전진시켜 남은 lease의 안/밖을 검사한다. 이는 실제 Mac 수면/깨움 또는 native owner의 주기적 실행을 시험한 결과와 구분한다.

검사할 항목은 24시간 갱신, 정각 만료, sequence 재생, 모든 identity mismatch, 오래된 ticket/다른 객체, 다중 scope, 종료 사유, 시계 역행/극값, 앞서 받은 ticket의 만료, 갱신/회수/commit 경합과 callback 실패다. 실행 결과는 [작업 상태](TASK_STATUS.md)에 기록한다.

전체 기존 Claude 공통 adapter 회귀는 `bridges/claude/`에서 `npm run test:shared-engine`으로 실행한다. 이 명령은 새 Swift 파일과 기존 adapter/native/ingress 테스트, Node core-client 왕복을 함께 검사한다. 설치 앱·Keychain·실제 Claude 모델은 사용하지 않는다. 기본 build 출력은 Blabee 루트의 `build/claude-tests/shared-engine/`이다.

CP-01B의 [owner/session v2/Pet envelope 계약](PRODUCT_WIRE.md)과 codec, CP-03의 두 인증 계층·owner controller 연결을 추가했다. 설치 launcher에 연결하고 실제 모델 왕복과 장시간 사용을 검증해야 현재 1시간 오류의 제품 해결로 보고할 수 있다.
