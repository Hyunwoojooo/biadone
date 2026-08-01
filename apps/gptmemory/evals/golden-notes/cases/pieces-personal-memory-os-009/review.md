# Human Review — pieces-personal-memory-os-009

상태: `pending`

## 원문 대조

- [ ] 사용자의 명시적 요청이 Pieces OS 같은 제품의 단계별 구현 설명이었다는 점이 정확하다.
- [ ] 직접 복제 대신 기능적 등가의 local-first Personal Memory OS로 재정의한 것은 Assistant의 제안이다.
- [ ] 활동 캡처, 로컬 저장, 기억 가공, 장기기억, 타임라인, 검색과 외부 호출의 전체 흐름이 포함되어 있다.
- [ ] 브라우저·IDE·클립보드·지정 폴더·수동 저장이 초기 수집 대상으로 제안되고 화면·오디오는 후순위다.
- [ ] 로컬 데몬과 API, `raw_events`·`memory_items`·`timeline_blocks` 분리 설계가 정확하다.
- [ ] 정규화, 중복 제거, 민감정보 탐지, 청킹, 요약, 태깅, 임베딩과 중요도 평가가 기억 형성 과정으로 설명되어 있다.
- [ ] 키워드·벡터·시간·앱·프로젝트 필터와 재정렬·근거를 결합한 검색 제안이 반영되어 있다.
- [ ] 앱별 캡처 제어, 선택적 삭제, 로컬 처리·암호화와 클라우드 전송 동의가 핵심 프라이버시 요구로 다뤄진다.
- [ ] 모델 라우팅, 자산 관리, MCP·외부 통합과 기억 계층이 Assistant의 확장 제안으로 구분되어 있다.
- [ ] 로컬 MVP에서 타임라인, 로컬 LLM, OCR·오디오와 선제 제안으로 확장하는 로드맵이 포함되어 있다.
- [ ] 사용자가 기술 스택, MVP 범위, 일정, 기능 또는 출시 방향을 승인했다고 주장하지 않는다.
- [ ] 실제 구현 범위와 개발 착수 여부가 미결정으로 남아 있다.

## 노트 품질

- [ ] 제품 재정의부터 데이터·검색·프라이버시·로드맵까지 단계별로 다시 따라가기 쉽다.
- [ ] 사용자 요청과 Assistant의 모든 설계 제안이 명확히 구분된다.
- [ ] 특정 기술 선택이나 구현 완료를 과장하지 않는다.
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
- 전체 메시지는 14개이며 평가 입력은 1-based message index 12까지만 사용한다.
- message 13의 Teacher 프롬프트와 message 14의 Teacher 답변은 candidate 입력에서 반드시 제외한다.
- candidate 메시지 1–12의 SHA-256은 `a93e93b0b60f90cb5fcda1e45b06a73d798e812c3e90a681f30eadba44690e57`이다.
- message 3–7과 9–11은 내부 tool-call 형태 JSON artifact다. 입력에는 유지하되 사용자 의도나 핵심 대화 근거로 취급하지 않는다.
