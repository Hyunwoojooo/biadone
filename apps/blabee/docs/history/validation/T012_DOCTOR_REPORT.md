# T-012a `blabee doctor` 기반 구현 보고서

상태: 읽기 전용 진단 기반 구현 및 자동 계약 검증 통과, 공개 배포 게이트는 진행 중
작성일: 2026-08-22
최종 업데이트: 2026-09-01

## 결과

Swift 제품 실행 파일에 `doctor` 명령을 추가했다. 현재 실행 이름은
`blabee-coordinator doctor`이며, 앱/DMG 패키징 단계에서 사용자용 `blabee doctor`
wrapper를 연결한다. 이 단계는 설치 상태를 바꾸지 않고 진단만 수행한다.

진단 결과는 고정된 JSON 또는 한국어 텍스트로 출력한다. 전체 상태는 `pass`,
`action_required`, `fail`, 종료 코드는 각각 `0`, `2`, `1`이다. 원문 subprocess
stdout/stderr, 환경 변수, 로컬 경로, 세션·토큰·프로젝트 ID는 보고서에 넣지 않는다.

## 진단 범위

- 현재 실행 중인 coordinator와 앱 내장 실행 파일의 identity
- `.app` 구조, `Info.plist`, 내장 coordinator 실행 가능 여부
- Codex CLI 실행 가능 여부와 exact 버전 정책
- Codex가 보고한 Blabee Plugin 설치·활성화·버전·local source
- 설치 source와 `--plugin` 검사 대상의 동일 directory identity
- Plugin v0.1.0 manifest, MCP, 4개 Hook, launcher, Skill과 agent metadata의 exact 계약
- PATH의 MCP coordinator와 앱 내장 coordinator의 동일 file identity
- Codex App Server `hooks/list`가 보고한 Blabee Hook 활성화·신뢰 상태
- daemon의 읽기 전용 계약 호환 상태와 현재 프로젝트 활성화 범위

현재 지원 버전 allowlist는 `0.149.1`, `0.150.1`, `0.151.0`이다. 역사적 alpha
기준인 `0.148.0`은 추가 승인이 필요한 `action_required`, 그 밖의 미승인 버전은
`fail`이다. 관찰된 호환성 실행을 제품 지원 승인으로 자동 확대하지 않는다.

## 읽기 전용 daemon 계약

새 UDS 요청 `doctor_status`는 일반 operational `handle`을 거치지 않는다. exact 빈
payload만 허용하고 enabled project의 `cwd`와 `enabled`만 UTF-8 byte 순서로
반환한다. generation 증가, deadline 처리, reconciliation, journal/freshness 변경을
수행하지 않는다. daemon이 없으면 디스크에서 프로젝트 상태를 추측하지 않고
`project_scope_unavailable`로 실패한다.

## Plugin과 Hook 신뢰 경계

Plugin 정적 구조는 fail-closed로 검사한다. 설치 record의 `version=0.1.0`, local
source, manifest/MCP/Hook 필드, launcher exact bytes와 실행 bit, Skill 파일 SHA-256,
Skill directory exact entry set을 확인한다. 숫자 `0/1`은 JSON Boolean으로 받지 않는다.

Doctor는 Hook을 직접 승인하거나 Codex의 비공개 신뢰 파일·hash 계산 규칙을
재현하지 않는다. 대신 공식 App Server의 `hooks/list`를 읽기 전용으로 호출한다.
현재 Plugin ID에 정확히 속한 네 이벤트(`permissionRequest`, `sessionStart`,
`userPromptSubmit`, `stop`)가 모두 활성화되어 있고, Codex가 `trusted` 또는
`managed`로 보고하며, 활성 cache의 `hooks.json` 바이트가 설치 source와 일치할
때만 `hook_trust_ok`로 통과한다. 하나라도 누락·중복·비활성·변경·미신뢰이거나
응답을 안전하게 확인하지 못하면 `/hooks` 검토가 필요한 `action_required`로
fail-closed한다.

## 최초 검증 결과 (2026-08-22)

- Doctor 집중 Swift 테스트: 18/18 통과
- Swift Operational 필터: 15/15 통과
- Swift Routing 필터: 18/18 통과
- T-011 운영 회귀: 23/23 통과
- v1 계약 테스트: 114/114 통과
- 실제 로컬 Doctor 실행: 안정적인 JSON과 exit `1` 확인

당시 로컬 실행의 실패는 예상된 결과였다. `/Applications/Blabee.app`, 설치된 Blabee
Plugin, PATH의 제품 coordinator, 제품 daemon이 없고 Codex `0.149.0`은 지원
allowlist에 없었다. 저장소의 `Plugin/blabee` 정적 계약만 통과했다.

### 2026-09-01 Hook 신뢰 후속 검증

- Doctor 집중 Swift 테스트: 29/29 통과
- Swift 전체: Swift Testing 434/434 + XCTest 5/5 통과
- 정상 버전·앱·Plugin·daemon·프로젝트·reconciliation·Hook fixture에서 Doctor
  전체 `pass`, exit `0` 확인
- 현재 설치된 Codex와 Plugin을 대상으로 한 실제 읽기 전용 조회에서
  `hook_trust_ok` 확인

실제 조회에는 새 debug Doctor와 기존 실행 중인 dogfood 앱·서비스를 함께 사용했기
때문에 전체 보고서는 runtime identity와 daemon 항목에서 실패했다. 이는 Hook 조회
실패가 아니며, 새 소스를 dogfood 앱으로 교체한 뒤 전체 exit `0`을 확인하는 작업은
별도 실사용 게이트로 남긴다.

## 남은 T-012 게이트

1. 실제 `.app`, Info.plist, entitlement, launchd/PATH wrapper를 만든다.
2. signed Data Protection Keychain/access group과 `LAContext`를 제품 daemon에 연결한다.
3. Developer ID 서명, 공증, DMG, 설치·제거·업데이트 흐름을 구현한다.
4. Codex 버전별 계약 시험 뒤 exact allowlist를 승인한다.
5. Doctor가 `hook_review_required` 또는 `hook_trust_unavailable`을 보고할 때
   사용자가 `/hooks`에서 현재 Hook 상태를 검토한다.
6. Terminal, iTerm, VS Code 터미널, Orca와 sleep/재시작 매트릭스를 통과한다.

## 공개 배포 전 잔여 위험

- path 기반 정적 검사는 마지막 component의 symlink와 exact 파일을 보수적으로
  검사하지만, 같은 UID 프로세스가 검사 중 ancestor tree를 rename/교체하는 전체
  TOCTOU까지 보안 증명하지 않는다. 공개 패키지에서는 서명된 고정 설치 root와
  directory-FD 기반 traversal/identity 검증을 결합해야 한다.
- subprocess timeout은 직접 자식을 TERM 후 KILL하지만 별도 process group 전체를
  종료하지 않는다. 공개 installer/doctor에서는 `posix_spawn` process group과
  grandchild 회귀를 추가한다.
- same-UID UDS와 exact 응답은 daemon이 reachable하고 계약과 호환됨을 뜻할 뿐,
  암호학적 daemon identity 증명은 아니다.
- 앱 bundle identifier/version, codesign, 공증 ticket 검사는 아직 없다.

따라서 T-012a의 read-only Doctor 기반은 다음 패키징 작업에 사용할 수 있지만,
T-012 전체와 공개 배포는 아직 `in_progress`다.
