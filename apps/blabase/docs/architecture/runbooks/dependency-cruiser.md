# dependency-cruiser runbook

설치 버전은 `18.2.0`이다. repository/cross-boundary pass는 `dependency-cruiser.config.mjs`와 root `tsconfig.json`을, suggestion-native pass는 `dependency-cruiser.suggestion.config.mjs`와 `suggestion/tsconfig.json`을 사용한다. `allowJs:false`인 두 tsconfig가 `.mjs` import를 누락하지 않도록 `dependency-cruiser.scripts.config.mjs`가 발견된 JS/MJS/CJS entry를 tsconfig 없이 별도 검사한다. 생성물과 private data는 source 범위 밖에 둔다.

## Commands

```bash
npm run arch:deps:check
npm run arch:deps:graph
npm run arch:deps:report
```

- `check`: repository-wide, suggestion-native, JS/MJS scripts pass를 연속 실행한다. CI는 두 lockfile을 각각 설치하며 error가 있으면 non-zero다.
- `graph`: bounded-context, main, suggestion, JS/MJS scripts Mermaid 4종을 만든다.
- `report`: repository, suggestion-native, JS/MJS scripts 각각의 HTML/JSON report를 만든다.

결과는 `artifacts/architecture/` 아래 생성되며 Git에서 제외된다. Graphviz는 필요 없다.

## Current policy

| 규칙 | severity | 이유 |
|---|---|---|
| production → tests/fixtures/mocks | error | 현재 위반 없음; 새 결합 차단 |
| unresolvable/undeclared/prod→devDependency | error | build 재현성과 package 경계 |
| main core → UI, main → suggestion | error | 현재 명확한 방향 |
| UI path → server/storage/provider integration | warn | main components와 suggestion 비-API app 경로를 넓게 검사하는 review signal; directive-aware 보안 증명은 아님 |
| UI → storage implementation | warn | 경계 의도는 명확하지만 사람 검수 유지 |
| circular dependency | warn | suggestion 내부 기존 cycle 8건 |
| suggestion → main | warn | legacy 현재 위반 4건; 리팩터링은 별도 작업 |
| ESLint config → transitive `@eslint/eslintrc` | warn | 기존 dev-config 결합 2건; 실행 script의 다른 undeclared package는 error |

warning을 줄이려고 broad exclude를 추가하지 않는다. 경고를 해결한 뒤 baseline이 0이면 해당 rule을 error로 승격하는 별도 architecture decision을 남긴다.

## Focused investigation

machine report에서 특정 file의 inbound/outbound를 볼 수 있다.

```bash
npx depcruise --config dependency-cruiser.config.mjs --focus '^src/core/extractors' --output-type mermaid src tests tools
npx depcruise --config dependency-cruiser.config.mjs --reaches 'analysisStore' --output-type json src tests tools
npx depcruise --config dependency-cruiser.suggestion.config.mjs --focus '^src/attention' --output-type mermaid app src tests tools e2e playwright.config.ts middleware.ts desktop/macos/scripts
```

버전별 option은 `npx depcruise --help`로 확인한다. 정규식은 JavaScript RegExp이며, 너무 복잡한 negative lookahead는 ReDoS guard에 막힐 수 있다.

## Troubleshooting

- `could not find tsconfig`: main command는 프로젝트 root에서 실행한다.
- generated `.next`가 보임: config `includeOnly` 범위를 확인한다. 결과를 숨기기 위해 unrelated source를 exclude하지 않는다.
- alias unresolved: `tsConfig.fileName`과 package-local `tsconfig`를 확인하고, nested app의 alias가 다르면 별도 run으로 분리한다.
- HTML/Mermaid 생성 실패: `node tools/architecture/dependency-artifacts.mjs graph|report`를 직접 실행해 child process stderr를 확인한다.
- 새 cycle: 양방향 import의 최소 path를 report에서 찾고, 의도된 shared contract인지 orchestration leak인지 검토한다.

공식 문법과 options: <https://github.com/sverweij/dependency-cruiser>
