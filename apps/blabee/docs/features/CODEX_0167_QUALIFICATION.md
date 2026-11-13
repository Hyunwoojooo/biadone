# Codex 0.167.0·0.167.1 호환성 갱신

2026-11-13~14, macOS arm64. 새 등록 흐름(`npm run codex:register`)으로 처음 등록한 버전이다.
0.167.0(2026-11-06 공개)과 0.167.1(2026-11-10 공개)이 나온 뒤로, 지원 목록에 없어서
선택이 실패하던 상태(감사 CDX-1)를 해소한다. 설치된 앱에는 아직 반영되지 않았다.

## 변경

- `bridges/codex/qualification/0.167.0.json`, `0.167.1.json`을 추가했다. 기능은 0.166.0과 같다
  (`managedAppServer`, `pluginCLI`, `serverOwnedWorkspaceRoots`, `updateLifecycle`). Swift 생성 파일과 voice fixture가 함께 바뀌었다.
- 패키지 구성은 0.166.0과 같다. 파일 42개, `bin/codex-exec-server` 선언, 셸 없음. 레이아웃은 catalog 기록이 정한다.
- 일회성 Hook 승인은 각 버전의 primary `bin/codex` CDHash만 신뢰한다. `codex-exec-server`는 Hook 호출자가 아니다.

## 공식 근거

증거 원본: [`codex-evidence/0.167.0.json`](codex-evidence/0.167.0.json), [`codex-evidence/0.167.1.json`](codex-evidence/0.167.1.json).

| 항목 | 0.167.0 | 0.167.1 |
| --- | --- | --- |
| archive SHA-256 | `af45ed45…54517` | `5bcbc586…1ee72` |
| archive 크기 | 166,340,155 | 166,615,534 |
| `bin/codex` CDHash | `42914b6b6913492df6d38960843bd116265dab7c` | `14779c932d6736950666761116049886f2322b7e` |
| catalog fingerprint | `8315c990…` | `a4937773…` |
| Team ID | 2DC432GLL2 | 2DC432GLL2 |
| 공증 | native 30개 전부 | native 30개 전부 |

archive SHA-256과 크기는 GitHub release asset 메타데이터와 대조했다. 이 Mac에 Homebrew로 설치된 0.167.1의 CDHash도 같다.

공증 조회 주의: 2026-11-13 첫 측정에서 Apple 온라인 조회를 연달아 보내자 일부 파일이 `codesign` exit 3으로 실패했다.
1초 간격으로 다시 조회하자 두 버전 모두 30개 전부 통과했다. 같은 exit 3이 "공증 없음"과 "조회 실패"를 구분하지 않으므로,
qualify 스크립트와 등록 스크립트는 이제 조회 간격을 두고 실패 시 5초 뒤 두 번 더 확인한다.

## 공식 소스 비교 (0.166.0 → 0.167.1)

- `codex-rs/hooks`(schema·src 전체 tree), `codex-rs/cli/src/queue_cmd.rs`, `scripts/codex_package/layout.py`: 변경 없음(바이트 일치).
- `codex-rs/core/src/tools/approvals.rs`(0.167.0): 관리자 정책이 사람 승인을 요구하는 명령(`NeedsHumanApproval`)은
  PermissionRequest Hook의 Allow를 무시하고 사람에게 묻는다. Hook Deny는 그대로 우선한다. 일반 명령의 Allow → 일회성 `Approved` 변환은 같다.
- App Server: 명령 승인 kind에 `humanCommand`가 추가됐다. initialize capability `requiredHumanApproval`을 선언한 클라이언트에만 보낸다.
  관리형 승인 어댑터는 이 capability를 선언하지 않고 `kind == "command"`만 받는다(fail closed).
- 0.167.1: 도구 기능 변경 3건(incremental tools). Blabee 경계와 무관하다.

## 검증

- `npm run qualify:codex-compatibility`(Hook 계약·Plugin 설치/제거 포함): 두 버전 모두 `smoke_passed`, 검사 72개.
- native lifecycle(`scripts/verify-update-managed-codex-native.py --execute`, 공식 `models-manager/models.json`, 네트워크 차단): 두 버전 모두 통과.
- Swift Codex 묶음 11 + 608 통과. 실제 패키지를 `BLABEE_CODEX_RUNTIME_ARTIFACT`로 지정해 catalog fingerprint 일치를 확인했다(두 버전).
- `test:t005` 109, `test:codex-compatibility` 96 통과.

## 남은 경계

- 관리자 정책의 "사람 승인 필수" 명령에서는 Pet 승인 카드가 효과가 없고 Codex가 TUI에서 다시 묻는다. 안전 쪽 동작이며 Blabee는 이 경우를 표시하지 않는다.
- 설치 앱의 실제 Hook → Pet → queue 왕복은 새 빌드 설치 후 확인한다.
