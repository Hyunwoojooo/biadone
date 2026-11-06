# codebase-memory-mcp runbook

2026-08-14 검증 시점에 `codebase-memory-mcp 0.10.3`이 `/Users/joo/.local/bin/codebase-memory-mcp`에 설치되어 있고 `codex mcp list`에 enabled 상태로 등록돼 있다. Codex config, durable instruction, skill, `hook-augment` hook도 설치된 내용을 검토했다. UI는 `127.0.0.1:9749`에서 수신 중이다. 현재 실행 중인 Codex process가 등록 전에 시작됐다면 native MCP tool은 재시작 뒤 노출되며, 그 전에도 공식 one-shot CLI를 사용할 수 있다.

## 검증된 local snapshot

- project: `Users-joo-BiaDone-apps-blabase`
- generation: `2026-08-14T06:53:18Z`, full mode, recording complete
- graph: 14,659 nodes, 64,543 edges, status ready
- coverage: 이번 LikeC4 교차검증에 사용한 production evidence 8개 모두 metadata match, recorded issue 없음
- parse partial: suggestion test 22개. 해당 line은 graph 단독 근거로 사용하지 않고 source/test를 직접 확인한다.
- artifact: repository 공유용 `.codebase-memory/graph.db.zst`는 생성하지 않음
- drift result: implemented LikeC4의 분석, sync, legacy restore 핵심 edge는 graph와 source에 일치했다. 모델 변경은 없었고 SwiftPM `.build`/`.swiftpm` ignore 누락만 수정했다.

## macOS 설치 전 검토

공식 repository는 <https://github.com/DeusData/codebase-memory-mcp>다. 설치를 원할 때도 `curl | bash`를 실행하지 않는다.

1. 공식 `install.sh`를 `/tmp`에 파일로 받은 뒤 전체를 읽고 SHA-256을 기록한다. 2026-08-14에 검토한 사본은 `2fdd4d6563fc8e540bb32e233c5fdef22ecf05d7ebd5a80657cd4fec953b3475`였지만, 이후 설치에는 현재 release를 다시 검토한다.
2. installer가 HTTPS release, `checksums.txt`, exact archive namespace, regular-file check, candidate `--version` 검증을 사용하는지 확인한다.
3. 다음 mutation을 확인한다: `$CODEX_HOME/config.toml`, 다른 agent config, shell rc/PATH, hooks, skills/AGENTS, user cache, telemetry/network endpoint.
4. binary만 먼저 설치해 수동 검토하려면 검토한 installer의 `--skip-config` option을 사용한다. agent setup을 허용하면 installer가 Codex MCP config, durable instruction과 hook을 수정할 수 있음을 알고 승인한다.
5. 검토된 installer wrapper에는 `--ui` 설치 flag가 별도로 정의되어 있지 않았다. UI는 별도 variant가 아니라 설치된 native binary에 내장되어 있으므로 실행 시 `--ui=true`를 사용한다.

이 runbook은 특정 release의 install command를 고정하지 않는다. release마다 command와 mutation이 바뀔 수 있으므로 공식 README를 다시 검토한다.

## 연결과 인덱싱

설치 후 Codex를 완전히 재시작하고:

```bash
codex mcp list
```

서버 이름과 상태를 확인한다. Codex hook은 `/hooks`에서 command, working directory, write scope와 trust hash를 검토한다. 프로젝트 root를 최초 index하는 공식 one-shot CLI 형태는 다음과 같다.

```bash
codebase-memory-mcp cli index_repository --repo-path /Users/joo/BiaDone/apps/blabase --mode full --persistence false
codebase-memory-mcp cli list_projects
```

MCP의 `index_status`와 `check_index_coverage`로 현재 generation과 coverage를 확인하고 `src`, `suggestion/app`, `suggestion/src`, tests가 포함됐는지 본다. `.env*`, `.local`, artifacts, AppMap, `.codebase-memory`, SwiftPM `.build`/`.swiftpm`은 `.cbmignore`로 제외한다. coverage는 best-effort 신호이므로 material claim에 사용한 경로를 exact path로 확인하고 source도 직접 읽는다.

자동 인덱싱은 source/commit 변경을 감지하되 generated/private path를 재색인하지 않게 구성한다.

```bash
codebase-memory-mcp config set auto_index true
codebase-memory-mcp --ui=true --port=9749
```

UI는 외부 network가 아닌 `http://localhost:9749`로 접속한다. process가 loopback에만 노출되는지 먼저 확인한다.

## Cache, refresh, and removal

공식 기본 cache는 `~/.cache/codebase-memory-mcp/`, daemon log는 그 아래 `logs/`다. optional project graph artifact는 `.codebase-memory/graph.db.zst`이며 이 저장소 정책은 전체 `.codebase-memory/`를 Git에서 제외한다. 설치된 버전의 실제 경로를 `codex mcp list`와 server logs로 확인한다.

- refresh: code change 후 server의 re-index/update command를 사용하고 coverage/hash를 기록한다.
- disable: Codex MCP registration을 사용자 승인으로 비활성화하고 Codex를 재시작한다.
- remove: `codebase-memory-mcp uninstall`이 제거할 config/hook/index 목록을 먼저 검토하고 confirmation 후 실행한다. user home 전체나 broad glob을 삭제하지 않는다.

## Recommended queries

- 이 저장소의 전체 아키텍처와 주요 entry point를 설명하라.
- 공유 URL 입력부터 결과 표시까지 호출 경로를 추적하라.
- `importChatGPTShareUrl` 또는 `runShadowExtraction`의 inbound/outbound를 보여라.
- 특정 파일을 수정할 때 영향받는 route, component, test를 찾아라.
- extraction과 evidence validation 사이의 실제 경계를 보여라.
- `MemoryAnalysisStore`와 suggestion `.local` 저장 방식·수명을 비교하라.
- 순환 호출 또는 과도하게 결합된 모듈을 찾아라.
- LikeC4 implemented model과 현재 코드 사이의 불일치를 찾아라.

MCP 결과는 탐색 보조다. 수정 전에 대상 source와 test를 직접 열고 dependency-cruiser/AppMap evidence와 교차 검증한다.
