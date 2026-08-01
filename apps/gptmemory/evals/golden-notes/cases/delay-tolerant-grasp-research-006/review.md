# Human Review — delay-tolerant-grasp-research-006

상태: `pending`

## 원문 대조

- [ ] 보유 장비와 역량을 바탕으로 실용적이고 미래 활용성이 있는 Robotics+AI 연구를 탐색한 맥락이 정확하다.
- [ ] 초기 공장 디지털 트윈 구상과 범용성을 우선 목표에서 제외한 판단이 반영되어 있다.
- [ ] 사용자가 궁극적 방향을 Robotics+AI로 설정했고 디지털 트윈과 XR은 보조 인프라로 바뀌었다.
- [ ] PC 부담 때문에 사용자가 디지털 트윈 비중 축소를 요청한 방향 전환이 정확하다.
- [ ] 상위 PC와 저사양 로봇 CPU 구상, 모니터링 부족과 온보드 컴퓨팅 보편화 우려가 함께 반영되어 있다.
- [ ] 계층형 제어, 스킬 명령, 최소 텔레메트리, FSM·Behavior Tree는 Assistant의 제안으로 구분되어 있다.
- [ ] 사용자가 제시한 네 후보가 Delay-Tolerant Grasp, VLM Hindsight Reward, Policy Probing, Sim Replay로 정확하다.
- [ ] Delay-Tolerant Grasp와 두 3DGS 후보를 비교한 기준과 결론이 과장 없이 표현되어 있다.
- [ ] 사용자가 Delay-Tolerant Grasp 심화를 명시적으로 선택한 사실이 분명하다.
- [ ] 지연 분포와 grasp별 접근 시간 `τ(g)`를 함께 고려하는 심화안이 핵심 제안으로 정리되어 있다.
- [ ] min-max·CVaR, 예측기, Policy Probing 결합, 실험 그리드와 최종 아키텍처를 사용자 확정 사항으로 표현하지 않았다.
- [ ] 최종 제목·범위, 지연 모델, 예측기, 위험 기준, grasp 생성법과 실험 시나리오가 미해결로 남아 있다.
- [ ] 우주 로봇 적용, 선행연구 검증, 알고리즘 구현과 실험 완료를 단정하지 않았다.

## 노트 품질

- [ ] 디지털 트윈 중심 탐색부터 Delay-Tolerant Grasp 심화까지 시간 순서가 명확하다.
- [ ] 사용자 확정, Assistant 제안, 미해결 사항이 엄격히 구분된다.
- [ ] 연구 후보와 기호·영문 용어가 일관된다.
- [ ] `현재 도달한 상태`가 정확하고 간결하다.

## Reviewer notes

- 미작성

## 승인

- Reviewer:
- Reviewed at:
- Decision: `pending`
- Human reference path: 미생성

## 수집 시 확인된 기술 메모

- 현재 ChatGPT share adapter가 대화 제목을 `create_time`으로 잘못 추출했다.
- 전체 메시지는 16개이며 평가 입력은 1-based message index 14까지만 사용한다.
- message 15의 Teacher 프롬프트와 message 16의 Teacher 답변은 candidate 입력에서 반드시 제외한다.
- 별도 공유 URL `6a6d943c-2b70-83e8-9ef1-814beaed00cd`의 candidate 14개 메시지는 primary와 SHA-256 기준으로 동일하다.
- 해당 URL의 message 15–18은 두 번의 Teacher 프롬프트·답변이므로 모두 candidate 입력에서 제외한다.
- `teacher-draft-variant-02.md`는 독립 평가 사례가 아니다. 사람 검수 시 primary 초안과 비교해 최종 reference를 작성한다.
