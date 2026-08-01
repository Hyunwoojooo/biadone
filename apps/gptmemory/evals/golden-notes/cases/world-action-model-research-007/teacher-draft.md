[REFERENCE_NOTE]

# 로보틱스 소프트웨어의 시장 공백에서 실시간 World Action Model 설계까지

## 개요

대화는 현재 로보틱스 시장의 흐름과 소프트웨어 기술 공백을 파악하려는 질문에서 시작되었으며, 사용자는 당시 메타인지 개념을 적용한 강화학습을 깊게 공부하고 있다고 배경을 밝혔다. 이후 논의는 시장 분석에서 로보틱스 소프트웨어의 first principles로 이동했고, 다시 메타인지라는 기존 관점을 내려놓고 “로봇의 두뇌 역할을 하는 엔진을 처음부터 만든다면 무엇을 연구할 것인가”라는 문제로 재설정되었다. 마지막에는 assistant가 제안한 **contact-aware belief/world model, semantic skill planner, real-time World Action Model, recovery layer**의 결합 구조를 실제 시스템 수준으로 구체화했다.

## 01. 로보틱스 시장 흐름과 소프트웨어 기술 공백

사용자는 현재 로보틱스 시장이 어떤 방향으로 움직이고 있으며, 소프트웨어적으로 어디에 실질적인 기술 공백이 있는지 물었다. 이때 자신이 메타인지 개념을 넣은 강화학습을 깊게 공부해 왔다는 점을 참고 배경으로 제시했다.

assistant는 시장을 산업용·물류 로봇이 실제 매출을 만들고, 휴머노이드와 Physical AI가 투자 기대와 기술 서사를 이끄는 이중 구조로 설명했다. 실제 도입은 물류, 병원·랩 자동화, 청소, 시설 운영처럼 반복적이고 투자수익을 계산하기 쉬운 영역에서 먼저 확대되고 있으며, 휴머노이드는 파일럿과 초기 상용화 단계에 가깝다고 정리했다.

소프트웨어 측면에서는 모델 자체보다 데이터 수집·정규화·재학습을 연결하는 데이터 엔진, 롱테일 실패 감지, 조건부 자율성과 사람 개입, 실패 후 복구, sim-to-real 검증, 운영 시스템 통합과 표준화가 더 큰 공백이라고 제안했다. 특히 assistant는 정책 위에서 자기평가, 불확실성 추정, 실패 감지, 재시도, 사람 호출을 담당하는 메타 계층이 사용자의 메타인지 RL 배경과 잘 맞는 연구 방향이라고 보았지만, 이 단계에서 사용자가 이를 최종 방향으로 확정한 것은 아니었다.

## 02. First principles로 재정의한 로보틱스 소프트웨어의 근본

사용자는 기존의 시장·기술 공백 논의에서 한 단계 더 내려가, first principles thinking으로 로보틱스 소프트웨어의 진짜 근본이 무엇인지 물었다. 이에 assistant는 로보틱스를 단순한 센서 입력에서 행동을 생성하는 문제로 보지 않고, **부분 관측되고 불확실하며 제약이 있는 물리계를 실시간 폐루프로 다루는 문제**로 정의했다.

assistant가 이때 가장 근본적인 요소로 제시한 것은 policy가 아니라 **belief**, 즉 관측과 행동 이력을 바탕으로 현재 세계 상태를 추정한 actionable belief state였다. 이 belief는 세계 전체를 정밀하게 복원하는 표현이 아니라, 다음 행동을 결정하는 데 충분한 객체 상태, 숨은 동역학, 접촉 조건, 불확실성 등을 포함해야 한다고 설명했다. 그 위에 행동 결과를 예측하는 모델, 안전과 안정성을 보장하는 제약, 실시간 마감과 다중 시간축 제어가 결합되어야 하므로, 로보틱스 소프트웨어의 근본을 **“belief-guided, constraint-respecting, real-time feedback”**으로 요약했다.

이 설명에서 assistant는 메타인지를 로봇이 자신의 정책 유효성, 센서 이상, 실패 가능성, 추가 관측 필요성을 추정하는 자기 상태의 일부로 다시 연결했다. 그러나 사용자는 다음 질문에서 이 메타인지 중심 해석을 계속 확장하지 않고, 아예 처음부터 다시 생각하자고 방향을 바꾸었다.

## 03. 메타인지 관점을 내려놓고 로봇 두뇌 엔진을 처음부터 재설계

사용자는 “메타인지고 뭐고 다 처음으로 돌아가서”라고 명시하며 기존의 메타인지 RL 중심 프레임을 일단 제외했다. 이어 assistant가 일론 머스크의 입장이라고 가정하고, 로봇 분야에서 두뇌 역할을 하는 엔진을 만든다면 어떤 연구를 할 것인지 물었다.

assistant는 휴머노이드를 연구 목표 자체가 아니라 하나의 폼팩터로 보고, 목표를 **안전하게 수행되는 유용한 자율 작업 시간**을 최대화하는 범용 로봇 두뇌 엔진으로 설정했다. 이를 위해 객체·접촉·행동 가능성을 추정하는 상태 엔진, 고수준 스킬과 저수준 반사 제어를 분리하는 다중 시간축 아키텍처, 현장 데이터와 실패 사례를 축적하는 데이터 플라이휠, 반사실적 실패를 생성하는 시뮬레이션·world model, 실패 후 재시도와 사람 호출을 담당하는 recovery engine, 서로 다른 로봇 몸체에 전이되는 cross-embodiment 구조를 주요 연구 축으로 제안했다.

또한 자연어 모델은 작업 해석과 고수준 분해에는 유용하지만, 실시간 미세 제어 전체를 담당해서는 안 된다고 보았다. 이 연구 프로그램을 **Real-Time World Action Engine**으로 부르고, 그중 가장 강하게 투자할 후보로 “contact-aware belief/world model 위에 semantic skill planner와 recovery layer를 얹은 실시간 World Action Model”을 제시했다. 사용자는 다음 질문에서 이 문구를 직접 인용하며 더 자세한 설명을 요청했으므로, 이 구조가 이후 논의의 구체적인 대상이 되었다.

## 04. Contact-aware belief/world model과 semantic skill planner

assistant는 전체 구조를 `goal → belief/world model → semantic skill planner → real-time World Action Model → low-level control → recovery layer`의 폐루프로 설명했다. 하나의 거대한 VLA가 카메라 입력에서 곧바로 토크를 생성하는 방식이 아니라, belief를 중심으로 서로 다른 시간 해상도의 계층이 협력하는 구조였다.

contact-aware belief/world model은 단순한 영상 예측기나 3차원 장면 복원기가 아니라, 행동에 필요한 잠재 상태를 추정하고 예측하는 모듈로 정의되었다. 내부 상태에는 물체별 위치·속도·affordance, 로봇과 물체 사이의 contact graph, 관절·그리퍼·힘 센서 상태, 현재 작업 진행 단계, 그리고 각 추정의 불확실성이 포함된다. 이 모델은 특정 행동을 실행했을 때 다음 잠재 상태, 접촉 변화, 작업 진행도, 실패 또는 위험 가능성이 어떻게 변할지를 예측한다.

semantic skill planner는 자연어로 관절 동작을 직접 생성하는 모델이 아니라, 현재 belief와 목표를 바탕으로 `APPROACH`, `GRASP`, `ALIGN`, `PROBE`, `INSERT`, `REGRASP`, `RETREAT`, `ASK_HUMAN` 같은 형식화된 스킬을 선택하는 dispatcher로 설명되었다. 각 스킬은 이름뿐 아니라 실행 전제조건, 입력 파라미터, 성공·종료 조건, 기대 효과, 실패 시 가능한 recovery option을 가져야 한다. 자연어는 목표 해석과 고수준 grounding에 사용하고, 실제 실행은 검증 가능한 skill graph로 내리는 방향이 제안되었다.

## 05. 실시간 World Action Model과 다중 시간축 제어

semantic skill planner가 현재 수행할 스킬을 정하면, real-time World Action Model은 현재 belief와 해당 스킬을 조건으로 짧은 시간 구간의 action chunk를 생성한다. 출력은 단순한 관절 위치뿐 아니라 end-effector 이동량, 회전, 그리퍼 명령, 강성·감쇠·순응성 같은 접촉 제어 파라미터를 포함할 수 있다고 설명했다.

이 구조는 receding-horizon 방식으로 짧은 action chunk를 반복 갱신하며, 고수준 planner, 중간 속도의 World Action Model, 고주파 저수준 제어기를 분리한다. assistant는 예시로 planner는 초당 수 회 이하, World Action Model은 수십 Hz, impedance·torque·safety loop는 수백에서 천 Hz 수준으로 동작하는 다중 시간축 구조를 제안했다. 이는 특정 주파수를 사용자가 확정한 것이 아니라, 언어적 추론과 물리적 제어가 동일한 시간 제약을 갖지 않는다는 점에 근거한 assistant의 설계 권고였다.

## 06. Recovery layer와 커넥터 삽입 예시

recovery layer는 일반 정책에 암묵적으로 포함시키는 기능이 아니라, 실행 상태를 지속적으로 감시하는 별도 감독 계층으로 제안되었다. 이 계층은 world model의 예측과 실제 센서값이 달라지는 prediction mismatch, 작업 진행도가 멈추는 progress stall, 불확실성 급증, 힘·토크·거리와 같은 안전 한계 초과를 감지해 기존 스킬을 수정하거나 교체한다.

복구는 같은 스킬 안에서 속도·강성·그립을 조정하는 micro-recovery, 이전 하위 목표로 돌아가는 meso-recovery, 작업 중단·사람 호출·안전 종료로 넘어가는 macro-recovery로 구분되었다. 예를 들어 커넥터 삽입 작업에서는 `APPROACH → ALIGN → PROBE → INSERT → SEAT` 순서로 진행하되, 카메라가 가려지는 접촉 단계에서는 force와 tactile 신호의 비중을 높인다. 힘이 증가하지만 삽입 진행이 멈추면 즉시 밀어붙이지 않고, 후퇴한 뒤 재정렬하고 다시 탐침하거나, 반복 실패 시 사람 개입으로 전환하는 흐름이 설명되었다.

## 07. 제안된 연구 개발 순서

assistant는 이 엔진을 연구한다면 먼저 물체와 접촉 관계를 명시적으로 표현하는 structured contact latent를 만들고, 다음으로 skill-conditioned world model이 접촉 변화, 진행도, 위험, 종료 조건을 함께 예측하도록 학습하겠다고 제안했다. 이어 progress·success estimator를 독립적으로 강화하고, failure detector와 recovery policy를 분리해 학습한 뒤, 현장 배포에서 수집되는 실패와 사람 개입 데이터를 다시 학습에 반영하는 self-improvement loop를 붙이는 순서를 제시했다.

이 순서는 사용자가 확정한 실행 계획이 아니라 assistant가 제안한 연구 프로그램이다. 다만 사용자는 앞서 해당 아키텍처 자체를 구체적으로 설명해 달라고 선택했으므로, 마지막 시점의 논의 대상은 일반적인 메타인지 RL이 아니라 **접촉 상태를 중심으로 세계를 추정하고, 스킬을 계획하며, 짧은 행동을 실시간 생성하고, 실패를 복구하는 계층형 로봇 두뇌 엔진**으로 좁혀졌다.

## 현재 도달한 상태

대화는 로보틱스 시장의 기술 공백 탐색에서 출발해, 로봇 소프트웨어의 first principles와 범용 로봇 두뇌 엔진의 시스템 구조까지 구체화되었다. 마지막에는 contact-aware belief/world model, semantic skill planner, real-time World Action Model, low-level controller, recovery layer로 구성된 폐루프 아키텍처와 커넥터 삽입 예시, 연구 개발 순서까지 설명되었다. 실제 모델 블록도, 세부 loss function, 학습 데이터 스키마는 아직 작성되지 않았으며, 사용자가 이 아키텍처를 최종 연구 방향으로 확정했다는 발언도 없었다.

[/REFERENCE_NOTE]

[EVALUATION_GUIDE]

## 반드시 포함해야 할 맥락

* 사용자는 처음에 현재 로보틱스 시장의 흐름과 소프트웨어 기술 공백을 물었고, 메타인지 개념을 적용한 RL을 깊게 공부해 왔다고 밝혔다.
* assistant는 실제 매출은 산업용·물류 로봇이, 투자 기대는 휴머노이드·Physical AI가 이끄는 구조로 시장을 설명했다.
* 초기 소프트웨어 공백으로 데이터 엔진, 실패 감지, 조건부 자율성, recovery, sim-to-real 평가, 운영 통합과 표준화가 제시되었다.
* first principles 논의에서 assistant는 로보틱스 소프트웨어의 근본을 actionable belief, 예측, 안전 제약, 실시간 feedback의 결합으로 정의했다.
* 사용자는 이후 “메타인지고 뭐고 다 처음으로 돌아가서”라고 말하며 메타인지 중심 프레임을 일단 제외하고, 로봇 두뇌 엔진을 처음부터 설계하는 질문으로 전환했다.
* assistant는 Real-Time World Action Engine을 제안하고, 가장 강한 연구 후보로 contact-aware belief/world model, semantic skill planner, recovery layer를 결합한 실시간 World Action Model을 선택했다.
* 사용자는 해당 문구를 직접 인용해 더 구체적인 설명을 요청했으며, assistant는 belief/world model, skill planner, action generator, low-level control, recovery의 계층 구조를 설명했다.
* 마지막 설명에는 커넥터 삽입 시나리오, micro·meso·macro recovery, 그리고 structured contact latent부터 배포 후 self-improvement loop까지의 연구 순서가 포함되었다.

## 주요 수정 및 방향 전환

* 시장 흐름과 메타인지 RL에 맞는 기술 공백 탐색 → 로보틱스 소프트웨어 자체의 first principles 탐색
* belief와 자기 불확실성을 메타인지로 연결하는 방향 → 사용자가 메타인지 관점을 일단 제외하고 로봇 두뇌 엔진을 처음부터 재설계
* 범용적인 로봇 두뇌 연구 프로그램 검토 → contact-aware belief/world model, semantic skill planner, recovery layer를 결합한 World Action Model의 구체 설계

## 구분해서 표현해야 할 내용

* **assistant가 제안했지만 사용자가 확정하지 않은 내용:** 메타 계층이 가장 큰 상업적 기술 공백이라는 판단, Real-Time World Action Engine이라는 명칭, 구체적인 다중 시간축 주파수, 연구 개발 순서, 해당 아키텍처가 최우선 연구 투자 대상이라는 평가.
* **사용자가 명시적으로 선택하거나 확정한 내용:** 메타인지 중심 논의를 중단하고 처음부터 다시 보자는 방향 전환, 일론 머스크의 관점에서 로봇 두뇌 엔진 연구를 생각해 보라는 요청, assistant가 제시한 contact-aware belief/world model·semantic skill planner·recovery layer 구조를 더 자세히 설명할 대상으로 선택한 것.
* **아직 해결되지 않은 내용:** 실제 신경망 블록도, 구체적인 loss function, 데이터 필드와 수집·라벨링 방식을 포함한 학습 데이터 스키마는 작성되지 않았다. 사용자가 제안된 아키텍처를 자신의 최종 연구 방향으로 채택했는지도 확인되지 않았다.

## 요약에서 주장하면 안 되는 내용

* 사용자가 contact-aware World Action Model을 최종 연구 주제로 확정했다는 주장.
* 사용자가 메타인지 RL 연구를 완전히 포기하거나 철회했다는 주장.
* 제안된 아키텍처가 실제 제품 또는 실험으로 구현·검증되었다는 주장.
* assistant가 제시한 제어 주파수나 연구 순서가 사용자의 요구사항으로 확정되었다는 주장.
* 사용자가 특정 하드웨어, 센서, 로봇 플랫폼, 예산 또는 사업 분야를 선택했다는 주장.

[/EVALUATION_GUIDE]
