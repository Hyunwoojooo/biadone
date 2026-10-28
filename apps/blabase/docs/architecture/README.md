# Blabase architecture visibility

이 디렉터리는 코드 변경 없이 현재 구조를 관찰하고, 팀이 승인한 모델과 실제 구현 사이의 drift를 검증하는 운영 진입점이다.

## Source of truth

| 질문 | 기준 |
|---|---|
| 실제 구현 사실 | 소스코드와 테스트 |
| 정적 import·dependency | dependency-cruiser |
| 실제 실행 경로 | AppMap recording |
| 팀이 승인한 공식 모델 | LikeC4의 `architecture/*.c4` |
| AI 구조 질의·영향도 탐색 | codebase-memory-mcp |

어느 하나가 다른 자료를 대신하지 않는다. 예를 들어 AppMap에 나타나지 않은 코드는 미실행 분기일 수 있고, LikeC4에 나타난 관계가 코드와 다르면 모델 또는 코드 중 어느 쪽이 오래됐는지 조사해야 한다.

## 도구별 역할

- **dependency-cruiser**: 두 npm 프로젝트의 TypeScript import와 별도 JS/MJS script graph, cycle, undeclared dependency와 test/production 경계를 비대화형으로 검사한다. UI→server 규칙은 경로 기반 warning이며 완전한 보안 증명으로 사용하지 않는다.
- **LikeC4**: 사람이 검수하고 Git으로 관리하는 공식 architecture model이다. `implemented`와 `planned`를 별도 모델·뷰로 유지한다.
- **AppMap**: fixture 또는 허가된 로컬 입력으로 실제 함수 호출과 HTTP 흐름을 기록한다. recording 자체는 Git에 넣지 않는다.
- **codebase-memory-mcp**: symbol inbound/outbound와 영향도를 대화형으로 탐색한다. 로컬 도구 설치·Codex 등록과 Blabase full index를 검증했으며, 현재 실행 중인 Codex process가 등록 이전에 시작됐다면 재시작 후 native MCP 도구를 사용한다.

## 가장 자주 쓰는 순서

```bash
cd apps/blabase
npm run arch:check
npm run arch:build
npm run arch:trace:test
```

| 변경 유형 | 필수 명령 | 함께 갱신할 자료 |
|---|---|---|
| import·module 이동 | `npm run arch:deps:check` | dependency rule 또는 current-state |
| system/container/component 경계 | `npm run arch:check` | `architecture/*.c4`, current-state |
| 핵심 사용자 flow | `npm run arch:check && npm run arch:trace:test` | dynamic view, AppMap 시나리오 |
| 계획만 변경 | `npm run arch:model:check` | `architecture/planned.c4`와 planned view |
| release 전 | `npm run arch:check && npm run arch:build` | drift review |

## 결과 위치

- Mermaid: `artifacts/architecture/dependencies*.mmd`
- dependency HTML report: `artifacts/architecture/dependency-report.html`
- dependency machine report: `artifacts/architecture/dependency-cruiser.json`
- suggestion-native reports: `artifacts/architecture/dependency-report-suggestion.html`, `dependency-cruiser-suggestion.json`
- JS/MJS reports: `artifacts/architecture/dependency-report-scripts.html`, `dependency-cruiser-scripts.json`
- LikeC4 static site: `artifacts/architecture/likec4/index.html`
- AppMap: `tmp/appmap/**/*.appmap.json`
- 보조 current-flow HTML: `docs/architecture-current.html` (Archify로 생성)

`artifacts/architecture/`, `tmp/appmap/`, `.codebase-memory/`는 generated/private output으로 Git에서 제외한다.

## 신규 팀원 온보딩

1. Node `22.23.2` 이상과 npm을 준비한다. 저장소에는 아직 Node version pin이 없으므로 CI와 동일한 Node 22를 권장한다.
2. main에서 `npm ci`, suggestion에서 `npm ci`를 실행한다.
3. [current-state.md](current-state.md)와 `architecture/README.md`를 읽는다.
4. `npm run arch:check && npm run arch:build`로 공식 모델과 정적 경계를 확인한다.
5. 로컬 fixture trace는 [runbooks/appmap.md](runbooks/appmap.md)에 따라 생성한다.
6. codebase-memory는 [runbooks/codebase-memory.md](runbooks/codebase-memory.md)의 검증된 project name과 coverage 절차로 현재 generation을 확인한다. 새 설치·업데이트 때는 installer를 다시 검토한다.

## 민감 데이터

실제 사용자 대화, 운영 URL, API key, OAuth token, cookie, service-account JSON을 AppMap 또는 generated graph에 사용하지 않는다. `.env*`와 `.local/`은 분석 대상에서 제외한다. `.env.example`에는 실제 값이 없어야 한다. Golden Sheet와 GPT audit 경로는 원문을 포함할 수 있으므로 로컬에서도 최소 권한으로 다룬다. 현재 interactive AppMap dev trace는 개인정보 보호를 위해 fail-closed이며 fixture test만 허용한다.

## 변경·문제 해결

- drift 처리: [architecture-drift.md](architecture-drift.md)
- dependency-cruiser: [runbooks/dependency-cruiser.md](runbooks/dependency-cruiser.md)
- LikeC4: [runbooks/likec4.md](runbooks/likec4.md)
- AppMap: [runbooks/appmap.md](runbooks/appmap.md)
- codebase-memory: [runbooks/codebase-memory.md](runbooks/codebase-memory.md)
- 실행 이력: [implementation-log.md](implementation-log.md)

코드와 문서가 다르면 차이를 숨기지 않는다. 실제 구조가 의도된 변경이면 코드와 함께 모델을 갱신하고, 의도하지 않았다면 코드 또는 규칙을 수정하며, 판단이 끝나지 않았으면 `uncertain` 상태와 근거를 남긴다.
