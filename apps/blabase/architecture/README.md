# Official LikeC4 model

`model.c4`는 코드에서 확인한 현재 구현, `planned.c4`는 문서에만 있거나 release gate가 남은 계획을 담는다. `views.c4`는 system/container/component view, `dynamics.c4`는 실제 호출 순서와 deterministic fixture test flow를 담는다. `specification.c4`는 notation과 상태 tag를 정의한다.

```bash
npm run arch:model:check
npm run arch:model:dev
npm run arch:model:build
```

preview는 `127.0.0.1`에만 bind한다. 모델 element와 관계에는 가능한 경우 local source link를 붙인다. 모델이 의도를 표현하더라도 구현 사실의 최종 기준은 소스와 테스트다.

## Editing rule

- 실제 system/container/component/external integration이 바뀌면 `model.c4`와 관련 view를 함께 수정한다.
- 실제 핵심 flow가 바뀌면 `dynamics.c4`와 targeted AppMap scenario를 함께 검토한다.
- 구현 전 설계는 `planned.c4`에만 추가한다.
- 계획이 구현되면 source evidence와 test를 확인한 뒤 `model.c4`로 옮기고 planned element를 제거 또는 축소한다.
- 제출 전 `npm run arch:model:format:check && npm run arch:model:check`를 실행한다.
