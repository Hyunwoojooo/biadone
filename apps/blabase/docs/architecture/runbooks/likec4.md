# LikeC4 runbook

설치 버전은 `1.59.2`이며 Node `22.23.2`에서 검증했다. source root는 `architecture/`, generated site는 `artifacts/architecture/likec4/`다.

## Commands

```bash
npm run arch:model:format
npm run arch:model:check
npm run arch:model:dev
npm run arch:model:build
```

`arch:model:dev`는 `127.0.0.1`에만 bind한다. `arch:model:build`는 Playwright나 PNG export 없이 static site를 만든다.

## Model conventions

- `model.c4`: code/test evidence가 있는 implemented architecture
- `planned.c4`: 계획, release gate, live-wiring이 없는 구조
- `views.c4`: system context, containers, main/suggestion component, planned views
- `dynamics.c4`: share URL, Active Attention, deterministic fixture flows
- `specification.c4`: person/system/application/component/datastore/external notation과 tags

tag는 element block의 다른 property보다 먼저 와야 한다. link는 model file 기준 relative local path다. external system도 adapter 또는 route call이 실제 코드에 있을 때만 current model에 넣는다.

## Change review

1. source/test evidence를 찾는다.
2. current인지 planned인지 먼저 결정한다.
3. element/relationship/dynamic step을 최소 범위로 수정한다.
4. `npm run arch:model:format:check && npm run arch:model:check`를 실행한다.
5. `npm run arch:model:build` 후 static site의 view navigation과 겹침을 확인한다.

## Troubleshooting

- `Could not resolve reference`: fully qualified path와 element scope를 확인한다.
- tag 뒤 parse error: `#tag`가 description/technology/link보다 앞에 있는지 확인한다.
- dynamic view actor가 비어 있음: model parse error를 먼저 고친 뒤 relationship source/target을 확인한다.
- source link 404: `architecture/` 기준 `../src/...`, `../suggestion/...` 경로를 확인한다.
- preview port 충돌: `npx likec4 start architecture --listen 127.0.0.1 --port <local-port>`를 사용한다.

공식 CLI/DSL: <https://likec4.dev/tooling/cli/> · <https://likec4.dev/dsl/>
