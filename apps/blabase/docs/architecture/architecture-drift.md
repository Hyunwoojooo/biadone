# Architecture drift review

아키텍처 drift는 “모델과 코드가 다르다”는 사실을 먼저 기록하고, 한쪽을 자동으로 정답으로 간주하지 않는다.

## 비교 절차

1. codebase-memory가 사용 가능하면 entry point, inbound/outbound, high-impact symbol을 질의한다. 동시에 `npm run arch:deps:check`와 generated Mermaid/JSON으로 현재 import graph를 추출한다.
2. `architecture/*.c4`의 implemented model/view와 비교한다. planned model은 구현 여부 비교 대상에서 분리한다.
3. 핵심 flow는 privacy-safe fixture로 `npm run arch:trace:test`를 실행하고 AppMap event와 LikeC4 dynamic view 순서를 대조한다.
4. 불일치를 아래 중 하나로 분류한다.

| 분류 | 판단 예 | 처리 |
|---|---|---|
| 코드가 잘못됨 | 승인된 boundary를 새 import가 역행 | 코드 owner가 수정하고 dependency rule 재검사 |
| 모델이 오래됨 | 의도적으로 추가된 실제 container가 누락 | architecture owner가 LikeC4/current-state 갱신 |
| 문서가 부정확함 | symbol·storage lifetime 설명이 코드와 다름 | 문서 source link와 설명 수정 |
| 정적 분석 한계 | dynamic import/provider selection 누락 | AppMap/test evidence를 추가하고 한계 기록 |
| 런타임 조건 차이 | feature flag/env 때문에 trace 분기 미실행 | 조건과 recording run을 별도 기록 |

5. 수정 주체, evidence, 결정일을 PR 또는 작업 기록에 남긴다. 의미적 boundary가 바뀌면 코드 reviewer 외에 architecture owner가 LikeC4 diff를 승인한다.

## Review checklist

- current와 planned가 한 view에서 무표시로 섞이지 않았는가?
- route/component/storage/external integration 이름이 실제 symbol과 맞는가?
- dependency warning을 숨기기 위한 광범위한 exclude가 추가되지 않았는가?
- 새 경고가 기존 baseline인지 새 위반인지 구분됐는가?
- AppMap에 실제 사용자 데이터·credential이 없는가?
- generated artifact가 Git에 들어가지 않았는가?
- model link가 존재하는 경로를 가리키는가?

월 1회 또는 주요 boundary 변경 직후 `npm run arch:check && npm run arch:build`를 실행하고, 대표 fixture trace를 갱신해 dynamic flow를 확인한다.
