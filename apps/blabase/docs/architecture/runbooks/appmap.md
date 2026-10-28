# AppMap runbook

`appmap-node@2.26.1`을 project-local devDependency로 고정했다. package metadata는 Node `>=18`을 선언하고 이 저장소의 Node `v22.23.2`, Next `15.5.20`, Vitest `3.2.6`에서 deterministic Vitest recording 생성을 확인했다. 제품 Node 버전을 바꾸지 않았다.

## Safety rules

- 운영 데이터, 실제 사용자 공유 URL, 실제 대화, API key, OAuth token, cookie, service-account JSON을 recording에 사용하지 않는다.
- `.env*` 내용을 출력하거나 trace argument로 넘기지 않는다.
- Golden Sheet sync와 실제 LLM provider가 활성화된 시나리오는 기본 trace에서 제외한다.
- recording은 `tmp/appmap/`에만 두며 Git에 커밋하지 않는다.
- 공유가 필요하면 먼저 payload를 열어 민감 정보가 없는지 별도 review한다.
- default config는 LLM provider, Golden Sheet, connector 전체, generated modules를 instrumentation에서 제외한다. `appmap-node@2.26.1`의 `exclude`는 glob이 아니라 literal path substring이므로 `*`를 사용하지 않는다.
- `npm run arch:trace:config:check`는 설치된 AppMap matcher로 민감 경계의 실제 제외 여부와 dev command의 fail-closed 상태를 검사한다.

## Commands

```bash
# deterministic privacy-safe fixture, 약 1초
npm run arch:trace:test

# 개인정보 안전장치: 현재 의도적으로 종료 코드 2로 차단됨
npm run arch:trace:dev
```

test command는 `tests/integration/chatgptShareAdapter.test.ts`의 injected HTML fixture만 사용한다. 현재 세 개의 `.appmap.json`을 `tmp/appmap/vitest/`에 생성한다.

초기 호환성 조사에서는 AppMap wrapper가 loopback Next server를 Ready까지 시작했지만, HTTP recorder가 request/response body와 instrumented argument를 기록하므로 실제 share URL이나 대화가 유입될 수 있음도 확인했다. live synthetic fixture mode가 없는 현재는 `arch:trace:dev`가 설명과 함께 fail-closed로 종료한다. 안전하게 분리된 synthetic-only server/harness를 추가하고 privacy review를 통과하기 전에는 이 명령을 활성화하지 않는다. Next/Turbopack 경로에는 TypeScript-only `enum`, `namespace`, constructor parameter property가 누락될 수 있다는 agent 경고도 있어, 검증된 fixture trace를 기준으로 사용한다.

## Scenario checklist

| 시나리오 | 현재 자동 기록 | 안전한 실행법 |
|---|---:|---|
| 정상 share HTML 복원 | yes | `npm run arch:trace:test` |
| flat/embedded Flight payload 복원 | yes | 같은 fixture test의 두 case |
| 잘못된 URL/upstream 오류 | test exists, not default trace | targeted invalid URL/fetch test만 선택 |
| extraction + evidence validation | manual follow-up | secret 없는 `analysisApi.test.ts` fixture를 확인 후 선택 |
| UI 결과 조회·export | blocked | synthetic-only server/harness 추가 전 dev recording 금지 |
| 사용자 수정·승인·거절 | not applicable | live mutation이 현재 없음 |
| live fixture mode | not applicable | production fixture switch가 현재 없음 |
| suggestion Active Attention | blocked | connector가 없는 전용 in-memory harness를 먼저 추가 |

## IDE에서 열기

AppMap VS Code extension 또는 AppMap을 지원하는 IDE에서 `tmp/appmap/**/*.appmap.json`을 연다. extension 설치는 사용자 선택이며 이 작업은 IDE/global setting을 바꾸지 않는다.

## 기록이 생성되지 않을 때

1. project root에서 `npx appmap-node npx vitest run tests/integration/chatgptShareAdapter.test.ts`를 실행한다.
2. output에 `(Λ) Using config file .../appmap.yml`과 `Wrote ... AppMaps`가 있는지 확인한다.
3. `appmap.yml#appmap_dir`과 package path가 실제 source를 포함하는지 확인한다.
4. `NODE_OPTIONS`에 다른 loader/require hook이 있다면 `env | rg '^NODE_OPTIONS='`로 확인하고 충돌 가능성을 기록한다. 값을 문서에 복사하지 않는다.
5. Next/Vitest upgrade 후 실패하면 agent version·Node version·runner version을 함께 기록하고 isolated fixture로 재현한다.
6. `appmap-node --help`는 일반 CLI help가 아니라 실행할 command로 해석될 수 있다. package README의 wrapper usage를 따른다.

공식 Node agent reference: <https://appmap.io/docs/reference/appmap-node.html>
