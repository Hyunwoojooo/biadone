# 저장소 유실 복구와 Hook 신뢰 확인

2026-09-18. 보고된 r58의 저장 파일 삭제 후 `freshness_storage_missing` 및 Plugin 재설치 후 `untrusted` 상태를 각각 처리한다. 앱 재설치만으로 사용자 저장소·Keychain·Codex 신뢰 상태를 초기화하지 않는다.

## 제품 흐름

설정 → 연결 → 서비스 설정 → **저장소 복구**에서 `복구 가능 여부 확인`을 누른다. 첫 실행 온보딩의 연결 설정에도 같은 기능이 있다.

1. 서비스가 완전히 중지되고 자동 시작 등록이 해제되어 있어야 한다. 실행 중인 Codex나 외부 서비스를 강제 종료하지 않는다.
2. DB와 인증 키가 **모두 없는** 상태이며 유효한 committed/pending Keychain 검증 기록이 남은 경우만 복구 계획을 제시한다. 일부 데이터가 남거나 손상된 경우에는 수정하지 않는다.
3. 사용자는 보관 위치와 작업 이력이 복원되지 않는다는 설명을 확인한 뒤 **보관하고 새로 시작**을 선택한다. 취소·화면 닫기·서비스 설정 변경은 확인 계획을 철회한다.
4. 잔여 SQLite WAL/SHM/rollback journal을 접근 제한된 보관 폴더로 이동한다. 기존 Keychain 항목은 값이나 ACL을 내보내지 않고 service 이름만 revision CAS로 보관 이름으로 바꾼다.
5. 완료 후 앱 실행형 서비스를 켜거나 다시 시작한다. 정상 서비스 초기화가 새로운 저장소를 만든다. 복구 완료 기록 자체를 연결 성공으로 표시하지 않으며, 검증된 서비스 응답을 기다린다.
6. 프로젝트 설정이 삭제된 경우 사용자가 폴더를 다시 등록한다. 남아 있는 프로젝트·계정·단축키 설정은 복구 기능이 변경하지 않는다.

설정 → 연결 → Codex Plugin에서 프로젝트를 선택하고 **Hook 상태 확인**을 누른다. 일반 설정에도 Plugin 설치와 별도의 Hook 신뢰 행이 있다.

- 앱을 열거나 기본 Doctor를 실행하는 것만으로 Codex를 실행하지 않는다. 명시적인 버튼 동작만 bounded `plugin list`와 `hooks/list`를 사용한다.
- 설치·활성화된 현재 Blabee Plugin과 일치하는 네 이벤트의 활성·신뢰·출처·해시·프로젝트를 확인한다. 검사 중 Plugin이나 선택 프로젝트가 변경되면 결과를 폐기한다.
- 신뢰 승인이 필요한 경우 Codex의 `/hooks`에서 출처와 명령을 사용자가 검토하도록 안내한다. Blabee가 Codex의 비공개 신뢰 파일을 직접 읽거나 수정하거나 신뢰 해시를 복제하지 않으며, 일괄 명령 승인과 테스트 요청 자동 전송도 하지 않는다.
- Codex 0.164.0의 `hooks/list`는 기존 승인을 새 콘텐츠 검증 방식으로 옮기면서 `.hook-trust` 기준 파일을 생성할 수 있다. 따라서 조회를 읽기 전용으로 보장하지 않는다. 검사 전·진행 중 안내에 기존 Hook 신뢰 정보가 갱신될 수 있음을 표시하며, 실패·시간 초과 시에도 일부 정보가 갱신됐을 가능성을 알린다. 추가 승인을 자동 부여하거나 실패 후 기준 파일을 삭제·복원하지 않는다.
- 신뢰 확인은 선택한 프로젝트에서 수행한 일회성 검사다. 기존 Codex 세션에 캐시된 상태까지 증명하지 않는다. 새 세션 또는 `codex resume`으로 다시 확인한다.
- Hook 신뢰, 서비스 연결, 실제 카드 수신, 원래 세션으로 선택 반환은 서로 다른 증거다. 연결 확인 안내에 따라 새 카드와 원래 세션의 응답을 확인한다.

## 보존 및 동시성

`MissingStorageRecovery`의 plan은 같은 엔진 인스턴스에 바인딩되고, Pet manager는 확인을 한 번만 소비한다. 실행 시 primary namespace authority → DB authority → nonblocking storage writer lock 순으로 배타성을 확보한다. 기존 무결성·freshness preflight는 그대로다.

실행 중 DB/key 부재, anchor revision, 부모 디렉터리 identity, sidecar 지문을 다시 검사한다. symlink·hardlink·잘못된 소유자/권한·덮어쓰기 대상은 거절한다. sidecar와 보관 계획은 anchor 변경 전에 동기화한다. 실패 시 이미 보관한 파일은 유지하고 primary anchor를 자동 복원하거나 제거하지 않는다.

SQLite가 사용자 전용 `0700` 폴더 안에 생성한 `0600` 또는 `0644` 잔여 파일은 보관할 수 있다. 보관 파일은 `0600`으로 제한한 뒤 동기화한다. 그룹/다른 사용자의 쓰기 권한, 실행 권한, 특수 권한이 있는 파일은 허용하지 않는다.

보관 계획은 `Application Support/Blabee/recovery/<UUID>/recovery-plan.json`에 남는다. Keychain 비밀값은 파일에 기록하지 않는다. anchor 보관 성공 후 완료 기록 저장만 실패한 경우 엔진 receipt의 `completionRecordWritten`은 false이며, 성공한 archive를 되돌리지 않는다.

새 production service와 legacy CLI는 같은 primary namespace lock을 사용한다. 구버전 실행 파일의 custom-DB 프로세스는 이 새 잠금을 모르므로, 기존 설치기의 활성 helper 차단과 정상 종료 절차도 계속 필요하다.

## 검증 범위

- `MissingStorageRecoveryTests`: 실제 임시 파일/SQLite + 모의 Keychain으로 준비 무변경, 잔여 파일 보존, 정상 신규 bootstrap, revision/경로 변경, 활성 writer, archive 실패와 불확실한 완료를 검사한다.
- `StorageRecoveryAuthorityTests`: 서로 다른 DB 경로의 primary 배타성과 두 번째 잠금 실패 시 해제를 검사한다.
- `PetConnectionRecoveryTests`: 명시적 확인, 취소, 중복 실행 차단, 실패 시 서비스 미시작, 늦은 다른 프로젝트 Hook 결과 폐기를 검사한다.
- `PetHookReadinessTests`: 서명/버전 자격과 Plugin 계약 검사 경로, 기존 단일 해시 및 0.164.0 선언/콘텐츠 복합 해시 수용, `modified` 콘텐츠의 재검토 요구, 미신뢰·비활성·누락·중복·출처 변경·프로젝트 불일치·시간 제한을 모의 입력으로 검사한다. 실제 신뢰 파일 이동과 실패·시간 초과 후 파일 변경 여부는 격리된 Codex home의 native 검사로 별도 확인한다.
- `MissingStorageKeychainRecoveryTests`: `BLABEE_TEST_RECOVERY_KEYCHAIN=1`일 때만 UUID 기반의 별도 테스트 계정으로 실제 Keychain을 검사한다. 보관 전후 값·revision·계정과 service 검색 결과, 잘못된 revision 거절, 새 저장소 bootstrap을 확인한다. 테스트는 사용자 `primary` 계정을 조회하거나 변경하지 않는다.

보관은 [`SecItemUpdate`](https://developer.apple.com/documentation/security/secitemupdate(_:_:))로 service 속성만 변경한다. 테스트의 opaque persistent-reference 바이트 동일성은 보존 판정에 사용하지 않는다. 실제 ACL의 모든 항목 비교, 강제 OS 종료 시 내구성, 설치 앱에서의 복구 및 Codex 왕복은 별도로 검증해야 한다. 실제 사용자 primary Keychain을 테스트용으로 초기화하지 않는다.
