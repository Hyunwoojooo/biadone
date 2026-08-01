# Human Review — blabase-incremental-memory-architecture-010

상태: `pending`

## 원문 대조

- [ ] 2026년 7월 20일 Blabase 회의 기록이 대화의 배경으로 정확히 반영되어 있다.
- [ ] 대화 분할 단위와 세션 간 관계 연결이 사용자가 제시한 핵심 병목이다.
- [ ] GPT·Gemini·Kimi3의 벡터 공간으로 관련 대화를 직접 판단할 수 있는지 물은 질문이 포함되어 있다.
- [ ] 벡터 후보 검색, LLM 관계 판정, 외부 DB·그래프 저장은 Assistant의 제안으로 구분되어 있다.
- [ ] 생성 모델의 내부 벡터를 Blabase가 직접 공유·접근할 수 있다고 주장하지 않는다.
- [ ] Memory Atom, 3층 처리 구조와 Current State Projection이 미확정 설계 제안으로 표현되어 있다.
- [ ] 기존 모든 weight를 세션마다 갱신할 수 없다는 확장성 문제는 사용자가 추가로 제기했다.
- [ ] append-only, Top-K 국소 연결, 조회 시점 점수 계산과 주기적 통합이 대안으로 정확하다.
- [ ] 계층형 메모리, Hot/Base 인덱스, Sparse Graph와 eventual consistency는 Assistant의 제안이다.
- [ ] 회의 기록에 적힌 결정과 현재 대화에서 사용자가 직접 승인한 사항을 혼동하지 않는다.
- [ ] 전체 구조도 생성 요청과 사용자의 4:3 비율 수정 요구가 최종 이력으로 반영되어 있다.
- [ ] 임베딩 모델, 저장소, Top-K, 가중치와 실제 채택 구조가 미결정으로 남아 있다.
- [ ] 구현 완료, 최종 승인 또는 최적값 검증을 주장하지 않는다.

## 노트 품질

- [ ] 회의 배경, 병목 정의, 관계 구조, 증분형 대안, 구조도 수정까지 순서가 명확하다.
- [ ] 사용자 문제 제기와 Assistant의 기술 설계가 엄격히 구분된다.
- [ ] 이미지 생성 결과와 아키텍처 확정 상태가 혼동되지 않는다.
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
- 전체 메시지는 15개이며 평가 입력은 1-based message index 13까지만 사용한다.
- message 14의 Teacher 프롬프트와 message 15의 Teacher 답변은 candidate 입력에서 반드시 제외한다.
- candidate 메시지 1–13의 SHA-256은 `ff39a72015de2b4703948b5b015fa08912a439b63790b34c3eef8d909c4eb17b`이다.
- message 2·4·11·13은 내부 tool-call 형태 artifact이며 11·13은 이미지 생성 호출이다. 입력에는 유지하되 핵심 기술 근거로 취급하지 않는다.
- 현재 텍스트 어댑터 결과에는 생성된 구조도 이미지 payload가 포함되지 않는다.
