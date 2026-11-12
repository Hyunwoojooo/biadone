# 공개 릴리스 절차

2026-11-12부터 공개 릴리스는 `scripts/release/release.mjs` 하나로 진행한다. r89~r91은 릴리스마다 gitignore된
`build/release-public-*/` 폴더에 스크립트를 복사하고 빌드 번호와 경로를 손으로 고쳤다. r91은 전체 테스트와 번들 런타임 검사보다
공증이 먼저 끝났고, r90은 공증 뒤에 번들 런타임 검사로 폐기됐다. 이 드라이버는 그 순서를 코드로 막는다.

## 사용

```sh
npm run release -- all --build 92
# 또는 단계별
npm run release -- preflight --build 92
npm run release -- test --build 92
...
```

| 단계 | 하는 일 | 앞 단계 증거 없이 실행하면 |
| --- | --- | --- |
| `preflight` | `apps/blabee` 작업 트리가 깨끗한지, 커밋, 입력 지문, 이전 서명 앱·Node 런타임 위치 기록 | - |
| `test` | `npm run test:release`(루트 Node, Cloud SQL, Claude 브릿지 Node·shared-engine, Swift 전체) | 거부 |
| `prepare` | Claude 런타임 payload 준비 | 거부 |
| `package` | `npm run test:t012` | 거부 |
| `build` | `scripts/build-release-dmg.mjs` | 거부 |
| `inspect` | DMG·앱 서명, Info.plist, 계약 pin, 번들 Claude 소스와 checkout 일치, 홈 경로 미포함 | 거부 |
| `payload` | 서명된 앱의 실제 번들 런타임을 앱이 받아들이는지(`ClaudeRuntimePayloadTests/actualPackagedRuntime`) | 거부 |
| `notarize` | `npm run notarize:dmg` | 거부. 되돌릴 수 없는 단계라 `test`·`payload` 통과 기록이 없으면 제출하지 않는다 |
| `finalize` | stapler, Gatekeeper, 공증 전후 앱 동일성, provenance(커밋 포함) | 거부 |

- 각 단계는 릴리스 폴더에 `step-<단계>.json`을 남긴다. 다시 실행하면 기존 기록을 덮어쓰지 않고 실패한다. 다시 하려면 해당 파일을 지운다.
- `test` 이후 모든 단계는 입력 지문이 그대로이고 작업 트리가 깨끗한지 다시 확인한다. 그래서 provenance의 `source_commit`이 실제 빌드 소스다.
- 이전 서명 앱과 Node 런타임은 기본값으로 가장 최근의 **마무리된** 릴리스 폴더에서 찾는다(폐기된 r90 같은 폴더는 건너뛴다). `--previous-app`, `--node-runtime`으로 지정할 수 있다.
- 버전별 확인(예: r91의 Codex 0.166.0 CDHash 포함 여부)은 드라이버에 넣지 않는다. 필요하면 해당 기능의 테스트로 넣는다.

## 아직 수동인 것

`finalize`가 출력하는 체크리스트를 따른다.

1. 태그 `blabee-v0.1.0+build.N`을 provenance의 커밋에 만들고 푸시한다.
2. GitHub 릴리스(`Hyunwoojooo/biadone`)에 DMG와 `.sha256`을 올린다. r91 폴더의 `github-publication/*.py`를 참고한다.
3. `README.md`·`README.ko.md`의 다운로드 링크와 공개 문서 저장소(`Biadone/blabee`)를 갱신한다.
4. 이전 빌드에서 앱 안 업데이트로 새 빌드를 설치해 본다. 지금까지 릴리스 검증에서 한 번도 실행되지 않은 경로다.

CI는 없다. `npm run test:release`를 로컬에서 돌리는 것이 유일한 게이트다(`docs/development/CI_CD_DESIGN.md`는 미구현 설계).
