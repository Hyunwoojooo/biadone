# Golden Note Dataset

이 디렉터리는 GPTMemory의 저비용 모델과 프롬프트를 평가하기 위한 기준 사례를
보관한다. ChatGPT 세션이 만든 답변은 바로 정답으로 확정하지 않고
`teacher_draft`로 저장한다. 사람이 원문과 대조해 승인하거나 수정한 뒤에만
`human_reference`로 승격한다.

## 사례 구성

각 사례는 다음 파일로 구성한다.

- `case.json`: 공유 URL, 입력 cutoff, 상태, artifact 경로
- `teacher-draft.md`: 강한 모델이 만든 기준 노트와 평가 가이드
- `review.md`: 사람의 검수 체크리스트와 수정 기록

원문 HTML이나 전체 대화 사본은 저장하지 않는다. 평가 시 `case.json`의 공유
URL에서 대화를 복원하되, 반드시 cutoff 이후의 Teacher 요청과 답변을 제거한다.

## 상태

1. `teacher_draft_pending_human_review`
2. `human_reference_approved`
3. `active_eval_case`
4. `retired`

## 누출 방지

저비용 모델에는 `inputCutoff.lastIncludedMessageIndex`까지만 입력한다. Teacher
프롬프트와 Teacher 답변이 포함된 마지막 메시지를 입력에 넣으면 해당 사례는
평가 데이터로 사용할 수 없다.

## 현재 사례

사례 목록은 [manifest.json](./manifest.json)에서 관리한다.
