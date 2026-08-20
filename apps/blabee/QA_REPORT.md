# Blabee M0 QA 보고서

상태: M0 타당성 범위 조건부 승인
검토일: 2026-08-21
대상: `spikes/m0/`, Codex CLI `0.148.0`, M0 설계·상태 문서

## 판정

M0가 목표로 한 **결정 한 번 → 같은 턴 연속 진행 한 번**의 Hook-first 계약은 통과했다. 합성 임시 Git 저장소에서만 허용되는 체크포인트/롤백 스파이크도 지정한 안전 경계 안에서 통과했다.

이 판정은 공개 MVP나 실제 사용자 작업공간 롤백 승인이 아니다. 아래 High 항목을 닫기 전에는 제품 롤백을 활성화하면 안 된다.

## 실행 증거

- `npm test`: 53/53 통과
  - 체크포인트/롤백 36
  - Hook/코디네이터 15
  - 런타임 2
- 실제 positive contract: 프로젝트 로컬 `.codex/hooks.json`과 `.codex/config.toml`만으로 `emit_decision`, Pet 1번, 같은 턴 연속 진행, 후속 Stop을 거쳐 마지막 JSONL `agent_message = M0_CONTINUED` 확인
- 실제 negative contract: 설명 요청에서 `decision_proposal_received = 0`, `decision_wait_started = 0`, 파일 변경 없음, 마지막 JSONL `agent_message = M0_EXPLAINED` 확인
- Codex plugin validator 통과
- 모든 M0 JavaScript 파일 `node --check` 통과

두 실제 계약 모두 터미널 키 입력 주입과 별도 LLM API 키를 사용하지 않았다. 프로젝트 trust override와 `--dangerously-bypass-hook-trust`는 격리된 테스트 harness에만 사용했다.

## QA 중 수정한 결함

- 토큰을 제외한 continuation 봉투 전체를 봉인하고 추가 필드·ID·만료값 변조를 거부
- `pet_action = same_turn_stop`, `internal_format_repair = submitted_envelope`로 전달 모드를 상호배타화해 이중 실행 차단
- 형식 보정을 결정 경계당 한 번으로 제한하고 repair kind allowlist 적용
- 같은 세션 ID가 다른 프로젝트로 재바인딩될 때 이전 wait/proposal/dispatch/token 라우팅 폐기
- 슬롯 3·4 선택 후 상태를 `paused`·`rollback_intent`로 기록
- Unix domain socket 권한을 `0600`으로 제한
- 디버그 로그에서 continuation 토큰과 작업 본문 비노출
- `assume-unchanged`, `skip-worktree`/sparse 상태, `core.filemode=false`, Git이 추적하지 않는 POSIX mode 변경에서 롤백 차단
- 저장소 밖 변경·외부 효과 등 위험 attestation이 누락되면 `unknown`으로 보고 fail-closed
- 실제 Codex 결과를 단순 문자열 포함이 아니라 마지막 JSONL `agent_message`의 정확 일치로 검증

## 공개 전 차단 조건

### High

1. **실제 저장소 동시성**: canonical repository identity 기준 전역 잠금, 기준선 이중 스냅샷, mutation 직전 재검증, 같은 경로 작성자 provenance가 필요하다. 현재 `projectId` 기반 임시 잠금과 `ownedPaths`만으로는 실제 편집기와의 경쟁을 증명하지 못한다.
2. **복구 스냅샷 재적용**: 현재는 생성·보존만 검증했다. staged Git object의 독립 보존, index/manifest 해시, 원자적 저장, 실제 재적용, 삭제·reset·catalog 단계별 실패 주입을 통과해야 한다.
3. **반복 Pet 루프**: 현재 `session + turn`당 proposal 한 개만 허용한다. 같은 턴에서 여러 결정 사이클을 지원할 `decision_boundary_id` 또는 sequence/revision 상태 머신이 필요하다.

### Medium

1. `continuation_completed`는 정확한 후속 Stop을 관찰한 전송 수명 주기 종료이지 작업 성공 판정이 아니다. 성공·실패 outcome과 근거는 별도 이벤트로 모델링해야 한다.
2. 120초는 선택 전 결정 패킷 대기에 적용한다. `internal_format_repair` 제출 토큰의 TTL은 검증하지만, dispatch된 same-turn 작업의 실행 deadline은 아직 없다.
3. 소켓 `0600` 외에 같은 사용자 프로세스를 구분할 IPC 인증이 없다. 제품에서는 launch secret/capability token, peer 검증, 메서드별 권한 분리가 필요하다.
4. coordinator 상태가 메모리에만 있다. 재시작·절전·resume/compact·장시간 대기와 pending Stop 복구가 필요하다.

### Low

- C 런타임 후보는 정식 JSON 파서가 아니므로 성능 기준선으로만 사용한다. 프로토콜 동등성 근거가 아니다.

## 그래프 및 검토 한계

codebase-memory Tier 2 확인에서 `apps/blabee` 범위에 기록된 coverage gap은 없었다. 다만 최종 M0 코드 일부는 그래프 생성 이후 변경되어 `metadata_changed`였으므로, 구현 결론은 최신 소스 직접 읽기와 실행 테스트를 기준으로 했다.
