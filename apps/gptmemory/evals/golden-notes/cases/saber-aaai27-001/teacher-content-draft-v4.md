> 상태: v4 의미 정답지 초안
> 근거 상태: `sourceMessageIds` 미부여
> 승인 상태: 사람 검수 전
> 평가 사용: 자동 점수화 금지

# SABER 논문 범위와 실험 포지셔닝 정리

## 한눈에 보기

- `saber-rl`을 바탕으로 SABER의 이론, AAAI-27 논문 범위, 실험 해석과 제출 준비를 정리한 대화다.
- SABER는 goal-conditioned critic reweighting으로 정의하되, 논문의 주된 주장과 실험은 sparse-reward HER에 집중하는 방향이 선택되었다.
- 이론·보고서 초안과 사용자의 OpenReview 승인은 완료됐지만, 최종 실험 표와 논문·제출 자료는 아직 완성되지 않았다.

## 핵심 정리

- 내부 실험명 `B3-Critic-only`는 논문에서 **SABER**로 통일됐다.
- SABER는 sparse reward나 HER 자체에 종속되지 않으며, goal-conditioned 환경에서 local replay-action support로 critic Bellman error를 재가중하는 방법으로 정리됐다.
- 논문은 “좁고 강한 main story, 넓은 method definition”을 따른다. Dense reward와 HER-off는 호환성 또는 appendix 범위다.
- 실제 결과를 고려해 FetchPickAndPlace를 중심 근거로 두고 FetchSlide·FetchPush·DrawerOpen의 혼합·불완전 결과를 한계와 보조 분석으로 다루는 안이 제시됐다.
- novelty, support와 TD-error의 실증적 차이, runtime overhead가 주요 방어 과제다.

## 주제별 정리

### 1. 방법 정의와 범위 수정

대화는 GitHub의 `saber-rl` 저장소를 바탕으로 AAAI-27 논문을 준비하기 위해 방법의 이론을 정리하는 요청에서 시작했다. 초기 설명은 저장소 내부 실험명인 B3-Critic-only를 중심으로, HER 학습 배치의 observation·training goal·horizon으로 local context를 만들고 현재 policy action과 같은 action bin이 replay action 집합에 있는지를 support 신호로 쓰는 구조였다.

support-positive sample에는 더 큰 raw weight를 주고 batch 평균으로 정규화해 critic Bellman error에 적용하며 actor는 가중하지 않는 방식이 설명됐다. random, shuffled, actor-critic weighting, TD-error, PER-style와 runtime optimization이 비교·ablation 후보로 함께 정리됐다. 사용자는 B3-Critic-only가 내부 이름일 뿐이므로 논문에서는 **SABER**로 통일한다고 명시했다.

사용자는 SABER가 sparse reward와 HER에만 묶인 것처럼 설명된 점도 수정했다. HER는 transition에 training goal을 붙이는 방법이고 SABER는 형성된 goal-conditioned Bellman update를 local replay-action support로 얼마나 강하게 critic에 반영할지 정하는 별도 구성요소로 재정의됐다. Dense reward와 HER-off에도 정의할 수 있지만 goal-conditioned 환경이라는 전제는 유지된다.

### 2. 논문의 중심 주장

방법 정의를 넓게 둘 수 있다는 사실과 논문의 주장을 어디까지 펼칠지는 분리됐다. 사용자는 dense reward·HER-off까지 범용성을 주장할지, sparse+HER로 좁힐지 물었고, main claim과 실험은 sparse-reward goal-conditioned HER에 집중하면서 method definition만 reward-agnostic하게 유지하는 “좁고 강한 main story, 넓은 method definition”을 선택했다. Dense·HER-off는 compatibility 또는 appendix 후보로 남았다.

논문의 thesis는 HER가 training target을 늘리지만 모든 relabeled Bellman update를 똑같이 신뢰할 수 있게 하지는 않으며, SABER가 local replay-action support를 critic-side reliability signal로 사용한다는 것이다. “HER creates targets; SABER decides which Bellman errors the critic should trust more”라는 표현이 제안됐다. support-positive sample의 target noise가 실제로 항상 낮다는 것은 증명이 아니라 modeling assumption과 실증 가설로 다뤄야 한다.

실제 결과를 반영한 안전한 포지셔닝은 SABER를 새로운 HER 전체 방법이나 MetaCog-RL 전체 구현으로 주장하지 않는 것이다. MetaCog-RL과의 관계도 PRACTICE 또는 incompetence 축에서 파생된 lightweight instantiation으로 제한하고, SOTA보다 명확한 reliability gap, 단순한 critic objective와 mechanism ablation을 중심에 두는 안이 제시됐다.

### 3. 결과 해석과 실험 배치

FetchPickAndPlace에서는 DDPG·TD3·SAC에서 모두 baseline보다 나은 결과가 있어 여러 backbone과 결합 가능하다는 중심 근거로 쓰는 안이 제시됐다. 다만 이를 모든 task·backbone에서 보편적으로 향상된다는 `backbone-agnostic` 주장으로 확대해서는 안 된다는 경계가 붙었다.

FetchSlide는 SAC·TD3에서는 개선되지만 DDPG에서는 그렇지 않은 mixed result라 positive·negative case를 함께 보여주는 보조 결과나 limitation으로 다루는 방안이 제안됐다. FetchPush는 일부 결과 폴더가 완전하지 않아 main table 사용에 신중해야 하고, DrawerOpen은 Random-Support가 강해 핵심 성능표보다 stress-test·external generalization·ablation에 배치하는 안이 나왔다. 사용자가 이 정확한 배치를 최종 확정한 것은 아니다.

추가 방어 작업으로 support indicator와 TD-error의 correlation·top-k overlap, support bin별 TD-error 감소, random·shuffled·actor-critic ablation, runtime-performance plot과 main/appendix result matrix 확정이 제안됐다. 이는 support가 TD-error와 다른 정보를 주는지, 단순 loss weighting 이상의 기여가 있는지, runtime overhead에 비해 성능 이점이 있는지를 보여주기 위한 계획이다. 수행 완료는 확인되지 않았다.

### 4. 문서화와 제출 준비

수정된 이론, 방법 수식, 논문 골격과 실험 지표를 정리한 `SABER_AAAI27_theory_outline.md`가 대화 중 제공됐다. 이후 이번 학기 연구 방향·이론·실험·한계와 방학 계획을 묶은 기말 결과 보고서 초안도 작성됐다. 방학 계획에는 결과표, support-vs-TD-error, ablation, runtime 분석과 논문 초안·figure·appendix 정리가 포함됐지만 완료된 작업으로 볼 수는 없다.

OpenReview 제출 화면을 바탕으로 모든 실제 공동저자를 Authors에 추가하고 순서를 PDF와 맞춰야 하며, metadata에는 실제 저자를 등록하되 double-blind PDF·코드·supplementary에서는 신원을 제거해야 한다는 설명이 이어졌다. 사용자는 자신의 OpenReview 승인은 완료했다고 확인했다. 공동저자 추가, 제목·TL;DR·초록·topic, reproducibility·익명화 자료와 실제 submission 완료는 대화에서 확인되지 않았다.

## 결론과 확정된 결정

- **확정 결정:** 논문 명칭은 SABER로 통일한다.
- **확정 결정:** main story는 sparse-reward goal-conditioned HER에 집중하고, 방법 정의는 reward-agnostic하게 유지한다.
- **확정된 사실:** 사용자의 OpenReview 프로필 승인은 완료됐다.
- **주의:** support-positive sample의 target noise가 항상 낮다는 것은 증명된 사실이 아니라 실증해야 할 가설이다.

## 다음에 할 일

- 명시된 후속 작업 없음.

## 남은 질문

- main table과 appendix에 어떤 task·backbone row를 넣을 것인가?
- support가 TD-error와 다른 정보를 준다는 점과 runtime 대비 효율성을 어떻게 입증할 것인가?
- 공동저자 등록, 최종 metadata와 실제 submission은 완료됐는가?

## 보조 정보

- **실제 산출물:** 대화 중 이론 outline Markdown과 학기 결과 보고서 초안이 제공됐다.
- **검토 중인 제안:** FPP main, FetchSlide·FetchPush 보조, DrawerOpen stress-test 구성과 추가 분석 계획.
- **중요한 제약:** 모든 task·backbone·dense/HER-off 조건의 보편적 향상을 주장하면 안 된다.
