# Claude 실행 사본과 업데이트 보류

2026-10-10 소스 구현. 빌드·공증·설치 또는 실제 Claude 대화 유지 검증 결과를 뜻하지 않는다.

## 새 실행의 경로

공통 `AppBridgeRuntimeBootstrap`은 원본과 전체 앱 사본의 서명·runtime identity를
검증한 뒤 `claude-installed-launcher`를 사본에서 `exec`한다. 설치 앱에 남는 장기
부모 프로세스를 만들지 않는다. 실제 admission·inode 잠금과 복사본의 검증은 공통
구현의 책임이다.

`ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy`는 기존 파라미터를 먼저
검증하고, 원본 앱의 정확한 `node/bin/node`와 `payload` 경로 두 개만 사본의 경로로
바꾼다. 프로젝트, 원래 Claude 실행 파일, 세션 소켓·runtime identity, 설정 위치와
`--` 이후의 Claude 명령 인자는 그대로 유지한다. 이 함수 자체는 서명 검증기가 아니다.

자동 연결 명령은 설치 앱에서 서비스 설정·사용자 opt-in을 먼저 확인한다. 그 뒤
사본의 observed-session launcher로 실행을 넘긴다. Claude 자식 프로세스를 아직
시작하지 않았다는 `PreSpawnFailure`가 확인된 경우에만 원래 Claude를 한 번 직접
실행하는 기존 fallback을 유지한다. 실행 후 오류나 결과가 불명확한 오류에는 fallback,
명령 재전송, 자동 승인이 없다.

## 현재 업데이트 가능 범위

**Claude 연결이 남아 있는 상태에서 공통 서비스를 교체하는 기능은 아직 허용하지 않는다.**
파일을 복사하는 것과 서비스 권한을 새로 발급하는 것은 별개의 작업이다.
현재 enrollment는 launcher와 서비스의 정확한 cdHash가 같아야 하며, 자식에게 발급한
Hook·MCP capability는 하나의 service incarnation에 묶여 있다. 이 조건을 완화하지 않았다.

`ClaudeRuntimePayloadUse.inspectForUpdate()`는 아래 정보만 읽는다.

- `status`: 기록 없음, 미종료 기록 있음, 검증 불가.
- `outstandingUseCount`: 완전히 검증된 미종료 기록 수. 살아 있는 세션 수가 아니다.
- `referencedRuntimeIdentities`: 미종료 기록이 참조하는 실행 세대.

기존 `blabee.claude-runtime-use.v1` 저장 형식은 변경하지 않았다. 이 형식에는 native
실행 파일 경로가 없으므로 기록만 보고 설치 앱에서 실행한 것인지 사본에서 실행한
것인지 구분할 수 없다. 둘 다 기존 설치 보류 조건을 유지한다. 소유자 객체가 사라지거나
PID가 없어져도 자식 종료를 증명하지 못하므로 기록을 자동 삭제하지 않는다.

검증 불가 상태의 빈 identity 집합은 **사용자 없음**이 아니다. 정리는 중단하고 모든
잠재 사용 세대를 보존해야 한다. 실제 교체 시에는 advisory 검사 결과에 의존하지 않고
기존 배타 admission guard를 다시 획득하여 게시와 rollback까지 유지한다.

## 후속 검증과 미구현 범위

Swift 회귀 검사는 경로 두 개만 이동하는지, resume·세션 바인딩 보존, 미검증 경로 거절,
확인된 pre-spawn 실패의 단 한 번 fallback, 불명확한 실패의 재실행 금지, 미종료 기록과
구세대 보존, 훼손된 기록의 fail-closed 처리를 포함한다.

실제 서명된 두 버전의 native runtime 간 전환은 별도 격리된 설치 검사로 확인해야 한다.
기존 Claude 프로세스의 대화를 유지한 채 새 service incarnation에 인증 재등록하고
자식의 capability를 교체하는 프로토콜은 이번 변경에 포함하지 않는다. 지원이 검증되기
전까지 업데이트 UI는 Claude 연결의 정상 종료 또는 확인이 필요하다는 구체적인 사유를
표시해야 한다.
