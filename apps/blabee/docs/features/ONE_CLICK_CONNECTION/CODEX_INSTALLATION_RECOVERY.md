# Codex 설치 오류 진단과 연결 복구

2026-10-16. r83 이후 소스 변경과 격리 검사 기록이다. 설치 앱이나 배포 DMG에 반영됐다는 뜻은 아니다.

## 출발점과 확인 범위

다른 사용자의 r83 검사에서 `codex_native_path_unsafe`, `group_writable`,
`source_ancestor`, `/opt/homebrew/bin`이 보고됐다. 기존 경로 검사는 정확한
Homebrew launcher가 같은 prefix의 Cellar/Caskroom 안으로 연결되는 경우에만
일부 그룹 쓰기 가능한 상위 폴더를 허용한다. 이 정책은 변경하지 않았다.

기존에는 `realpath`로 대상을 확인한 뒤 상위 폴더 검사에 실패해도 그 대상을
진단 결과에서 잃었다. 따라서 기존 보고서의 `canonical_path=unknown`만으로
링크 해석 실패나 특정 설치 방식을 확정할 수 없다. 해당 사용자의 실제 연결
대상은 아직 확인되지 않았으며, npm 설치나 비표준 경로라고 단정하지 않는다.

## 변경 동작

- 경로 검사 중 이미 관측한 연결 대상을 실패 진단에 보존한다. 추가 파일 탐색이나
  실패한 실행 파일의 실행은 하지 않는다.
- 복사 진단에 `resolved_target_path`, `installation_layout`을 추가한다.
  `canonical_path`의 기존 의미는 유지한다. 경로 형태 분류는 문자열 관찰이며,
  실제 설치 방식·파일 출처·실행 권한에 대한 증거가 아니다.
- 복사할 때 사용자 경로와 임의 문자열을 제거한다. 알려진 설치 경로의 구조만
  제한적으로 남기며 버전 디렉터리 등은 가린다. 로컬 화면에서는 진단용 실제
  경로를 표시할 수 있다.
- 처음 연결 화면과 설정에 같은 설치 도움말·공식 안내 링크·`재검사 후 연결`을
  제공한다. 버전 미지원에는 Codex 재설치보다 Blabee 업데이트 확인을 안내한다.
- `재검사 후 연결`은 명시적인 사용자 작업이다. 새 native 검사가 통과하고
  Plugin 설치/업데이트가 필요한 상태일 때만 기존 `connect()`를 호출한다.
  검사부터 연결까지 한 작업 잠금을 유지하며 반복 클릭, 취소, 종료를 처리한다.
- 연결 중에는 복구 안내와 진행 상태를 유지한다. 그동안 쌓인 수동 새로고침이
  연결 실패 결과를 이전의 미설치 관찰로 덮어쓰지 않도록 합친다. 이후 사용자가
  다시 요청하는 검사는 계속 가능하다.

소유권·권한·ACL·서명·지원 버전·경로 변경 검증은 유지한다. 도움말을 열거나
상태를 새로고침하는 것만으로 Plugin을 설치하지 않는다. Codex 자체 설치,
폴더 권한 변경, 로그인, Hook 승인, 선택 작업 재전송을 자동화하지 않는다.
Plugin 설정 성공은 Hook 신뢰나 실제 선택 전달 성공과 별도로 표시한다.

## 변경 위치

- `bridges/codex/swift/runtime/CodexRuntimeTrust.swift`, `CodexNativeRuntime.swift`:
  실패 경로의 비권위 진단 정보 보존.
- `bridges/codex/swift/setup/CodexPluginCheckReport.swift`: 경로 형태 분류와
  복사 진단의 제한적 경로 출력.
- `app/coordination/PetConnectionSetup.swift`, `PetViewModel.swift`:
  복구 안내 모델, 명시적 재검사·연결, 중복/취소/실패 관찰 처리.
- `app/ui/settings/CodexPluginRecheckReportView.swift`, `PetSettingsView.swift`,
  `app/ui/onboarding/PetConnectionSetupView.swift`: 공통 복구 안내와 진단 표시.
- `Tests/swift/BlabeePetTests/`의 `CodexRuntimeTrustTests`, `CodexNativeRuntimeTests`,
  `CodexPluginCheckReportTests`, `PetCodexNativeRecheckTests`,
  `PetCodexConnectionRecoveryTests`: 관련 회귀 검사.

## 검증

`npm run test:swift`의 기존 직렬 실행과 잠금을 사용했다. 임시 저장 경로 및
fake manager/transport/opener를 사용했으며 운영 앱·사용자 세션·인증정보를
검사 대상으로 실행하지 않았다. 처음 sandbox 실행은 compiler cache 쓰기
제한으로 중단됐으며, 승인된 검사에서 다음 결과를 얻었다.

- 관련 검사와 기존 통합 연결 검사: **168개, 5 suites 통과**.
- 경로 검사 실패 시 버전 probe 미실행, 기존 Homebrew 허용 범위 유지,
  허용 범위 밖 target 거절, 실패 candidate 정보 보존, 복사 경로 제거 검사.
- 세 가지 연결 가능 상태와 다섯 가지 연결 불가 상태, 중복 클릭·취소,
  지연 연결 중 안내 유지, 연결 실패와 뒤늦은 새로고침의 경쟁 검사.
- 영어/한국어, 340/440pt, 경로/버전 오류의 펼친 안내 화면 8개 렌더.
  OS 화면에 창을 띄우지 않는 테스트이며 실제 앱의 사용자 수용 검사는 아니다.
- 화면의 버전 오류 fixture를 실제 상태와 일치시키고 관련 5개 검사를 다시
  통과했다. 좁은 화면의 영어·한국어 안내와 긴 진단 경로의 줄바꿈을 확인했다.
- 변경 파일의 `git diff --check` 통과.

실행 근거는 임시 폴더
`/private/var/folders/zb/hqjrlyvx79n59vrfnbsn0rm80000gn/T/blabee-codex-recovery-acpr2q_d/`의
`final-swift.log`, `render-final-swift.log`, `renders/`에 있다. 임시 파일은
시스템 정리로 사라질 수 있다.

## 남은 확인

1. 문제가 발생한 Mac에서 실제 `codex` 연결 대상과 설치 경로를 확인한다.
   이번 변경만으로 그 Mac의 차단이 해소됐다고 판단하지 않는다.
2. 다음 서명·공증 배포본에서 첫 연결 → 명시적 재검사 → Plugin 연결 →
   Codex 로그인/Hook 승인 → 새 대화의 실제 카드 수신을 구분해 확인한다.
3. 앱 패키징·공증·설치·운영 앱 재시작·commit·push는 이번 작업에 포함하지 않았다.

## 2026-10-20: Plugin 목록 조회 시간 초과

r86에서 `stage=plugin_list`, `codex_native_probe_timeout`이 보고됐다.
Codex 0.163.0의 전체 Plugin 목록 명령은 원격 marketplace 캐시가 없거나 오래되면
원격 응답을 기다릴 수 있다. 기존 Blabee의 조회 예산 5초에는 실행 파일 재검증과
공증 확인도 포함됐다. 이렇게 끝난 조회 오류가 실행 파일 단위의 보호 기록에
남아 이후 검사·전달까지 막는 구조도 확인했다. 최초 원격 요청의 실제 응답이나
실패 원인은 수집되지 않아 특정 서버 장애로 단정하지 않는다.

이번 소스 변경은 다음 범위로 제한한다. 설치 앱 반영과 별도로 검증해야 한다.

- 정확한 읽기 전용 명령 두 개만 `CodexPluginInspectionQuery`로 구분한다.
  `plugin marketplace list --json`은 준비 최대 5초와 명령 최대 5초,
  `plugin list --json`은 준비 최대 5초와 명령 최대 35초를 배정한다.
  각각 합계 10초·40초와 전체 연결 검사 잔여 45초 예산을 적용한다.
  동기 OS 검사와 프로세스 종료 정리는 지연될 수 있어 엄격한 실제 경과 시간
  보장을 의미하지 않는다. 네트워크 조회 자체를 더 빠르게 만드는 변경도 아니다.
- 서명·공증·경로·권한 및 실행 직전 파일 재검증을 유지한다. 전체 목록을 조회해
  다른 marketplace의 중복 Blabee와 legacy 소유권 판단에 필요한 정보를 보존한다.
- 조회 runner 자신의 deadline을 넘긴 뒤 직접 자식의 회수와 생성한 프로세스
  그룹의 소멸까지 확인된 경우만 `codex_native_inspection_timeout`으로 분류한다.
  이 결과는 실행 파일을 지속 차단하지 않아 별도 연결 검사가 가능하다.
  같은 요청 안에서 자동 재시도하지 않는다.
- 준비 단계 시간 초과, 종료 불명, 강제 종료, 변조, 과도한 출력, 쓰기 명령과
  queue의 실패 보호는 유지한다. 임시 오류 기록 정리 중 unlink/fsync가 실패해도
  불확실성을 보존해 다음 실행을 차단한다.
- 기존 r86의 `codex_native_probe_timeout` 기록은 원인을 소급해 알 수 없으므로
  자동 해제하지 않는다. 원인 확인 후 설정의 명시적 Codex 실행 재검사로 복구한다.
  과거에 선택했던 작업은 자동 재전송하지 않는다.

복사 진단에는 `native_stage`, `native_command_invocation_attempted`,
`native_cached_failure`, `native_exit_code`, `native_termination_signal`과
`native_elapsed_ms`, `native_preparation_elapsed_ms`, `native_command_elapsed_ms`를
추가한다. 준비 시간에는 실행 잠금 대기와 재검증·공증이 포함되고, 명령 시간에는
runner의 종료 정리가 포함된다. 합계에는 보호 기록 정리도 포함되므로 준비와
명령 시간의 합과 다를 수 있다. 관측되지 않은 값은 `unknown`이며, 프로세스 호출
시도는 Hook 검증이나 선택 작업 실행의 증거가 아니다. 원시 출력·인수·파일 identity는
추가하지 않는다. 기존 timeout telemetry 분류도 유지한다.

조회가 오래 걸리면 기존 전역 실행 잠금도 오래 점유한다. 동시에 들어온 전달은
`codex_native_execution_in_progress`로 보류될 수 있으며 자동 재전송하지 않는다.
이 직렬화 보호를 풀거나 불완전한 목록으로 연결을 정상 처리하지 않는다.

회귀 범위는 조회별/전체 예산, 별도 재검사 복구, 준비 단계 차단, 종료 확인,
변경된 실행 파일 거절, 기록 정리 실패, 경합 중 queue 미실행, 진단 정보 제한이다.
이번 실행 기록은 `build/codex-plugin-fix-20261020/REPORT.md`에 둔다.
