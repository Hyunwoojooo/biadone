# Codex 새 버전 자동 호환성 검증

상태: 계정 없는 검증 CLI·회귀 테스트 구현. CI 템플릿 초안은 별도 로컬 작업으로 이번 게시 범위에 포함하지 않는다. 원격 스케줄 활성화와 실제 공식 런타임 검증은 별도 실행 증거가 필요하다.

## 검증과 운영 반영

새 Codex가 나오면 공식 전체 패키지를 새 macOS CI runner에 내려받아 검증하고, 버전별 JSON 증거를 보관한다. 성공 상태는 `smoke_passed`이며 자동으로 운영 지원 버전이 되지는 않는다. `publication.productionEligible=false`, `approvalRequired=true`, `catalogChanged=false`를 모든 보고서에 고정한다.

실제 검사기를 실행한 보고서는 `evidenceMode=runtime`으로 기록한다. 테스트용 runner 또는 host 값을 주입한 호출은 `evidenceMode=fixture`이며 성공 상태도 `fixture_passed`다. fixture의 `testedCapabilities`는 모의 계약 검사를 나타내며 해당 Codex 버전의 실제 서명·공증·실행 증거가 아니다. CI와 CLI의 성공 판정은 실제 검사 경로의 `smoke_passed`만 인정한다.

검증된 기능에 맞춰 `CodexCompatibility` 또는 관리 실행 카탈로그를 반영하는 일은 이 도구와 분리된 코드 검토 단계다. 관리 실행에 필요한 전체 패키지 fingerprint와 공식 자산 SHA-256을 함께 검토해야 한다. 서명·공증·버전 성공만으로 허용 목록에 추가하지 않는다.

## 실행

Node.js 22 이상과 패키지 아키텍처에 맞는 macOS가 필요하다. 새로 준비한 공식 전체 패키지의 canonical 절대 경로와 정확한 버전을 지정한다. 결과 파일은 아직 없는 파일이며 패키지 밖이어야 한다.

```sh
node scripts/qualify-codex-compatibility.mjs \
  --runtime-dir /private/tmp/codex-candidate/runtime \
  --expected-version 0.153.4 \
  --evidence /private/tmp/codex-candidate/qualification-run-1.json \
  --plugin-lifecycle --hook-tests
```

이 명령은 검증 후보를 실제로 실행한다. 운영 중인 사용자 Codex 또는 OS가 차단한 바이너리의 경로를 자동 탐색하지 않는다. CLI의 기본은 조회 검사이며 `--plugin-lifecycle`을 명시하면 임시 `CODEX_HOME`에만 로컬 Blabee 플러그인을 설치·조회·제거한다. `--hook-tests`는 기존 `plugin-package.test.mjs`를 fixture coordinator와 함께 실행한다. 사용자의 `CODEX_HOME`, PATH, 셸 설정, resume 경로, 바이너리, quarantine 속성은 변경하지 않는다. 코드 서명 수정이나 보안 검사 우회 옵션은 없다.

## 확인하는 계약

| 단계 | 확인 내용 |
| --- | --- |
| 전체 패키지 | `codex-package.json`의 layoutVersion=1, exact version, native target, variant 및 entrypoint/resource/path 경로 |
| 파일 구성 | `bin/codex`, `bin/codex-code-mode-host`, `codex-package.json`, `codex-path/rg`, `codex-resources/zsh/bin/zsh` |
| 파일 신뢰 | 심볼릭 링크·하드 링크·특수 파일·group/other 쓰기 권한 거부, 모든 파일 SHA-256, 매 검사 전후 동일 파일 fingerprint |
| macOS 코드 신뢰 | 네 실행 파일의 Apple anchor와 OpenAI Team ID, CLI/host identifier, `codesign --verify --strict -R=notarized --check-notarization` |
| 실행 버전 | `--version` stdout이 정확하게 `codex-cli <요청 버전>` |
| 플러그인 조회 | 빈 격리 환경의 `plugin marketplace list --json`, `plugin list --json` 응답 구조 |
| queue 표면 | `queue --help`만 실행; 살아 있는 세션에 queue를 보내지 않음 |
| 선택적 설치 | 임시 로컬 marketplace 및 Blabee 설치 → 이름/버전/활성 상태 조회 → 제거 확인 |
| 선택적 Hook 계약 | 저장소의 Hook 등록, launcher, fixture transport 계약 단위 테스트 |

`spctl --assess --type execute`는 단독 CLI를 앱으로 평가하여 오판할 수 있어 사용하지 않는다. 코드 서명·공증 검사가 통과해도 실제 실행 성공을 뜻하지 않는다. `--version`이 실제 종료 신호(SIGKILL 등)로 끝나면 `execution_terminated`로 기록한다. 종료 신호 없이 exit 137만 반환하면 `command_failed`이며 강제 종료라고 판단하지 않는다. OS 차단 가능성은 기록하지만 공증 ticket 부재라고 단정하지 않는다.

첫 실패에서 후보 실행을 중단한다. 자동 재시도는 없다. 자식 프로세스는 새 process group에서 실행하고 시간 제한 또는 출력 제한 시 TERM → KILL로 정리한다. 직접 자식이 성공해도 남은 같은 그룹 자식은 정리한다. 기본 검사당 15초·64 KiB, Hook fixture harness는 60초·256 KiB로 제한한다. 출력 원문은 보고서에 보관하지 않고 해시를 기록한다.

대표 실패 코드는 `package_layout_invalid`, `package_manifest_mismatch`, `package_changed`, `signature_invalid`, `notarization_unverified`, `execution_terminated`, `command_failed`, `version_mismatch`, `cli_contract_malformed`, `timeout`, `output_limit`, `cleanup_failed`다. 어느 검사에서 실패했는지는 `checks`에서 확인한다.

## 후속 설계 — CI 자동 증거 갱신

다음은 향후 CI 통합의 요구사항이며 이번 CLI 게시만으로 구현·활성화됐다고 볼 수 없다.
별도 로컬 템플릿 초안은 변경하거나 게시하지 않는다. 검토한 workflow를 저장소 루트
`.github/workflows/`에 설치하고 원격에 반영해야 스케줄이 작동한다. 기존 다른 workflow를
덮어쓰거나 required check를 활성화하는 일도 별도 승인 대상이다.

활성화 후 매일 또는 수동으로 공식 `openai/codex` release API의 안정 버전을 선택한다. `codex-package-<native target>.tar.gz` 한 개만 허용하며 API에 포함된 SHA-256과 실제 다운로드 바이트·크기를 일치시킨다. digest 누락, 다른 URL, prerelease, 중복 asset, archive traversal 또는 링크는 실패한다. 전체 패키지에 포함된 host와 resource를 유지하고, 기존 설치 파일과 섞지 않는다.

CI는 새 runner에서 regression → 공식 다운로드·digest 확인 → 안전한 임시 압축 해제 → 실제 코드 신뢰·CLI·격리 plugin lifecycle·Hook fixture 검증을 실행한다. 계정/API key/서명 secret을 요구하지 않고 저장소 권한은 `contents: read`다. 매 실행마다 run ID와 attempt가 다른 artifact에 release provenance와 qualification JSON을 남기며, 이미 남긴 실패 증거를 덮어쓰지 않는다. 결과는 Actions artifact에서 30일 보관한다. 다운로드 전 단계가 실패하면 qualification JSON이 없을 수 있으며 workflow 실패 로그가 해당 단계의 증거다.

## 검증하지 않는 범위

`smoke_passed`는 실제 Codex가 Hook 이벤트를 보냈다거나 Pet UI 결정, LLM 완료, 살아 있는 세션 queue 전달, 설치된 제품의 전체 흐름이 검증되었다는 뜻이 아니다. Hook fixture 단위 테스트도 해당 Codex 버전의 실제 Hook 전달 증거로 올리지 않는다. 이러한 범위는 보고서의 `unverified`에 항상 남긴다. 서명 검사를 통과한 로컬 패키지에 release provenance가 없으면 공식 archive와 동일한 바이트 조합이라는 증거도 없다.

회귀는 후보를 실행하지 않는 DI fixture와 Node 자식 프로세스 정리 검사로 실행할 수 있다.

```sh
node --test Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs
```
