# Blabee M0 타당성 검증 보고서

상태: QA 조건부 승인 — 제품 구현 전 계약 타당성 확인
검증일: 2026-08-21
대상: Codex CLI `0.148.0`, macOS

## 1. 결론

Hook-first Blabee의 핵심 왕복은 가능하다. 실제 Codex CLI의 한 턴 안에서 로컬 MCP가 구조화된 결정 제안을 보내고, `Stop` Hook이 Pet 선택을 기다린 뒤, 사용자가 고른 봉인된 작업 전체를 같은 턴에 돌려주어 Codex가 계속 작업하는 **한 사이클**을 확인했다.

이 왕복에는 별도 LLM API 키, 화면 인식, 터미널 키 입력 주입이 필요하지 않았다. 프로젝트의 `.codex/config.toml`만으로 MCP 서버를 발견했으므로 직접 CLI `-c`로 같은 서버를 중복 주입할 필요도 없다.

다만 이것은 임시 프로젝트와 가짜 코디네이터를 사용한 폐기 가능한 스파이크다. 네이티브 Pet, 운영 코디네이터, 실제 작업공간 롤백, 마켓플레이스 설치, 코디네이터 자동 시작, 신뢰 검토 UX, 서명·공증·DMG는 아직 제품으로 구현하거나 검증하지 않았다.

QA의 결론은 M0 연동 타당성에 대한 조건부 승인이다. 아래 높은 위험 차단 항목을 닫기 전에는 실제 사용자 작업공간이나 공개 MVP에 사용할 수 없다.

같은 Codex 턴 안에서 두 번째 `emit_decision`을 호출하면 현재 턴 키와 충돌한다. 따라서 M0은 반복 Pet 루프를 입증하지 않았고, 결정 경계 식별자를 확장하는 M1 상태 머신 설계가 필요하다.

## 2. 검증한 계약

### 실제 Codex 왕복

실제 계약 하네스가 다음 순서를 관찰했다.

```text
project_enabled
→ session_started
→ human_episode_started
→ decision_proposal_received
→ decision_wait_started
→ pet_action_selected
→ continuation_dispatched
→ continuation_consumed
→ continuation_completed
```

Codex `0.148.0`에서 `Stop`의 `decision: "block"`은 새 `UserPromptSubmit`을 만들지 않는다. 차단 사유가 같은 턴에 추가되고 모델이 계속 작업한 뒤, 다음 `Stop`이 `stop_hook_active: true`로 재진입한다.

따라서 M0 코디네이터는 다음 순서로 동작한다.

1. 현재 프로젝트·세션·턴의 유효한 MCP 결정 제안을 대기 상태로 만든다.
2. Pet 선택에서 `interaction_id`, `project_id`, `session_id`, `episode_id`, `packet_id`, `revision`, `option_id` 전체를 대조한다.
3. 봉인된 패킷에서 제목·목표·제약·완료 기준을 다시 읽고 일회성 연속 진행 토큰을 만든다.
4. 대기 중인 `Stop`을 `decision: "block"`과 전체 작업 지시로 해제한다.
5. 정확한 세션·턴의 `stop_hook_active: true` 후속 `Stop`에서 토큰을 한 번 소비하고 전송 수명 주기의 종료를 기록한다. `continuation_completed`는 이 관찰을 뜻하며 작업 성공 판정이 아니다.
6. 잘못된 세션·턴·플래그, 교차 바인딩과 중복 후속 Stop은 상태를 다시 바꾸지 않는다. 120초는 선택 전 패킷 만료이고, submitted token 만료는 `internal_format_repair`에만 검증됐다. dispatch 후 `pet_action` in-flight deadline은 아직 없다.

`pet_action`은 `same_turn_stop` 전용이며 새 `UserPromptSubmit`으로 제출할 수 없다. 같은 선택을 두 경로에서 중복 실행하지 않도록 이 전환을 계약 테스트로 거부한다. 명시적 `blabee_episode_continuation` 제출 봉투는 `internal_format_repair` 전용이며 같은 결정 경계에서 최대 한 번만 허용한다. M0는 이 봉투의 검증 계약만 확인했으며 운영 전달 방식은 아직 제품으로 연결하지 않았다.

### 반고정 슬롯

- 슬롯 1: 패킷별 동적 권장 작업
- 슬롯 2: 패킷별 동적 대안 작업. 안전하고 의미 있는 대안이 없으면 비활성
- 슬롯 3: 보류
- 슬롯 4: 사람이 입력한 직전 작업 프롬프트 직전 기준선으로 롤백

Pet은 숫자만 보내지 않는다. 선택 요청에는 식별자만 넣고, 실제 작업 본문은 코디네이터가 봉인된 패킷에서 다시 조회한다.

### 설명 전용 음성 계약

실제 Codex CLI의 `--explanation-only` 하네스도 성공했다.

- 관찰 이벤트: `project_enabled`, `session_started`, `human_episode_started`
- `decision_proposal_received`: 0건
- `decision_wait_started`: 0건
- `result.txt`: 생성되지 않음
- `final_assistant_message`: 정확히 `M0_EXPLAINED`

즉 설명·아키텍처·상태 질문은 결정 카드를 열거나 파일 작업을 시작하지 않는다는 부정 경로를 실제 CLI로 확인했다.

### 프로젝트 로컬 Hook/MCP

- Hook: 임시 프로젝트의 `.codex/hooks.json`
- MCP: 임시 프로젝트의 `.codex/config.toml`
- 실제 성공 모드: `--project-mcp-only`; 직접 MCP 서버 `-c` 주입 없음
- 실제 결과: `mcp_config_source = project_config_only`, `final_assistant_message = M0_CONTINUED`, `terminal_input_injection = false`, `separate_llm_api_key = false`
- 프로젝트 신뢰: 하네스의 정확한 whole-table CLI override
- Hook 해시 승인: 하네스 전용 `--dangerously-bypass-hook-trust`

프로젝트 로컬 MCP 검색은 검증됐지만, 테스트 전용 신뢰 우회 플래그를 제품 기본값으로 사용할 수는 없다. 마켓플레이스 설치와 사용자 신뢰 검토 흐름은 별도 패키징 과제다.

## 3. 자동 테스트 결과

최종 `npm test` 결과는 53/53 통과다.

| 테스트 묶음 | 수 | 검증 범위 |
|---|---:|---|
| 체크포인트/롤백 | 36 | clean 기준선, 바이트·인덱스·Git 실행 비트·이름 변경·바이너리·심볼릭 링크 복원, 그 밖의 POSIX 모드와 dirty/ignored/submodule/LFS/루트 밖/동시 편집/브랜치·HEAD/외부 효과/한도 차단, 복구 스냅샷 생성과 보관 정책 |
| Hook/코디네이터 | 15 | 조건부 SessionStart, 세션 ID의 교차 프로젝트 재사용 격리, 사람 프롬프트 에피소드, MCP, Stop 대기, 전체 선택 바인딩, 같은 턴 수명 주기 종료 관찰, 선택 전 패킷 만료, 형식 보정 제출 토큰 오용·만료·재사용, 반고정 슬롯, 보류·롤백 intent, fail-open, PermissionRequest 알림 전용, UDS 권한 `0600` |
| 런타임 | 2 | Node·Swift·C 제한 health fixture와 측정 스키마, 컴파일러 부재 시 안전한 skip. C는 프로토콜 동등성 근거가 아님 |

재현 명령:

```bash
npm test
npm run m0:codex -- --project-mcp-only
npm run m0:codex -- --project-mcp-only --explanation-only
npm run m0:benchmark
```

프로젝트 로컬 플러그인 구조는 Codex plugin validator로 별도 검증했다. 실제 마켓플레이스 설치를 수행한 것은 아니다.

Unix domain socket 생성을 금지하는 제한된 도구 샌드박스에서는 Hook/코디네이터 테스트가 `listen EPERM`으로 실패한다. 같은 테스트를 호스트 권한으로 실행하면 최종 53/53이 통과하고 실제 Codex의 Hook/MCP 호스트 전송도 성공했다. 이는 모델이 실행하는 작업공간 셸이 코디네이터 소켓에 직접 접근해야 한다는 뜻이 아니다.

## 4. 체크포인트 및 롤백 범위

롤백 스파이크는 운영체제 임시 디렉터리 아래에서 생성한 합성 Git 저장소에만 작동하도록 강제로 제한했다. 저장소 로컬 `.git`과 픽스처 소유 표식을 확인하지 못하면 복원하지 않는다.

검증한 기본 한도는 다음과 같다.

- 파일당 16 MiB
- 체크포인트당 128 MiB
- 프로젝트당 1 GiB

clean 기준선에서는 추적·스테이징·미추적 파일, 바이너리, 이름 변경, 삭제, 심볼릭 링크와 Git이 추적하는 실행 비트를 복원했다. `0644 → 0600`처럼 Git이 추적하지 않는 POSIX 모드 변화, 기존 dirty 상태, ignored 파일, 하위 모듈, LFS, 저장소 밖 경로, 동시 편집, 브랜치·HEAD 변경, 외부 부수 효과, 크기 한도 초과에서는 차단한다.

확정한 fail-closed 사유 코드는 `unsupported_index_state`(`assume-unchanged`/`skip-worktree`/sparse), `unsupported_git_configuration`(`core.filemode = false`), `unsupported_file_metadata`(비추적 POSIX mode), `hazard_attestation_missing`(ignored/submodule/LFS/outside-root/external-effect 다섯 attestation 중 누락 또는 `unknown`)이다.

복구 스냅샷은 생성과 보존까지만 확인했고 실제 재적용이나 복원 실패 주입은 아직 검증하지 않았다. 이 결과는 실제 Blabee 작업공간이나 사용자 저장소의 롤백이 활성화됐다는 뜻이 아니다. 제품 연결 전에는 저장소 전체 잠금과 TOCTOU 재검증, 같은 경로의 사람 동시 편집 검출, 복구 스냅샷의 실제 재적용과 실패 주입, sparse checkout·인덱스 플래그·비-Git POSIX 메타데이터 범위, 저장소 밖 경로·외부 효과 attestation의 fail-closed가 릴리스 게이트를 통과해야 한다.

## 5. 런타임 측정

세 후보는 제한된 NDJSON health fixture에 응답했다. C 구현은 정식 JSON 파서가 아니므로 이 결과를 프로토콜 동등성 증거로 해석하지 않는다.

| 후보 | p50 | p95 | peak RSS | 현재 판단 |
|---|---:|---:|---:|---|
| Node ESM | 19.734 ms | 21.215 ms | 43,122,688 B | 계약 스파이크 유지 |
| Swift 네이티브 | 2.546 ms | 9.508 ms | 6,111,232 B | 다음 macOS 패키징 후보 |
| C 시스템 바이너리 | 1.091 ms | 1.383 ms | 1,409,024 B | 정식 JSON 파서가 없는 성능 기준선 |

최종 운영 런타임은 아직 선택하지 않는다. 이벤트 저널의 강제 종료·재시작 복구, 유휴·지속 부하, Developer ID 서명·공증, DMG 포함 크기, 업데이트, 로그·진단, 전체 계약 유지보수 비용이 남아 있다. 상세 수치는 `M0_RUNTIME_REPORT.md`에 있다.

## 6. 보안 및 안전 경계

- 코디네이터 Unix domain socket은 listen 직후 파일 권한을 `0600`으로 제한한다.
- 원시 연속 진행 토큰은 디버그 로그에 기록하지 않고 검증용 해시만 상태에 보관한다.
- Hook이 코디네이터에 연결하지 못하면 Blabee 자동 동작만 끄고 일반 Codex는 계속되도록 fail-open한다.
- PermissionRequest는 알림 이벤트만 만들며 허용·거부를 대신 보내지 않는다.
- M0 하네스의 `--dangerously-bypass-hook-trust`는 테스트 전용이다.
- 터미널 키 입력이나 화면 자동화로 Codex를 조작하지 않는다.
- M0 소스는 Node 내장 모듈과 로컬 Swift/C 도구 체인만 사용하며 새 production dependency를 추가하지 않았다.

## 7. 남은 작업

1. T-006: 같은 턴 Stop 전이를 기본으로 v1 패킷·선택·연속 진행 스키마와 dispatch 후 in-flight deadline/outcome을 확정한다.
2. T-007: 영속 이벤트 저널, 프로세스 재시작 복구, 다중 세션 대기열, 전면 카드 선점과 같은 턴의 반복 결정 경계를 구현한다.
3. T-004: PermissionRequest 알림에서 원래 Codex UI를 여는 실제 Pet UX를 검증한다.
4. T-005: Swift 패키징 슬라이스와 운영 조건을 측정해 런타임 결정을 닫는다.
5. T-008 후속: 저장소 전체 잠금/TOCTOU, 같은 경로 동시 편집, 복구 스냅샷 재적용·실패 주입, sparse/index flags와 POSIX 메타데이터, outside/external fail-closed를 제품 롤백 게이트로 만든다.
6. T-010~T-012: 네이티브 Pet, 신뢰 검토를 포함한 설치 흐름, 서명·공증·DMG, `blabee doctor`, 터미널 매트릭스를 구현한다.

## 8. 근거와 한계

- Codex 기능 근거: [Hooks](https://learn.chatgpt.com/docs/hooks), [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [플러그인 만들기](https://developers.openai.com/plugins/build/plugins), [고급 설정과 프로젝트 신뢰](https://learn.chatgpt.com/docs/config-file/config-advanced).
- `decision: "block"` 뒤 같은 턴 재진입은 공식 기능명만으로 일반화하지 않고 Codex CLI `0.148.0` 실제 계약 픽스처 결과로 기록한다. 지원 버전마다 다시 테스트해야 한다.
- 코드 지식 그래프는 문서 파일에서 기록된 누락이 없었지만 M0 코드 메타데이터가 변경된 상태였다. 따라서 구현 사실은 현재 소스와 실행 테스트를 직접 확인한 결과를 우선했다.
- 제품 사용자를 대상으로 한 설치, 장시간 대기, 잠자기·복귀, 다중 세션, 네이티브 UI, 실제 작업공간 복원은 M0에서 입증하지 않았다.
- 반복 결정 루프도 입증하지 않았다. M0의 실제 Codex 증거는 한 결정과 한 연속 진행 사이클로 제한한다.
- `continuation_completed`는 선택한 작업의 성공이 아니라 정확한 후속 Stop을 본 전송 수명 주기 이벤트다. 라이브 fixture에서만 마지막 agent message가 정확히 `M0_CONTINUED`였기 때문에 작업 성공을 별도로 확인했다.
- dispatch 후 `pet_action` in-flight deadline과 timeout outcome은 아직 없다. 선택 전 패킷의 120초 만료 및 `internal_format_repair` 제출 토큰 만료와 구분해야 한다.
