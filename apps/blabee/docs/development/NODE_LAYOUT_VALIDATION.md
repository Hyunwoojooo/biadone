# Node 실패 케이스 디렉터리 이동 비교 — 2026-09-20

## 결론과 범위

재구성 worktree의 전체 Node 실행은 **432 pass / 10 fail / 1 skip**이었다.
실패한 5개 파일의 10개 테스트 이름만 기존 HEAD 복사본에서 다시 실행했다.
**10개 모두 같은 테스트명과 오류 범주로 재현됐다.**
새 디렉터리 구조에서만 나타난 실패는 이 비교에서 관찰되지 않았다.
전체 테스트가 통과했다거나 10개 오류를 해결했다는 의미는 아니다.

두 실행은 같은 Mac의 `/private/tmp` 작업 복사본을 사용했다.
따라서 같은 실패가 재현됐다는 사실만으로 원래 `/Users/joo/...` checkout에서도
항상 실패한다거나 환경과 무관한 제품 결함이라고 단정하지 않는다.
특히 경로 정규화·프로세스 FD·도구 버전 등의 환경 요인은 별도로 구분해야 한다.

## 실행 전 격리 확인

- `Tests/CoordinatorPersistence/runtime-harness.mjs`는 Swift 빌드마다
  `/tmp/blabee-t007b-swift-build-*` 또는 `/tmp/blabee-t007b-product-swift-build-*`를 만든다.
  패키지의 기존 `.build`나 설치 앱을 사용하지 않는다.
- DB·키 파일은 테스트가 생성한 `blabee-t007b-*` 임시 디렉터리에만 둔다.
- Keychain 계정 생성·정리는 `test-<32자리 hex>` namespace를 검증한다.
  `primary` 등을 전달하는 거부 테스트는 namespace 검증이 저장소 접근 전에 실행됨을 확인했다.
- local-dogfood는 임시 출력 디렉터리와 fixture 실행 파일을 사용한다.
  Codex lifecycle을 수행하는 경로도 테스트용 `CODEX_HOME`으로 격리되어 있다.
  이번 실행에서는 그 이전의 runtime lease probe에서 실패했다.
- Codex compatibility 테스트는 inert fixture와 주입된 실행기를 사용한다.
- 원래 checkout을 실행하거나 tracked 파일을 수정하지 않았다.
  기존 HEAD 복사본의 테스트·스크립트도 내용 변경 없이 사용했다.
- 설치 앱, 실행 중인 서비스·세션, 사용자 DB·계정 Keychain을 변경하지 않았다.

## 입력과 명령

비교 복사본:

```text
/private/tmp/blabee-layout-swift-baseline-comparison/blabee
```

앞선 Swift 비교에서 사용한 복사본에 기존 HEAD의 Node Tests, scripts, 루트 안내 문서,
package.json/lock을 추가했다. Swift `Package.swift`도 HEAD 원문으로 복구했다.
Swift 테스트 제외 같은 수정은 이 Node 비교에 사용하지 않았다.
Plugin·Contracts·Fixtures·Packaging은 기존 HEAD의 원래 경로를 유지했다.
Ajv 등은 이미 설치된 격리 worktree의 `node_modules`를 읽기 전용 import에 재사용했다.
의존성을 새로 설치하지 않았다.

Node 실행 버전은 `v22.23.2`이며 실제 실행 파일은 `/Users/joo/.hermes/node/bin/node`다.
공용 Swift 테스트 잠금 아래 Node 파일을 직렬로 실행했다.

```sh
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  /usr/bin/lockf -t 0 -k -w /tmp/blabee-coordinator-swift-tests.lock \
  node --test --test-concurrency=1 \
  --test-name-pattern='^(Keychain test operations|product coordinator persists two|product adapter accepts|preparation creates a|rotation preflight defers|preparation passes verified|preparation CLI accepts one|two prepared marketplaces|repeated and concurrent preparation|optional plugin lifecycle)' \
  Tests/CoordinatorPersistence/coordinator-persistence.test.mjs \
  Tests/CoordinatorPersistence/same-turn-repeat-product-gate.test.mjs \
  Tests/CoordinatorPersistence/semantic-product-gate.test.mjs \
  Tests/LocalDogfood/local-dogfood-preparation.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs
```

## 비교 결과

| 테스트 파일 | 비교한 실패 수 | 재구성본과 HEAD 복사본에서 일치한 관찰 |
| --- | ---: | --- |
| coordinator-persistence.test.mjs | 1 | `read descriptor unavailable did not fail with invalid_arguments` |
| same-turn-repeat-product-gate.test.mjs | 1 | 응답 전 coordinator 종료: `code=1, signal=null` |
| semantic-product-gate.test.mjs | 1 | 응답 전 coordinator 종료: `code=1, signal=null` |
| local-dogfood-preparation.test.mjs | 6 | `runtime use lease protocol probe returned an unsupported response` |
| codex-compatibility-qualification.test.mjs | 1 | `cli_contract_malformed`: 설치 Plugin 식별·활성 상태 불일치 |

비교 실행 결과는 **tests 10 / pass 0 / fail 10**, exit 1이다.
절대 checkout 경로와 테스트 임시 디렉터리의 난수는 비교 대상으로 삼지 않았다.
전체 테스트 이름과 구체적인 오류 범주를 대조했으며 10개 모두 일치했다.

추가로 소스에서 확인한 fixture 불일치:

- local-dogfood의 가짜 coordinator에는 `runtime-use-lease-protocol` 응답 분기가 없다.
  앱 조립 스크립트는 `blabee.runtime-use-lease.v1` 응답을 요구한다.
- compatibility의 가짜 Plugin 목록은 버전 `0.1.0`을 보고하지만 실제 소스 Plugin manifest는 `0.1.1`이다.
  qualification은 두 버전의 일치를 요구한다.

이 fixture들과 제품 동작은 이번 비교에서 수정하지 않았다.
나머지 3개 persistence 실패의 하위 원인은 종료 메시지 비교만으로 확정하지 않았다.

## 증거 파일

- 재구성본 전체 실행: `/private/tmp/blabee-layout-node-full.log`
- HEAD 복사본 10개 비교: `/private/tmp/blabee-layout-node-baseline-filtered.log`
- 테스트 이름·오류 범주 대조: `/private/tmp/blabee-layout-node-issue-comparison.json`
- 복사 입력 기록: `/private/tmp/blabee-layout-node-baseline-copy.json`

Swift 테스트와 Release 패키징의 결과는 이 Node 비교와 별도로 판단한다.
