[REFERENCE_NOTE]

# SABER 연구의 이론 정립, AAAI-27 논문 방향 조정, 실험 포지셔닝 및 제출 준비 과정

## 개요

대화는 GitHub의 \`saber-rl\` 저장소를 바탕으로 AAAI-27 논문을 준비하기 위해 SABER의 이론을 정리해 달라는 요청에서 시작되었다. 이후 사용자는 내부 실험명인 B3-Critic-only를 논문에서는 SABER로 통일하고, 알고리즘의 적용 범위가 sparse reward와 HER에 한정되지 않는다고 수정했으며, 최종적으로는 방법 정의는 넓게 유지하되 논문의 핵심 실험과 주장은 sparse-reward goal-conditioned HER에 집중하는 방향을 선택했다. 그 뒤 실제 실험 결과를 고려한 논문 포지셔닝, 학기 결과 보고서 작성, OpenReview 저자 등록과 AAAI-27 제출 전 준비 사항까지 논의가 확장되었다.

## 01. GitHub 저장소를 기반으로 한 SABER 초기 이론 정리

사용자는 \`saber-rl\`을 이용해 AAAI-27 논문을 작성하려고 하며, 우선 SABER가 어떤 방법인지 이론적으로 정리해 달라고 요청했다. Assistant는 저장소의 실험 계획과 구현을 검토한 뒤, 당시 저장소 내부 명칭인 B3-critic-only를 중심으로 방법을 설명했다. 핵심은 HER 학습 배치의 각 sample에 대해 observation, training goal, horizon으로 local context를 만들고, 현재 policy action과 같은 action bin이 그 context의 replay action 집합에 존재하는지를 support 신호로 사용하는 것이었다.

초기 정리에서는 support-positive sample에 (1+\lambda_{\text{support}})의 raw weight를 부여하고, 이를 batch 평균으로 정규화해 critic Bellman error에 적용하며, actor는 가중하지 않는 구조가 강조되었다. 또한 random, shuffled, actor-critic weighting, TD-error, PER-style weighting 및 runtime optimization을 비교군이나 ablation으로 활용하는 실험 구조도 함께 설명되었다.

## 02. 명칭 통일과 적용 범위에 대한 수정

사용자는 B3-Critic-only가 팀 내부에서 사용하는 이름일 뿐이므로 논문에서는 명칭을 **SABER**로 통일하겠다고 명시했다. 또한 SABER가 반드시 HER로 relabel된 sparse-reward 상황에서만 사용되는 것처럼 정리된 부분을 지적하고, dense reward에서도 사용할 수 있다고 이해하고 있다고 수정했다. Goal-conditioned 환경이 필요하다는 전제는 수용했다.

이에 Assistant는 SABER가 sparse reward나 HER 자체에 수학적으로 종속된 방법은 아니라고 정정했다. HER는 어떤 training goal을 transition에 붙일지를 결정하고, SABER는 그렇게 형성된 goal-conditioned Bellman error를 local replay-action support에 따라 얼마나 강하게 critic에 반영할지를 결정하는 독립적인 구성요소로 재정의되었다. Dense reward에서도 reward 함수만 달라질 뿐 support indicator와 critic reweighting은 그대로 적용할 수 있으며, HER-off인 경우에는 original environment goal을 training goal로 사용하면 된다고 설명했다.

## 03. 넓은 방법 정의와 좁은 논문 주제 사이의 선택

사용자는 논문 범위를 sparse+HER로 좁히는 것이 좋은지, dense reward와 HER-off까지 범용적으로 주장하는 것이 좋은지, 다른 관련 논문들은 일반적으로 어떻게 범위를 설정하는지 물었다. Assistant는 HER 확장 연구들이 대체로 방법의 잠재적 적용 범위보다 문제와 실험 범위를 좁게 잡는 경향이 있다고 설명하면서, 논문의 main claim과 실험은 sparse-reward goal-conditioned HER에 집중하고, SABER의 method definition은 reward-agnostic goal-conditioned off-policy actor-critic으로 열어두는 방식을 제안했다.

사용자는 이 방향으로 이론을 다시 정리하고 논문 구조를 잡아 달라고 요청했다. 이로써 논문 방향은 **“좁고 강한 main story, 넓은 method definition”**으로 정리되었다. Dense reward와 HER-off는 본문의 핵심 주장이 아니라 compatibility 또는 generality를 확인하는 보조 실험이나 appendix 후보로 남았다.

## 04. SABER 이론과 AAAI 논문 골격의 구체화

Assistant는 수정된 방향에 따라 논문 thesis를 “HER는 training target을 늘리지만 모든 relabeled Bellman update를 동일하게 신뢰 가능하게 만들지는 않으며, SABER는 local replay-action support를 critic-side reliability signal로 사용한다”로 정리했다. 논문 전체를 관통하는 표현으로는 다음 문장이 제안되었다.

> “HER creates targets; SABER decides which Bellman errors the critic should trust more.”

방법론은 goal-conditioned MDP, HER training goal, local state-goal-horizon context, local replay action-bin set, current policy action의 support indicator, batch-normalized weight, critic-only Bellman objective의 순서로 공식화되었다. SABER를 reliability-weighted Bellman regression의 binary proxy로 해석하되, support-positive sample의 불확실성이 실제로 더 낮다는 점은 증명된 사실이 아니라 modeling assumption과 empirical hypothesis로 다뤄야 한다고 정리했다.

논문 구조로는 Introduction, Related Work, Preliminaries, SABER Method, Theoretical Interpretation, Experiments, Discussion and Limitations, Conclusion이 제안되었다. 실험은 HER baseline, SABER, actor-critic weighting, random, shuffled, TD-error, PER-style, Efficient SABER를 비교하고, Eval AUC, final success, best success, best-to-final drop, steps-to-threshold, runtime 등을 보고하는 방향으로 설계되었다. 사용자의 요청에 따라 이 내용은 \`SABER_AAAI27_theory_outline.md\` Markdown 파일로도 만들어졌다.

## 05. 실제 실험 결과를 반영한 논문 포지셔닝 재조정

이후 사용자는 현재까지의 결과를 고려한 더 구체적인 논문 방향을 제시했다. SABER를 새로운 HER 방법이나 MetaCog-RL 전체 구현으로 주장하지 않고, sparse goal-conditioned off-policy RL에서 HER가 만든 Bellman update의 신뢰도를 local replay-action support로 판정하는 critic-side reweighting 방법으로 포지셔닝하는 것이 가장 안전하다고 보았다. 또한 AAAI 논문에서는 SOTA 주장보다 명확한 문제 정의, 단순한 objective, mechanism ablation이 더 설득력 있다고 정리했다.

실험 배치는 FetchPickAndPlace를 중심으로 하되, 이 환경에서는 DDPG, TD3, SAC 모두에서 SABER가 baseline보다 좋아 backbone 간 호환성을 보여주는 핵심 근거로 사용하고자 했다. FetchSlide는 SAC와 TD3에서는 개선되지만 DDPG에서는 개선되지 않는 결과를 정직한 limitation으로 사용하고, FetchPush는 일부 결과 폴더가 완전하지 않으므로 main table에 신중하게 포함하며, DrawerOpen은 Random-Support가 강하기 때문에 main 결과보다 stress-test나 external generalization, ablation에 배치하는 방향을 제안했다. MetaCog-RL과의 관계도 전체 이론 구현이 아니라 PRACTICE 또는 incompetence 축에서 파생된 lightweight instantiation으로 제한해야 한다고 했다.

Assistant는 이 방향이 현재 아티팩트와 결과에 비추어 가장 방어 가능한 방향이라고 평가했다. 다만 novelty가 단순 loss weighting으로 보일 위험, “backbone-agnostic”을 보편적 성능 향상으로 과장할 위험, DrawerOpen의 Random-Support 결과, support lookup의 runtime overhead를 주요 리스크로 지적했다. 보완책으로 support indicator와 TD-error 사이의 correlation 및 top-(k) overlap 분석, support bin별 TD-error 감소 분석, main/appendix result matrix 확정, runtime-performance plot, task와 backbone에 따른 negative case의 명시적 보고가 제안되었다. 정확히 어떤 실험 row를 main table과 appendix에 넣을지는 아직 확정되지 않은 상태로 남았다.

## 06. 학기 결과 보고서로의 변환

사용자는 지금까지 진행한 SABER 연구를 바탕으로 “이번 학기 진행한 사항과 방학 중 진행하고자 하는 프로젝트”를 정리하는 기말고사 결과 보고서 내용을 요청했다. Assistant는 제출 가능한 형태의 보고서 초안을 작성했다.

보고서에는 연구 개요, 논문 방향성 정립, SABER 수식 정의, MetaCog-RL과의 이론적 계보, FetchPickAndPlace·FetchSlide·FetchPush·DrawerOpen 실험 정리, ablation 설계, 이번 학기 성과, 현재 한계, 방학 중 실험 및 논문 작성 계획이 포함되었다. 방학 계획으로는 main/appendix 실험 표 확정, support-vs-TD-error 분석, random/shuffled/actor-critic ablation 정리, runtime 분석, AAAI-27 논문 초안 작성, figure와 appendix 구성이 제안되었다.

## 07. OpenReview 저자 등록과 AAAI-27 제출 준비

사용자는 AAAI-27 OpenReview submission 화면을 보여주며 제2저자도 \`Authors\` 항목에 넣어야 하는지 물었다. Assistant는 논문에 실제 저자로 들어갈 모든 공동저자를 OpenReview의 Authors 목록에 추가해야 하며, 각 저자가 OpenReview 프로필을 가지고 있어야 하고, 저자 순서도 최종 논문의 순서에 맞춰야 한다고 설명했다. 또한 OpenReview metadata에는 실제 저자를 등록하지만 double-blind review용 PDF에서는 저자명과 소속을 제거해야 한다고 안내했다.

이후 사용자는 자신의 OpenReview 승인이 완료되었다고 알리고, 논문 제출 전에 추가로 해야 할 작업이 있는지 물었다. Assistant는 공동저자 전원의 프로필과 저자 순서 확인, 제목·TL;DR·초록·topic 확정, PDF와 supplementary 자료의 익명화, 페이지 및 포맷 확인, reproducibility checklist 준비, 코드와 데이터의 익명화, 중복 제출 정책 확인, 제출 직전 metadata와 파일 검증 등을 제안했다. 사용자가 완료했다고 명시한 것은 본인의 OpenReview 승인까지이며, 제2저자 추가, 논문 metadata 확정, reproducibility 자료 작성, 실제 submission 완료 여부는 확인되지 않았다.

## 현재 도달한 상태

SABER는 논문에서 **Support-Aware Bellman Error Reweighting**으로 통일되고, sparse-reward goal-conditioned HER를 main problem setting으로 삼되 방법 정의 자체는 reward-agnostic하게 유지하는 방향이 자리 잡았다. 논문의 중심 근거로 FetchPickAndPlace를 사용하고, FetchSlide와 DrawerOpen의 negative 또는 혼합 결과를 limitation과 stress-test로 정직하게 다루는 전략이 제안되었으며, 이론 outline과 학기 결과 보고서 초안도 작성되었다. 사용자의 OpenReview 승인은 완료되었지만, 최종 실험 표 구성, support-vs-TD-error 분석, 논문 본문 작성, 공동저자 등록 및 실제 제출 상태는 아직 대화에서 완료된 것으로 확인되지 않았다.

[/REFERENCE_NOTE]

[EVALUATION_GUIDE]

## 반드시 포함해야 할 맥락

* 대화는 GitHub의 \`saber-rl\`을 이용한 AAAI-27 논문 준비와 SABER 이론 정리 요청에서 시작되었다.
* 초기에는 저장소 내부 명칭인 B3-Critic-only를 중심으로 설명했으나, 사용자가 논문 명칭을 SABER로 통일한다고 수정했다.
* 사용자는 SABER가 sparse reward와 HER에만 한정되지 않는다고 지적했고, Assistant는 reward-agnostic하며 HER와 독립적으로 결합 가능한 critic reweighting 방법으로 정정했다.
* 사용자는 goal-conditioned 환경이 필요하다는 전제는 수용했다.
* 논문은 main claim과 실험을 sparse-reward HER로 좁히고, dense reward와 HER-off는 방법의 잠재적 적용 범위나 보조 실험으로 남기는 방향으로 정리되었다.
* 실제 결과를 반영해 FetchPickAndPlace는 main, FetchSlide는 positive와 negative case를 함께 보여주는 보조 결과, FetchPush는 불완전한 아티팩트를 고려해 신중히 사용, DrawerOpen은 stress-test로 배치하는 방향이 제안되었다.
* Assistant는 support-vs-TD-error 분석, random/shuffled ablation, runtime 분석, main/appendix row 확정을 주요 보완 작업으로 제안했다.
* 이후 학기 결과 보고서 초안이 작성되었고, 사용자는 OpenReview 승인을 완료한 뒤 공동저자 등록과 AAAI-27 제출 전 준비 사항을 질문했다.

## 주요 수정 및 방향 전환

* \`B3-Critic-only라는 내부 명칭 중심 → 논문에서는 SABER로 명칭 통일\`
* \`SABER를 sparse reward + HER 전용으로 설명 → reward-agnostic하며 HER-off에도 정의 가능한 goal-conditioned critic reweighting으로 수정\`
* \`dense/HER-off까지 main claim으로 넓힐 가능성 → main은 sparse-reward HER, dense/HER-off는 compatibility 또는 appendix\`
* \`일반적인 범용 성능 향상 주장 → FetchPickAndPlace 중심의 강한 근거와 FetchSlide DDPG 등 negative case를 함께 제시\`
* \`MetaCog-RL 전체 구현 가능성 → PRACTICE/incompetence 축에서 파생된 lightweight instantiation\`
* \`SOTA 중심 논문 가능성 → 명확한 reliability gap, 단순 objective, mechanism ablation 중심 논문\`
* \`모든 task를 동일한 main benchmark로 취급 → FPP main, FetchSlide/FetchPush 보조, DrawerOpen stress-test\`

## 구분해서 표현해야 할 내용

* **Assistant가 제안했지만 사용자가 완료했다고 확인하지 않은 내용:** support-vs-TD-error correlation 및 overlap 분석, runtime-performance plot, exact main/appendix result matrix, dense/HER-off appendix 실험, \`main.tex\` skeleton 작성, reproducibility checklist와 익명화된 supplementary package 준비.
* **사용자가 명시적으로 선택하거나 확정한 내용:** B3-Critic-only를 SABER로 통일, goal-conditioned 환경을 전제로 수용, main story를 sparse-reward HER로 좁히고 method definition은 넓게 유지하는 방향으로 재정리 요청, 본인의 OpenReview 승인 완료.
* **사용자가 제안했으나 최종 확정 여부가 명시되지 않은 내용:** FetchPickAndPlace를 main result로 두고 FetchSlide·FetchPush·DrawerOpen을 보조적으로 배치하는 상세 실험 구성, 추천 논문 제목.
* **아직 해결되지 않은 내용:** main table과 appendix에 들어갈 정확한 row, 일부 FetchPush 결과 아티팩트의 불완전성, support와 TD-error의 실증적 분리, runtime 대비 효율성, 공동저자 OpenReview 추가 여부, 논문 metadata 및 실제 제출 완료 여부.

## 요약에서 주장하면 안 되는 내용

* SABER 논문의 AAAI-27 accept 가능성이 실제로 높거나 acceptance가 보장된다는 주장.
* SABER가 모든 task, backbone, dense reward, HER-off 환경에서 성능을 향상시킨다는 주장.
* support-positive sample이 실제로 항상 낮은 Bellman target noise를 가진다는 것이 증명되었다는 주장.
* 제2저자가 OpenReview Authors 목록에 실제로 추가되었거나 모든 제출 준비가 완료되었다는 주장.
* AAAI-27 논문 본문, 최종 실험 표, supplementary package 또는 실제 submission이 이미 완성되었다는 주장.

[/EVALUATION_GUIDE]
