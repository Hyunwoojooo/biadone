# T-012b-3a 프로젝트 설정 writer 보고서

업데이트: 2026-08-22
상태: 로컬 설정 쓰기와 Pet UI 연결 자격 완료, 실제 자동 시작 등록 미승인

## 결과

정확한 `Blabee.app` 안의 coordinator만 사용할 수 있는 프로젝트 설정 명령을
추가했다.

```text
Blabee.app/Contents/MacOS/blabee-coordinator \
  project-settings enable --project /absolute/project

Blabee.app/Contents/MacOS/blabee-coordinator \
  project-settings disable --project /absolute/project
```

명령은 `HOME`, 현재 디렉터리, 환경변수 또는 호출자가 준 설정 경로를 사용하지
않는다. exact bundle identity와 고정 Application Support 경로를 통과하지 못한
추출 바이너리·lookalike 앱은 `service.json`을 만들거나 바꾸기 전에 실패한다.
결과는 `changed`, `status`, `project`, `enabled_projects`만 포함한 결정적 JSON이다.

## 안전한 쓰기 계약

`~/Library/Application Support/Blabee/config/service.json` 갱신은 다음 순서로
수행한다.

1. Application Support를 루트부터 `openat`·`O_NOFOLLOW`로 순회하고 현재 사용자
   소유이며 group/other writable이 아닌지 확인한다.
2. `Blabee`와 `config`를 필요할 때만 mode `0700`으로 만들고 생성 entry와 열린
   descriptor의 inode를 다시 맞춘다.
3. mode `0600`, single-link regular file인 `.service.json.lock`에 프로세스 내
   mutex와 프로세스 간 `flock`을 함께 잡는다.
4. 잠금 아래에서 기존 strict v1 설정을 다시 읽는다. 손상·권한 오류·symlink·FIFO·
   hard link는 덮어 고치지 않고 fail-closed한다.
5. 같은 디렉터리에 unique temporary regular file을 `O_CREAT | O_EXCL |
   O_NOFOLLOW`와 mode `0600`으로 만들고, 전체 write와 file `fsync`를 끝낸다.
6. `renameat`으로 `service.json`을 원자 교체하고 config directory를 `fsync`한다.
   rename 뒤 directory sync가 실패하면 성공으로 위장하지 않고
   `product_service_config_durability_uncertain`을 반환한다.

멱등 enable/disable은 파일 inode를 불필요하게 바꾸지 않지만, 이전 rename의
내구성이 불확실할 수 있으므로 반환 전 config directory를 다시 `fsync`한다.
rename 전 실패는 이전 bytes와 inode를 보존하고 exact temporary entry만 치운다.
rename 후 실패에서는 reader가 완전한 이전 또는 새 JSON만 보며, 같은 명령 재시도가
directory sync를 완료할 수 있다.

## 프로젝트 경로와 재시작 reader

- enable은 존재하는 절대 디렉터리만 받으며 루트부터 모든 구성요소를
  `openat(O_DIRECTORY | O_NOFOLLOW)`로 순회한다. final 또는 ancestor symlink는
  거부한다.
- `/tmp`와 `/var`는 각각 `/private/tmp`와 `/private/var`로 고정한 뒤 저장한다.
- disable은 이미 삭제된 프로젝트의 stale 항목도 정규화해 제거할 수 있다.
- 최대 프로젝트 256개, 경로당 UTF-8 4096 byte, 설정 전체 64 KiB와 UTF-8 byte
  정렬 계약을 유지한다.
- 제품 service의 재시작 reader도 같은 Application Support descriptor 순회 뒤
  `Blabee`와 `config`를 read-only `openat`으로 연다. 경로·파일이 없으면 활성
  프로젝트 0개이고, 존재하는 ancestor symlink나 잘못된 metadata는 실패한다.

## 동시성 및 실패 검증

- writer 집중 테스트: 12/12 통과
- reader와 writer 독립 fresh build 집중 테스트: 23/23 통과
- `BlabeePetTests`: 78/78 통과
- 전체 Swift package: XCTest 5/5 + Swift Testing 150/150 통과
- 같은 프로세스의 실제 겹친 writer: process mutex에서 직렬화되고 두 프로젝트 유지
- 별도 helper 프로세스 두 개의 실제 겹친 writer: persistent `flock` 아래 lost update 0
- lock 대기 중 lock name/inode 교체: 설정을 바꾸지 않고 fail-closed
- restrictive `umask`, unsafe Application Support, symlink ancestor, hard link,
  특수 lock, 64 KiB 초과, rename 전후 실패와 멱등 durability 재시도 통과
- release `blabee-coordinator` 제품 빌드 통과. 테스트 helper는 release 제품 출력에
  포함되지 않음
- `npm run test:t012`: 7/7 통과
- T-012b-3b fake onboarding adapter: 10/10, `BlabeePetTests` 88/88, 전체 Swift
  package XCTest 5/5 + Swift Testing 160/160 통과

## 남은 경계

- T-012b-3b에서 이 writer를 호출하는 Pet 온보딩 UI와 `SMAppService` 상태·등록·해제
  adapter 코드 계약을 연결했다. 프로젝트 변경은 명시적 버튼에서만 수행하고 다음
  service 재시작부터 적용한다.
- 실제 `SMAppService` 등록·해제·System Settings 승인 수명주기는 사용자 동의를 받는
  T-012b-3c 실기기 gate다.
- `flock`은 advisory lock이므로 같은 UID의 비협조 프로세스를 강제로 막지는 않는다.
- 실제 프로세스 crash가 unique temporary file을 남길 수 있다. 다음 write와 이름이
  충돌하지는 않지만 정리 정책은 설치 수명주기와 함께 후속 확정한다.
- 기존 개발용 `daemon`의 임의 storage 인자는 유지한다. 새 `project-settings`의
  제품 identity·고정 경로 보장은 그 legacy 개발 CLI를 일반 파일 쓰기 sandbox로
  바꾼다는 뜻이 아니다.
- 실제 service, 제품 primary Keychain, `SMAppService`, `launchctl`, `/Applications`,
  Developer ID, 공증, DMG 또는 사용자 Application Support를 이번 자격 시험에서
  변경하지 않았다. 전체 Swift 회귀의 격리된 임의 test-only Keychain account는 사용
  후 정리했다.
