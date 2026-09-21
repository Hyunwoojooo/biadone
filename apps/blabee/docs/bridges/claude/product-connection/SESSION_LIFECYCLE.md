# 제품 세션 수명 관측과 장기 상태 — CP-04

2026-09-19. [CP-03 권한 연결](SESSION_LIFETIME.md)에 제품 v2 lifecycle, 재생 방지 기록, 시간 처리와 제한된 메모리 상태를 추가한다. 설치 launcher와 실제 Hook/MCP client 연결은 CP-05, 공통 앱의 제품 Pet 연결은 CP-06이다. 기존 개발 launcher의 v1 grant나 실행 중인 Claude를 전환하지 않는다. 검증 결과는 [작업 상태](TASK_STATUS.md)에 기록한다.

## 수명 관측

| 관측 | 제품 처리 |
| --- | --- |
| 같은 native ID/cwd/owner의 `SessionStart(compact)`와 현재 prompt ID 일치 | 같은 episode 아래 새 내부 boundary. 이전 Stop·readiness·미claim 카드와 전달을 폐기하고 새 Stop·제안을 요구 |
| compact의 prompt ID 누락·불일치 | `new_prompt_required`. 과거 prompt를 채워 넣지 않고 실제 새 입력 전 제안·선택 차단 |
| `Stop`, background 관측이 빈 배열 | 해당 prompt의 응답 정지와 관측된 background 없음. 다른 readiness·카드 조건도 충족해야 선택 가능 |
| `Stop`, background 관측이 없거나 작업이 남음 | unknown/active로 구분하고 선택 비활성화. Stop만으로 완료·취소를 기록하지 않음 |
| `StopFailure` | 실패 관측을 기록하고 미claim 작업 폐기. 이미 claim한 작업의 원래 결과 보고 권한은 유지 |
| 관측 불명확·미지원 lifecycle | 새 입력 또는 새 세션 필요 상태로 전환. 중단을 성공이나 취소로 추정하지 않음 |

`SessionEnd`, 만료·회수 이후에는 claimed 결과 보고 권한도 되살리지 않는다. compact/Stop/StopFailure의 Hook request ID는 한 번만 소비한다. 같은 ID의 압축 전 Stop 재전송은 거부한다. 신뢰된 Hook 생산자가 새 request ID로 과거 관측을 다시 포장하는 상황까지 판별하는 외부 증거 체계는 추가하지 않았다. client는 실패한 mutation을 자동 재전송하지 않아야 한다.

[v2 정규화 helper](../../../../bridges/claude/src/session-v2-lifecycle.mjs)는 파일·환경·IPC를 읽지 않는 순수 변환이다. 공식 raw Stop의 `background_tasks`와 `session_crons`가 모두 유효할 때 내부 DTO의 `background_task_ids`로 합친다. 필드 부재를 빈 배열로 만들지 않는다. `StopFailure`는 허용한 오류 분류만 전달하며 원문 오류·assistant 메시지를 저장하지 않는다. 이 helper를 기존 v1 Hook에 암묵적으로 연결하지 않았다.

공식 근거: [공통 입력 필드](https://code.claude.com/docs/en/hooks#common-input-fields), [SessionStart](https://code.claude.com/docs/en/hooks#sessionstart-input), [Stop](https://code.claude.com/docs/en/hooks#stop-input), [StopFailure](https://code.claude.com/docs/en/hooks#stopfailure). compact에 prompt ID가 항상 온다고 가정하지 않는다.

## 재생 방지와 저장 경계

[ClaudeNativeReplayPort](../../../../bridges/claude/swift/adapter/ClaudeNativeReplayPort.swift)는 prompt·proposal·selection·Hook request의 소비를 scope별 metadata에 기록한다. 같은 현재 prompt의 동일 digest 재관측만 현재 상태에서 처리하고, 같은 ID의 다른 digest는 충돌로 처리해 미claim 카드와 readiness를 폐기한다. 과거 prompt/제안/선택 ID 재사용은 거부한다. 역할 자격·nonce·선택 참조·prompt 원문은 tombstone에 저장하지 않는다.

새 metadata 저장소는 **v2**다. HMAC 감사 기록의 prepared/finalized에 replay key를 포함하고 operation/replay lookup을 같은 SQLite 트랜잭션에서 저장한다. 매번 인증 연쇄를 순차 검증하면서 lookup의 최초 sequence와 전체 행 수를 대조한다. lookup 삭제·추가·변조로 오래된 ID를 다시 사용할 수 없다. 정상 중복은 `claude_metadata_replay`로 거부하며 이 이유만으로 scope를 격리하지 않는다.

core는 별도 DB와 기존 strict schema를 유지한다. replay 소비 기록이 완료된 뒤 core 동작을 시작한다. 중간 실패의 결과가 불명확하면 해당 scope를 격리하며 자동 재실행하지 않는다. 실패한 요청의 ID가 소비될 수 있으므로 재시도용 권한으로 해석하지 않는다.

일반 mutation과 `authenticatedSummary`는 전체 이력을 배열이나 seen 집합으로 만들지 않는다. 명시적 `authenticatedHistory`만 호출자가 요청한 이력 배열을 만든다. v1 metadata는 수정·migration 없는 history-only reader로 읽으며 옛 세션 권한을 복구하지 않는다. v2 전체 검증 시간은 이력 크기에 비례하고, v1의 중복 검사는 prefix 재검사로 더 오래 걸릴 수 있다. 일정한 메모리 사용이 일정한 처리 시간을 뜻하지는 않는다.

## 장기 사용 중 현재 상태

제품 v2는 개발 v1의 lifetime prompt/proposal/selection/probe/poll 횟수로 세션을 종료하지 않는다. 현재 prompt·boundary·probe·미claim 전달과 최대 32개 미보고 claim을 유지한다. 완료 보고 후 claim 자리를 돌려주며, 32개 동시 claim의 backpressure는 유지한다. 이 제한은 native 보조 상태와 cursor/Pet 캐시에 대한 것이며, 보존하는 core 이력이나 전체 프로세스 메모리의 고정 상한을 뜻하지 않는다. 최초 논리 bridge 연결 1회 정책도 그대로다.

- `bridge.poll`: 1초 창에서 최대 8회. 창이 지나면 다시 사용할 수 있다.
- `readiness.begin`: 60초 창에서 최대 12회. owner lease·5분 readiness·카드 TTL은 각각 독립이다.
- 채널 참조는 현재 probe/ready/pending/claim 범위만 유지한다. 과거 nonce 전체 목록을 메모리에 누적하지 않는다.
- Pet transport는 현재 카드의 시도·응답·진행 중 요청을 각각 하나만 보관한다. 응답이 유실된 카드에는 다른 selection ID로 재시도하지 않으며, 검증된 새 카드가 와야 슬롯을 교체한다.

제품 `bridge.poll`의 non-null event에는 양의 UInt64 문자열 `delivery_sequence`가 필수다. **처음 poll되어 소비될 때** 순서를 부여하므로 probe 우선 전달이 순서를 역전시키지 않는다. 연속 번호 사이의 간격은 허용하지만 `delivery_sequence` 필드 누락·역행·동일 번호의 다른 내용은 거부한다. [v2 Channel cursor/poller](../../../../bridges/claude/src/session-v2-channel-poller.mjs)는 고정 identity/bridge/source와 마지막 sequence·digest만 보관한다. 같은 전달을 억제하고 notify 실패 후 자동 재전송·ACK·claim하지 않는다. 실제 MCP renderer/launcher 연결은 CP-05다.

이 필드는 아직 배포하지 않은 제품 v2 계약의 확장이다. [공통 schema](../../../../Contracts/bridge/common.v1.json)·Swift codec·JS cursor를 같은 소스 버전으로 사용해야 한다. `Contracts/v1`과 개발 session v1의 응답 형식은 그대로다.

## 읽기와 시간 처리

제품 selector snapshot은 준비된 projection을 읽는다. 조회나 빈 poll마다 core snapshot의 due 쓰기를 실행하지 않는다. semantic 변경은 cache를 dirty로 표시하고, registry의 `processTime()`이 dirty/미초기화/기한 도달 때 metadata 경계 안에서 projection을 갱신한다. 초기 갱신은 native 생성의 metadata 트랜잭션을 마친 뒤 수행해 같은 잠금의 재진입을 피한다.

`nextProductWakeNanoseconds`는 core·heartbeat·probe·readiness·lease 중 필요한 다음 시각을 계산한다. 공통 서비스 scheduler는 Claude registry와 Codex의 다음 기한 중 빠른 값을 사용한다. 저장 처리는 scope별로 최대 한 작업만 별도 큐에 예약하며 공통 scheduler는 기다리지 않는다. scope 실행기가 사용 중이면 deadline 조회는 authority의 COMMIT 잠금도 기다리지 않고 100ms 뒤 다시 확인한다. 진행 중 작업과 후속 worker/요청은 기존 authority fence로 만료·회수를 검사한다. 각 scope의 만료·저장 오류는 그 scope만 회수한다. owner만 lease를 갱신하며 scheduler·snapshot·poll은 갱신 권한을 얻지 않는다.

## 검증 명령과 증거의 범위

Claude 폴더에서 실행한다.

```sh
npm run test:product-lifecycle
```

등록/metadata/registry/owner/Pet transport Swift, 기존 ingress/native Node, 공통 adapter/native/계약 suite와 새 v2 JS helper 테스트를 실행한다. 이 명령이 shared runner의 `--lifecycle` 옵션으로 장기 Swift suite를 포함한다. 일반 `test:shared-engine`은 기존 76개 Swift 및 공통 Node 검사를 실행하며 장기 suite를 반복하지 않는다. 장기 fixture는 가짜 시계를 진행하며 1,000 prompts, 500 proposals/selections/probes, 100,000 polls와 오래된 ID 재사용을 확인한다. 500회 상태 전이에는 테스트용 메모리 journal/replay 포트를 주입한다. 실제 SQLite metadata 1,000개 재생 기록, registry·compact·오래된 ID·COMMIT 경합과 소수 선택 왕복의 저장 검증을 별도로 유지한다. 같은 helper의 메모리/SQLite 3회 검사를 포함한 짧은 suite를 먼저 통과시킨 다음 500회 누적 검사를 실행한다. 테스트용 메모리 append는 실제 semantic application이 끝낸 candidate replay를 중복 실행하지 않으며, 마지막 전체 replay·성공 결과 수·원래 선택 ID·보고문 검증을 유지한다. 긴 반복 suite는 최적화한 release 테스트 빌드에서 직렬 실행하고, 각 반복의 Foundation 임시 객체를 autoreleasepool로 해제한다. 기존 debug 경합 suite와 별도로 실행해 테스트 worker의 시간 초과를 피하며 반복 횟수와 assertion은 유지한다.

core는 mutation마다 누적 journal을 다시 replay한다. 따라서 메모리 journal fixture에서도 긴 반복의 비용이 누적된다. 이 검증은 상태 전이·횟수 제한·조회 무쓰기를 확인하며 처리 지연의 성능 기준을 충족했다는 뜻은 아니다. 실제 제품 저장 경로의 이력 크기별 지연·메모리 사용 측정은 별도 후속이다. 후속 측정은 테스트 define 없는 release 서비스와 격리 SQLite에서 50/100/250/500회 완료 이력을 만들고, 제안·선택·완료·다른 scope 조회 지연을 각각 기록하고 같은 scope의 poll/heartbeat·readiness 변화도 함께 관측한다. 가짜 시계는 실제 처리 지연과 heartbeat 기한의 상호작용을 증명하지 않는다. HMAC·freshness·commit fence·전체 replay의 정확성 조건을 유지한 상태에서 병목을 확인한 뒤 변경 범위를 정한다. 이 단계에서는 core 검증을 생략하거나 기존 core 구조를 바꾸지 않았다.

JS 1,000개 전달과 Pet 500개 선택은 helper/transport fixture다. Pet fixture는 legacy v1 projection과 소비한 ID를 기억하는 oracle을 사용한다. 실제 제품 v2 선택 500회나 설치 UI의 연결을 증명하지 않는다. 테스트 Keychain 대체물·격리 DB를 사용하며 설치 앱과 실제 세션을 변경하지 않는다. 실제 compact Hook, 모델 왕복·2시간/8시간 유지·수면·설치 앱 수용은 [G2~G5](IMPLEMENTATION_PLAN.md)의 후속이다.
