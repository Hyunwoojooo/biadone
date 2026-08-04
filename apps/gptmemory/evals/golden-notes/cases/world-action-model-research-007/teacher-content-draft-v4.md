> 상태: v4 의미 정답지 초안
> 근거 상태: `sourceMessageIds` 미부여
> 승인 상태: 사람 검수 전
> 평가 사용: 자동 점수화 금지

# 로봇 두뇌 엔진과 실시간 World Action Model 구상

## 한눈에 보기

- 로보틱스 시장의 소프트웨어 공백을 출발점으로 로봇 소프트웨어의 first principles와 범용 두뇌 엔진 구조를 탐색했다.
- 사용자는 메타인지 중심 틀을 잠시 내려놓고 처음부터 다시 보자고 했으며, 제안된 contact-aware World Action Model 구조를 자세히 설명받았다.
- 계층형 아키텍처와 recovery 예시는 구체화됐지만 최종 연구 주제, 모델·loss와 데이터 설계는 확정되지 않았다.

## 핵심 정리

- 시장은 산업·물류 로봇이 실제 매출을, 휴머노이드·Physical AI가 투자 기대를 이끄는 구조로 설명됐다.
- 소프트웨어 공백으로 데이터 엔진, 롱테일 실패 감지, 조건부 자율성, recovery, sim-to-real 검증과 운영 통합이 제안됐다.
- first principles 관점에서 핵심은 policy 하나가 아니라 actionable belief, 행동 결과 예측, 안전 제약과 실시간 feedback의 결합이다.
- 구체 설명 대상으로 선택된 폐루프는 `goal → belief/world model → semantic skill planner → World Action Model → low-level control → recovery`다.
- recovery는 예측 불일치·진행 정체·불확실성·안전 한계를 감시하고 micro·meso·macro 수준으로 대응한다.

## 주제별 정리

### 1. 시장 공백에서 근본 문제로

사용자는 로보틱스 시장이 어디로 움직이고 소프트웨어적으로 어떤 실질적 공백이 있는지 물었으며, 메타인지 개념을 적용한 강화학습을 깊게 공부해 왔다고 밝혔다. 시장은 산업용·물류 로봇이 실제 매출을 만들고 휴머노이드·Physical AI가 투자 기대와 기술 서사를 이끄는 이중 구조로 설명됐다. 실제 도입은 물류·병원·랩·청소·시설 운영처럼 반복성과 ROI가 분명한 영역이 앞서 있다는 분석이었다.

소프트웨어 공백으로는 모델 자체보다 데이터 수집·정규화·재학습의 데이터 엔진, 롱테일 실패 감지, 조건부 자율성과 사람 개입, 실패 후 recovery, sim-to-real 검증, 운영 시스템 통합·표준화가 제시됐다. 정책 위에서 자기평가와 불확실성·실패를 감지하는 메타 계층도 사용자의 배경에 맞는 후보로 제안됐으나 사용자가 확정한 연구 방향은 아니었다.

first principles 질문에서는 로보틱스를 부분 관측되고 불확실하며 제약이 있는 물리계를 실시간 폐루프로 다루는 문제로 다시 정의했다. 근본 요소는 policy 하나가 아니라 관측·행동 이력에서 현재 세계를 추정하는 actionable belief, 행동 결과 예측, 안전 제약과 다중 시간축 feedback의 결합이라는 설명이다. 세계 전체를 정밀 복원하기보다 다음 행동에 필요한 객체·숨은 동역학·접촉·불확실성을 표현하는 belief가 중심에 놓였다.

### 2. 메타인지 프레임의 일시적 제외

사용자는 “메타인지고 뭐고 다 처음으로 돌아가서”라고 말하며 기존 프레임을 잠시 내려놓고, 일론 머스크의 입장에서 로봇의 두뇌 역할을 하는 엔진을 만든다면 어떤 연구를 할지 물었다. 이는 메타인지 RL을 영구히 포기했다는 결정이 아니라 해당 질문에서 처음부터 다시 설계해 보라는 방향 전환이다.

Assistant는 휴머노이드를 연구 목표가 아닌 하나의 폼팩터로 보고, 안전하게 수행되는 유용한 자율 작업 시간을 늘리는 범용 로봇 두뇌 엔진을 제안했다. 상태 엔진, 고수준 스킬과 저수준 반사 제어를 나누는 다중 시간축 구조, 현장 실패 데이터를 쌓는 데이터 플라이휠, 반사실 실패를 만드는 시뮬레이션·world model, recovery와 cross-embodiment가 연구 축으로 제시됐다.

이 프로그램에는 Real-Time World Action Engine이라는 이름이 붙었고, 가장 강하게 투자할 후보로 contact-aware belief/world model, semantic skill planner, real-time World Action Model과 recovery layer의 결합이 추천됐다. 사용자는 이 문구를 직접 인용해 더 자세한 설명을 요청했지만 자신의 최종 연구 주제로 채택한다고 말한 것은 아니다.

### 3. 계층형 World Action Model

전체 폐루프는 `goal → belief/world model → semantic skill planner → real-time World Action Model → low-level control → recovery`로 설명됐다. 하나의 거대한 VLA가 카메라에서 바로 토크를 생성하기보다, belief를 중심으로 다른 시간 해상도의 모듈이 협력하는 구조다.

contact-aware belief/world model은 영상 예측이나 3D 복원만 하는 모듈이 아니다. 물체별 위치·속도·affordance, 로봇과 물체의 contact graph, 관절·그리퍼·힘 상태, 작업 단계와 각 추정의 불확실성을 행동 가능한 잠재 상태로 표현한다. 특정 행동을 했을 때 다음 잠재 상태, 접촉 변화, 작업 진행도와 실패·위험이 어떻게 변할지도 예측하는 안이다.

semantic skill planner는 자연어에서 관절 명령을 직접 만드는 것이 아니라 belief와 목표를 바탕으로 `APPROACH`, `GRASP`, `ALIGN`, `PROBE`, `INSERT`, `REGRASP`, `RETREAT`, `ASK_HUMAN` 같은 검증 가능한 스킬을 선택한다. 각 스킬에는 전제조건, 파라미터, 성공·종료 조건, 기대 효과와 실패 시 recovery option을 갖게 하는 구성이 제안됐다. 자연어 모델은 목표 해석·고수준 분해에 쓰고 실제 실행은 형식화된 skill graph로 내린다.

World Action Model은 선택된 스킬과 현재 belief를 조건으로 짧은 action chunk를 receding-horizon 방식으로 반복 생성한다. end-effector 이동·회전·그리퍼뿐 아니라 강성·감쇠·순응성 같은 접촉 제어 파라미터도 출력 후보로 제시됐다. planner, 수십 Hz 수준의 action generator, 수백~천 Hz 안전·impedance loop를 분리하는 예가 들었지만 구체 주파수는 설계 권고이지 사용자 요구사항이 아니다.

### 4. 실패 복구와 연구 순서

recovery layer는 일반 policy 안에 암묵적으로 숨기지 않고 실행을 감시하는 별도 감독 계층으로 제안됐다. world model 예측과 센서값의 불일치, 작업 진행 정체, 불확실성 급증, 힘·토크·거리의 안전 한계 초과를 감지한다. 같은 스킬 안에서 속도·강성·grip을 바꾸는 micro-recovery, 이전 하위 목표로 돌아가는 meso-recovery, 작업 중단·사람 호출·안전 종료로 넘어가는 macro-recovery로 구분됐다.

커넥터 삽입은 `APPROACH → ALIGN → PROBE → INSERT → SEAT`의 예로 설명됐다. 접촉 때문에 카메라가 가려지는 단계에서는 force·tactile 신호 비중을 높이고, 힘은 증가하지만 삽입 진행이 멈추면 계속 밀지 않는다. 후퇴해 재정렬하고 다시 탐침하며, 반복 실패하면 사람에게 넘기는 흐름이다.

연구 순서는 물체와 접촉을 명시적으로 표현하는 structured contact latent, 스킬 조건부로 접촉 변화·진행·위험·종료를 예측하는 world model, 별도의 progress·success estimator, failure detector와 recovery policy, 배포 후 실패·사람 개입 데이터를 다시 학습하는 self-improvement loop 순으로 제안됐다. 이 순서와 아키텍처는 구체화된 연구 프로그램이지만 실제 모델 블록, loss function, 데이터 수집·라벨링 스키마나 구현 결과는 없다.

## 결론과 확정된 결정

- **확정된 방향 전환:** 메타인지 중심 해석을 잠시 제외하고 로봇 두뇌 엔진을 처음부터 재탐색한다.
- **확정된 요청:** contact-aware belief/world model·skill planner·recovery 구조를 상세 설명 대상으로 선택했다.
- **주의:** 이 구조를 최종 연구 주제로 채택한 것은 아니다.

## 다음에 할 일

- 명시된 후속 작업 없음.

## 남은 질문

- 이 아키텍처를 실제 연구 방향으로 채택할 것인가?
- 신경망 블록, loss function과 학습 데이터 스키마는 어떻게 설계할 것인가?
- 어떤 로봇·센서·작업에서 검증할 것인가?

## 보조 정보

- **검토 중인 제안:** Real-Time World Action Engine 명칭, 다중 시간축 주파수, structured contact latent부터 시작하는 연구 순서.
- **중요한 제약:** 제안된 시스템이나 주파수가 구현·검증 또는 사용자 확정됐다고 표현하면 안 된다.
