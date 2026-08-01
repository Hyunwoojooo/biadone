# Golden Note Dataset

이 디렉터리는 GPTMemory의 저비용 모델과 프롬프트를 평가하기 위한 기준 사례를
보관한다. ChatGPT 세션이 만든 답변은 바로 정답으로 확정하지 않고
`teacher_draft`로 저장한다. 사람이 원문과 대조해 승인하거나 수정한 뒤에만
`human_reference`로 승격한다.

현재 manifest는 `gptmemory-golden-notes-dev-v1` 개발 데이터셋이다. 12개 사례가
모두 사람 검수 전이므로, 자동 실행 결과를 제품 품질 점수나 Golden 정답으로
표현하지 않는다.

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

ChatGPT adapter v4의 `message.sourceIndex`는 내부 메시지를 정제하기 전 v1의
user/assistant 비어 있지 않은 메시지 번호를 보존한다. 평가 입력은 정제된 메시지
중 `sourceIndex <= lastIncludedMessageIndex`인 항목만 사용한다. 이미지·파일
이벤트는 바로 앞의 source index를 이어받으므로 같은 규칙을 적용한다. 정제 후의
연속 번호인 `message.index`로 cutoff를 적용하면 Teacher turn이 섞일 수 있으므로
사용하지 않는다.

## Baseline runner

프로젝트 루트에서 다음 명령으로 deterministic note baseline을 실행한다. runner는
실수로 네트워크 요청을 보내지 않도록 live fetch에 명시적 opt-in을 요구한다.

```bash
# 공개 공유 URL을 다시 가져와 선택한 사례 실행
npm run eval:golden -- \
  --case blabase-incremental-memory-architecture-010 \
  --allow-live-fetch

# Git에 넣지 않은 로컬 HTML 캡처로 오프라인 실행
npm run eval:golden -- \
  --case blabase-incremental-memory-architecture-010 \
  --html blabase-incremental-memory-architecture-010=<private-html-path>
```

`--case`와 `--html`은 반복할 수 있다. `--case`를 생략하면 12개 전체가 선택된다.
기본 출력은 Git에서 제외된 `outputs/golden-notes/<run-id>/`에 저장된다.
`--output`을 직접 지정하더라도 프로젝트의 `outputs/` 또는 `.local/` 아래만
허용한다. 이는 파생 대화 내용이 실수로 추적 대상 디렉터리에 저장되는 것을 막기
위한 제한이다.

- `report.json`: 버전, 해시, scalar metric, 진단, gate와 오류만 저장
- `summary.md`: 사람이 빠르게 확인할 실행 요약
- `candidates/<case-id>.md`: cutoff 입력에서 만든 파생 노트. 현재 deterministic
  engine은 보이는 원문 표현 대부분을 보존하므로 원문과 같은 수준으로 민감하게 취급

runner는 raw HTML과 복원된 전체 message 배열을 출력 디렉터리에 복사하거나
직렬화하지 않는다. 다만 candidate에는 보이는 대화 내용 전체에 가까운 텍스트가
포함될 수 있는 private artifact이므로 `outputs/` 밖에 복사하거나 Git에 추가하지
않는다. adapter v4는 `sandbox:`, `file-service://`, `/mnt/data/`,
`/home/oai/share/` 형태의 private artifact 참조와 `U+E200 cite`,
`filecite`, `navlist` 제어 구문처럼 보이는 ChatGPT 내부 rich-reference 마커를
candidate에서 제거한다. 원본 출처 URL을 복원할 수 없는 내부 마커이므로 별도의
`[출처]` 텍스트로 바꾸지 않는다.

각 `case.json`에는 사용자가 제공한 공개 공유 URL이 들어 있다. 저장소 접근 범위를
넓히거나 push하기 전에는 해당 URL을 저장소에 유지할 권한, 저장소 공개 범위,
보존 기간을 프로젝트 소유자가 확인해야 한다. 이 결정은 runner가 자동으로 대신할
수 없다.

## 자동 gate와 사람 평가의 경계

자동으로 확인하는 범위는 다음과 같다.

- manifest/case/cutoff 계약과 source message count drift
- `sourceIndex` 기반 Teacher turn 제외
- 알려진 내부 tool/code message의 text 잔존 여부
- message ID 고유성, note provenance와 cutoff 입력의 일치
- schema version, 필수 출력, private artifact URI·rich-reference·Teacher marker 누출

section 수, correction/transition 수, 압축 비율은 진단 값일 뿐 합격 기준이 아니다.
중요한 수정이 보존됐는지, 제안과 사용자 결정을 구분했는지, 미해결 항목을
완료로 쓰지 않았는지는 현재 `review.md`를 따라 사람이 판정한다. 모든 항목은
human reference 승인 전까지 `not_reviewed`와
`not_scored_pending_human_reference`로 기록한다.

## 현재 사례

사례 목록은 [manifest.json](./manifest.json)에서 관리한다.
