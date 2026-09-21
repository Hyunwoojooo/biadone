# T-005 운영 코디네이터 런타임 선택 보고서

상태: **Swift 네이티브 헬퍼 선택 — T-005 언어 선택 게이트 종료, T-007b-A/A2 영속·freshness 커널 조건부 완료**

실측 시각: 2026-08-21 09:37 KST (`2026-08-21T00:37:21.654Z`)

## 결론

T-007 운영 코디네이터 구현 런타임으로 **Swift 네이티브 헬퍼(`swift-native`)를 선택한다.** Node ESM은 계약 참조·빠른 실험 하네스로 유지한다. C는 수치와 관계없이 health 전용 성능 기준선이며 선택 후보가 아니다.

Node와 Swift는 같은 NDJSON 요청/응답, 같은 최소 journal 이벤트, 성공 응답 전 `fsync`, 강제 종료 뒤 replay, 명목상 120초 대기의 결정론적 축약 probe, 지속 부하, 구조화 진단, ad-hoc 서명, 측정용 DMG 생성을 모두 통과했다. Swift를 선택한 주된 이유는 다음과 같다.

- 독립 실행 파일 하나로 패키징하며 ad-hoc 서명이 헬퍼 전체를 덮는다.
- Node는 실제 비교를 위해 112 MB급 Node 런타임을 번들해야 하고 JavaScript 소스는 런타임 실행 파일 서명 범위 밖에 남는다.
- 이 로컬 슬라이스에서 Swift의 부하 후 RSS와 패키징 크기가 Node보다 작았다.
- 공개 제품이 네이티브 macOS Pet을 포함하므로 앱·헬퍼의 도구 체인과 배포 표면을 공유할 수 있다.

이 선택은 **T-007 구현 목표를 정하는 결정**이다. Developer ID 서명·공증된 공개 DMG 승인, 실제 업데이터, 네이티브 Pet, 실제 사용자 저장소 롤백을 승인한 것이 아니다.

선택 이후 T-007b-A/A2에서 spike를 복사하지 않은 독립 Swift Package 저수준 제품 영속 커널을 구현했다. strict v1 ingress, SQLite WAL/`synchronous=FULL`/외래 키/`BEGIN IMMEDIATE`, 프로세스 간 CAS, crash replay, 외부 키 기반 인증과 Keychain freshness high-water를 통과했지만 공개 Pet dispatch나 Swift full coordinator state machine 승인은 아니다.

## 동일 자격 검증 계약

Node와 Swift 후보는 다음 메서드를 같은 NDJSON framing으로 제공한다.

| 메서드 | 검증 내용 |
|---|---|
| `health` | 프로세스와 protocol version 응답 |
| `append` | `event_id`와 연속 `event_sequence` 검증, NDJSON 한 줄 append, `fsync` 완료 후 승인 |
| `diagnostics` | build version, replay 수, 마지막 event, partial-tail 복구, PID, RSS |
| `update_info` | 현재 build version과 아직 구현되지 않은 외부 원자적 교체 전략 노출 |
| `wait_probe` | 명목상 120,000 ms를 scale divisor로 축약하고 단조 시계 경과와 자동 선택 없음 기록 |
| `shutdown` | 테스트용 정상 종료 |

강제 종료 검증은 공통 Fixture 네 건을 durable 승인받은 다음 프로세스를 `SIGKILL`한다. 충돌 시 남을 수 있는 30-byte 불완전 tail을 추가한 뒤 같은 journal로 재시작해 네 건만 replay하고 tail을 절단한 다음 5번 event를 정상 append하는지 확인한다.

## 재현 명령

```bash
node --test Tests/RuntimeQualification/runtime-qualification.test.mjs
node spikes/m1/runtime-qualification/scripts/qualify-runtimes.mjs
```

기본 실측 설정은 후보별 콜드 스타트 12회, persistent health 500회, durable append 24회, `120000 / 1200 = 100 ms` wait probe다. 임시 빌드·payload·journal·DMG는 운영체제 임시 디렉터리에 만들고 종료 시 제거한다.

## 측정 환경

| 항목 | 값 |
|---|---|
| 운영체제 | macOS Darwin 25.5.0 |
| 아키텍처 | arm64 |
| CPU | Apple M5, 논리 CPU 10개 |
| Node | v22.23.2 |
| Swift | Apple Swift 6.3.1 |
| C 컴파일러 | Apple clang 21.0.0 |

## 실제 측정값

| 후보 | cold p50 / p95 | 지속 health p50 / p95 | durable append p50 / p95 | 부하 후 RSS | ad-hoc signed payload | 측정용 DMG |
|---|---:|---:|---:|---:|---:|---:|
| Node ESM | 20.506 / 21.479 ms | 0.017 / 0.034 ms | 2.957 / 3.911 ms | 49,479,680 B | 112,286,913 B | 41,036,331 B |
| Swift 네이티브 | 5.330 / 217.173 ms | 0.016 / 0.025 ms | 0.063 / 0.261 ms | 11,386,880 B | 123,872 B | 47,440 B |
| C health 기준선 | 2.294 / 189.470 ms | 0.015 / 0.037 ms | 해당 없음 | 1,425,408 B | 실행 파일 33,920 B | 측정 안 함 |

비교 표의 RSS는 세 후보 모두 지속 부하 직후 동일한 `/bin/ps -o rss=` 방식으로 읽은 현재 resident set이다. 각 런타임의 자체 RSS는 진단 관찰값으로 별도 기록하며 후보 간 비교에는 사용하지 않는다.

Swift와 C의 cold p95에는 각각 한 번의 큰 이상치가 포함됐다. 따라서 이 결과는 시작 지연의 절대 상한 보장이 아니며, p50·지속 부하·패키징 표면과 함께 해석한다. C는 정식 JSON journal/replay가 없어서 프로토콜 동등성이나 운영 선택 근거로 사용하지 않는다.

## 복구와 120초 대기

| 항목 | Node | Swift |
|---|---:|---:|
| `SIGKILL` 전 durable event | 4 | 4 |
| 재시작 replay event | 4 | 4 |
| 절단한 partial tail | 30 B | 30 B |
| replay 뒤 다음 append | 성공, 최종 5건 | 성공, 최종 5건 |
| 런타임 단조 시계 축약 wait | 100.324 ms | 101.970 ms |
| 하네스 단조 시계 관찰 | 121.002 ms | 106.588 ms |
| 자동 선택 | 없음 | 없음 |

실제 120초를 벽시계로 기다린 시험은 아니다. 명목상 120초와 scale divisor를 요청 계약에 함께 고정하고 런타임과 하네스 양쪽의 단조 시계로 100 ms 대기를 교차 검증했다. 허용 범위는 80~500 ms이며 즉시 반환은 실패한다. 절전·복귀와 시스템 시계 변경은 이후 통합 시간 테스트 범위다.

## 서명, DMG, 자격증명

- Node 번들 실행 파일과 Swift 독립 실행 파일은 임시 복사본에서 `codesign --sign -`, strict verify, 서명 뒤 `health` 실행을 통과했다.
- Node 서명은 번들 Node 실행 파일만 덮으며 JavaScript entrypoint까지 하나의 helper code signature로 묶었다는 증거가 아니다.
- 두 payload 모두 UDZO/HFS+ 측정용 DMG 생성에 성공했다. 이는 설치 UI나 제품 앱 번들을 포함한 공개 DMG가 아니다.
- Developer ID 자격증명을 제공하거나 변경하지 않았다. 별도 읽기 전용 확인에서 유효한 codesign identity가 0개였으므로 상태는 정확히 **`unavailable`**이다.
- Apple 공증 요청은 수행하지 않았다. 상태는 정확히 **`not_measured`**다.

Developer ID 서명과 공증은 T-012 공개 배포 게이트에 남긴다. 자격증명 부재를 성공으로 가장하지 않되, 두 후보의 공통 런타임 계약과 로컬 패키징 비교가 끝났으므로 T-007 언어 선택을 다시 보류하지 않는다.

## 진단과 업데이트 관찰성

두 선택 후보에서 다음을 확인했다.

- `runtime_started`, `journal_append_durable`, `wait_probe_completed` 구조화 stderr 로그
- `t005-qualification-v1` build version
- replay event 수, 마지막 event sequence, partial-tail 절단 여부, RSS 진단
- `update_info`에서 현재 version과 `external_atomic_replacement_not_implemented` 전략 노출

실제 updater 실행, 원자적 교체 실패 복구, 버전 downgrade/rollback은 구현하지 않았다. 따라서 업데이트는 **관찰 가능성만 통과**, 실행 기능은 후속 작업이다.

## 선택 이후 경계와 위험

1. T-007a는 이 spike를 제품 코드로 승격하지 않고 JavaScript ESM의 런타임 중립 참조 코어에서 v1 Contracts 리듀서와 journal port 의미를 고정했다. T-007b-A는 그중 journal port의 영속 경계를 독립 Swift 제품 커널과 SQLite 어댑터로 구현했다.
2. 이 자격 시험 자체는 단일 writer였지만 T-007b-A 후속 통합 시험에서 두 독립 프로세스의 expected-sequence CAS, 원자 batch, crash before commit, SIGKILL, commit 후 응답 전 crash와 replay를 검증했다.
3. Swift cold-start 이상치는 반복 측정과 실제 앱 번들·지원 macOS/아키텍처 매트릭스에서 다시 확인한다.
4. Developer ID, 공증, 실제 앱 DMG, updater와 `blabee doctor`는 T-012가 소유한다.
5. C는 성능 기준선 지위를 유지하며 운영 후보로 재해석하지 않는다.

## T-007b-A/A2 후속 구현 결과

`src/coordinator-swift/`는 SQLite WAL/FULL/FK와 exact schema/trigger 검증, strict contract pin, 4개 ingress 타입의 manifest fixture 20개 parity를 제공한다. runtime event는 MAC chain과 인증된 head anchor로, packet/verification sidecar는 exact packet/seal/selection/action/verification row binding HMAC으로 보호한다. 외부 32-byte 키는 파일 `0600`·상위 디렉터리 `0700`과 `openat` 기반 symlink 거부를 적용한다.

이 커널의 NDJSON `append`는 trusted caller가 T-007a와 동등한 lifecycle command/reducer 검증을 선행한다는 전제다. 저장층은 동일 top-level decision boundary의 중복 claim을 commit 전에 hard-stop하지만 latest revision·stale·expiry·rollback-disabled·reseal을 판정하는 generic Swift semantic reducer는 아직 포팅되지 않았다. Hook·Pet·비신뢰 IPC가 low-level append를 직접 호출하면 안 되며 T-007b-B semantic application port가 이 경계를 소유한다.

QA 보강은 exact Int64, DB·키 손실, test-only crash gate, commit 뒤 replay, 원문 continuation/correlation token의 DB·WAL·SHM·로그 비저장을 포함한다. secret corpus 검사는 런타임이 관찰·등록한 값만 대상으로 하며 재시작 시 다시 등록한다. 임의의 보이지 않은 secret 전체를 탐지한다고 주장하지 않는다.

- Swift package unit: 27/27 통과
- persistence Node 통합: 40/40 통과
- 전체 `npm test`: 기존 202 + persistence 40 = 242/242 통과. Swift unit은 이 합계와 별도다.
- 최종 production `SQLiteJournal.swift` SHA-256: `64ba977bb81a96485e994c2e321bb31a8f882e982bf4d6b438e42eef0074f706`; diff-check 통과

T-007b-A2는 strict canonical `initializing`/`committed`/`pending` Keychain record, immutable DB identity와 generation/sequence/head metadata, `kSecAttrGeneric` digest CAS, process mutex와 `0600` `flock`을 구현했다. 새 storage는 Keychain identity부터 만들고, storage preflight와 lock 뒤 recheck는 DB·키 loss 및 anchor 누락에서 파일을 생성하지 않는다. 기존 DB·키에 anchor가 없는 pre-A2 상태는 자동 migration/adoption하지 않는다.

append는 Keychain pending CAS 뒤 SQLite commit, 전체 authenticated replay, Keychain committed CAS/read-back 순서로 진행한다. `pending + target DB`만 replay 뒤 finalize하고 `pending + source DB`는 exact canonical batch 재시도 외에는 차단한다. 과거 authentic DB snapshot, DB·키 loss, anchor 누락/손상, crash point 85/87/88/86과 concurrent writer를 fail-closed로 검증했다.

T-007b-A/A2는 영속·freshness 커널 범위에서 조건부 완료다. unsigned CLI는 entitlement 부재로 legacy login Keychain을 사용하고 UI 차단에는 deprecated `kSecUseAuthenticationUIFail` 경고가 남아 있다. signed wrapper와 Data Protection Keychain/access group·`LAContext`, deprecated API 교체, same-UID anchor 삭제·교체, DB·키·anchor 동시 제거, exact batch가 없는 pending-source 운영 복구와 키 회전은 T-012 또는 후속 보안 범위다.

후속 구현에서 T-007b-B1/B2의 Swift semantic application·세션 대기열·명시적 전면 카드·연속 단조 deadline과 T-007b-C의 실제 Hook 반복/제품 상태 반복 분리 게이트를 완료했다. T-007 상태는 `done`이다. 다음 런타임 작업은 T-011에서 두 게이트를 연결하는 Hook→Swift 고수준 adapter와 단일 UDS owner를 구현하는 것이다.
