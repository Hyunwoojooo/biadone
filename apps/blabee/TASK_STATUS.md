# Blabee 작업 현황

업데이트: 2026-08-21

## 현재 단계

M0 연동 계약 검증에 이어 T-006 런타임 독립 v1 계약을 확정했다. `Contracts/v1`의 Draft 2020-12 스키마와 `Fixtures/v1`의 계약·이벤트 Fixture, `Tests/Contracts`의 오프라인 계약 검사가 반고정 슬롯, 같은 턴의 연속 결정 경계, 선택 선점 바인딩, 두 continuation 모드, 형식 보정의 durable 예약·claim, 전송과 작업 결과의 분리를 고정한다. 실제 Codex CLI `0.148.0` M0 왕복은 여전히 **결정 한 번 → 연속 진행 한 번**만 입증하며, 운영 코디네이터·반복 Pet 루프·네이티브 Pet·제품 롤백·DMG 패키징은 아직 구현하지 않았다.

## M0 검증 결과

| 범위 | 결과 | 증거 |
|---|---|---|
| 전체 자동 테스트 | 완료 | 최종 `npm test` 155/155 통과: 기존 M0 53 + v1 계약 102 |
| v1 계약 패키지 | 완료 | 스키마 10개, Fixture JSON 33개, 계약 테스트 102/102 통과 |
| Hook/코디네이터 | 완료 | 15개 테스트, 실제 Codex CLI 계약 픽스처 통과 |
| 체크포인트/복원 | 임시 픽스처 검증 완료 | 운영체제 임시 디렉터리 아래 합성 Git 저장소에서 36개 테스트 통과 |
| 런타임 비교 | 측정 완료, 선택 보류 | Node·Swift·C의 제한된 health fixture와 시작 지연·RSS·크기 측정. C는 정식 JSON 파서가 아니므로 프로토콜 동등성 근거가 아님 |
| 프로젝트 로컬 MCP 검색 | 완료 | 직접 MCP `-c` 주입 없이 임시 프로젝트 `.codex/config.toml`만으로 전체 왕복 통과 |
| 설명 전용 음성 계약 | 완료 | 결정 제안·대기 0건, 파일 변경 없음, 마지막 메시지 `M0_EXPLAINED` |
| 플러그인 구조 | 검증 완료 | 프로젝트 로컬 플러그인 validator 통과 |
| PermissionRequest 제품 동작 | 부분 완료 | 알림 전용 계약은 테스트했으나 원래 Codex UI 열기와 실제 Pet UX는 미구현 |

실제 계약 픽스처에서 관찰한 순서는 다음과 같다.

```text
project_enabled
→ session_started
→ human_episode_started
→ decision_proposal_received
→ decision_wait_started
→ pet_action_selected
→ continuation_dispatched
→ continuation_consumed
→ continuation_completed  # M0 이벤트명; v1 계약명은 continuation_transport_completed
```

Codex `0.148.0`에서 `Stop`의 `decision: "block"`은 새 `UserPromptSubmit`을 만들지 않는다. 같은 턴이 계속되고 작업 뒤의 `Stop`이 `stop_hook_active: true`로 재진입한다. Blabee는 선택 시 프로젝트·세션·턴·에피소드·상호작용·패킷·리비전·옵션 바인딩 전체를 검증해 대기 중인 `Stop`을 해제하고, 후속 `Stop`에서 전송 수명 주기 종료를 정확히 한 번 관찰한다. 이는 일반적인 작업 성공 판정이 아니다. `pet_action`은 이 same-turn Stop 경로 전용이며 `UserPromptSubmit`으로 제출할 수 없다. 제출 봉투 모드는 `internal_format_repair`에만 사용한다.

실제 계약 출력은 `mcp_config_source = project_config_only`, `final_assistant_message = M0_CONTINUED`, `terminal_input_injection = false`, `separate_llm_api_key = false`였다.

`--explanation-only` 음성 계약에서는 `project_enabled`, `session_started`, `human_episode_started`만 관찰했고 `decision_proposal_received = 0`, `decision_wait_started = 0`, `result.txt` 없음, `final_assistant_message = M0_EXPLAINED`를 확인했다.

## 확정된 제품 결정

1. 결정 카드는 반고정 구조다. `1`은 패킷별 권장 작업, `2`는 패킷별 대안 작업 또는 비활성, `3`은 보류, `4`는 사람이 입력한 직전 작업 프롬프트 직전으로 롤백이다.
2. 1·2 선택은 숫자만 전달하지 않는다. 코디네이터가 봉인된 패킷에서 작업의 제목·목표·제약·완료 기준 전체를 다시 읽고, Codex `0.148.0`에서는 대기 중인 `Stop`을 통해 같은 세션·턴·에피소드에 전달한다.
3. 사람이 새 작업 프롬프트를 직접 제출할 때만 새 에피소드와 롤백 기준선을 만든다. Pet 연속 진행과 Hook 내부 재시도는 같은 에피소드에 남는다.
4. 공개 v0.1 자동 롤백 후보는 깨끗한 작업 트리에서 시작하고 범위가 완전한 프롬프트 에피소드 하나다. ignored 파일, 하위 모듈, LFS, 저장소 밖 파일, 크기 초과, 동시 편집, 브랜치·HEAD 변경, 외부 부수 효과가 있으면 비활성화한다.
5. 센티널은 격리된 M0 smoke test에만 사용한다. 운영 결정 제안 채널은 프로젝트 로컬 MCP `emit_decision`이다.
6. 공개 v0.1의 네이티브 권한 요청은 Pet 알림과 원래 Codex UI 열기만 제공한다. Pet은 허용·거부를 대신 전송하지 않는다.
7. 알파 기준은 Codex `0.148.0`이다. Hook/MCP 기능뿐 아니라 같은 턴 Stop 전이를 버전별 계약 테스트로 확인한 뒤 지원 허용 목록에 넣는다.
8. 로컬 코디네이터 연결은 2초로 제한하고 실패하면 일반 Codex를 막지 않는다. 60초에 한 번 알리고 120초에 자동 선택 없이 만료하며 늦은 입력을 거부한다.
9. 여러 세션의 패킷은 대기열에 둘 수 있지만 전역 단축키는 사용자가 명시적으로 선택한 전면 카드 하나에만 적용한다.
10. Blabee는 별도 LLM API 키나 추론 서비스를 요구하지 않는다.

## 작업 상태

- 완료: T-001, T-002, T-003, T-006
- M0 합성 픽스처 검증 완료: T-008. 실제 사용자 작업공간 연결은 아직 하지 않았다.
- 진행 중: T-004, T-005
- 대기: T-007, T-009~T-014

## 다음 작업

1. T-005에서 Swift 패키징 슬라이스를 만들고 강제 종료 복구, 지속 부하, Developer ID 서명·공증, DMG 크기, 업데이트·진단을 측정해 운영 런타임을 선택한다.
2. T-007에서 `Contracts/v1`을 소비하는 영속 이벤트 저널, 재시작 복구, 세션 대기열, 원자적 선택 선점과 같은 턴의 반복 결정 상태 머신을 구현한다.
3. T-004에서 원래 Codex UI 열기와 PermissionRequest 알림 UX를 실제 Pet 통합으로 검증한다.
4. T-008의 합성 복원 코드를 실제 제품에 연결하기 전에 저장소 전체 잠금과 TOCTOU, 같은 경로의 사람 동시 편집, 복구 스냅샷 재적용·실패 주입, sparse/index flags와 비-Git POSIX 메타데이터, 저장소 밖·외부 효과의 fail-closed를 별도 릴리스 게이트로 검증한다.

## 알려진 위험과 경계

- 같은 턴 `Stop` 재진입은 Codex `0.148.0` 실제 동작으로 확인했지만 버전별 내부 계약이므로 정기 호환성 테스트가 필수다.
- M0 런타임은 한 결정 사이클만 통과했다. T-006 계약은 `decision_boundary_id`와 `boundary_sequence`로 같은 턴의 경계 1→2를 표현하고 검증하지만, 이를 실행하는 반복 상태 머신은 T-007에서 구현해야 한다.
- T-006 계약은 dispatch 후 `in_flight_deadline_at`과 `timed_out_unknown`을 정의했다. timeout은 작업 결과를 `unknown`으로 남기고 취소·실패를 추론하거나 자동 재시도하지 않는다. 실제 시계·저널·복구 동작은 T-007 범위다.
- 형식 보정은 발급 시 `internal_format_repair_reserved`가 결정 경계당 1회 예산을 소비하고, 검증 뒤 `internal_format_repair_claimed`가 일회 claim을 기록한다. T-006은 journal replay 불변식만 고정했으며 실제 원자적 영속화와 token fingerprint 구현은 T-007 범위다.
- M0 하네스는 프로젝트 신뢰를 정확한 whole-table CLI override로 설정하고 Hook 해시 검토를 테스트 전용 `--dangerously-bypass-hook-trust`로 우회했다. 제품 설치에서는 이 우회를 사용할 수 없다.
- 프로젝트 로컬 MCP 검색 중복 우려는 해소됐지만, 마켓플레이스 설치·번들 코디네이터 자동 시작·신뢰 검토·업데이트·서명·공증·DMG는 아직 검증하지 않았다.
- Stop의 60초 알림과 120초 만료는 상수와 단축된 결정론적 테스트로 검증했다. 실제 절전·복귀, 장시간 대기, 프로세스 재시작 시계는 후속 검증이 필요하다.
- 롤백 스파이크는 합성 임시 Git 픽스처에만 적용된다. `assume-unchanged`/`skip-worktree`/sparse는 `unsupported_index_state`, `core.filemode = false`는 `unsupported_git_configuration`, 비추적 POSIX 모드는 `unsupported_file_metadata`, 다섯 hazard attestation의 누락·unknown은 `hazard_attestation_missing`으로 모두 fail-closed한다. 실제 Blabee 작업공간이나 사용자 프로젝트에서 롤백은 활성화되어 있지 않다.
- 런타임 마이크로벤치만으로 운영 언어를 고르지 않는다. 현재 Node는 계약 스파이크, Swift는 다음 패키징 후보, C는 정식 JSON 파서가 없는 성능 기준선일 뿐이다.
- 기본 Hook 모드에서 범용 `requestUserInput`이나 네이티브 승인 중계를 약속하지 않는다.

공식 참고: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex 플러그인 만들기](https://developers.openai.com/plugins/build/plugins).
