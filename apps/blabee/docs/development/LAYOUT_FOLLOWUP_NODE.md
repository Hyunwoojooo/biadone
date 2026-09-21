# 디렉터리 정리 후 Node 검증 수정 — 2026-09-20

최초 이동 검사에서 남은 실패를 수정한다. 설치 서비스·사용자 세션·운영 DB·사용자
인증정보는 변경하지 않으며, 저장 검사는 임시 DB와 기존 테스트 전용 Keychain 계정으로 수행한다.

## 원인과 수정

- LocalDogfood 가짜 Coordinator가 현재 필요한 `runtime-use-lease-protocol` 명령에
  응답하지 않았다. 정확히 해당 단일 인자에만 기존 protocol 문자열을 반환하도록 fixture를 보완했다.
  실제 runtime lease 호환성 검사는 유지한다.
- Plugin fixture와 실제 Codex 설치 검사에 옛 버전 `0.1.0`이 남아 있었다.
  준비 대상인 소스 manifest의 버전과 대조하며, 버전이 다른 설치본을 거부하는 회귀도 추가했다.
- Keychain 테스트 출력용 FD 3이 실제로 전달되지 않아도 Swift runtime이 번호를
  재사용하면 단순 open 검사를 통과했다. 테스트 전용 read-oracle은 쓰기 가능한
  FIFO/socket만 허용한다. 읽기 전용 FD와 일반 파일을 Keychain 읽기 전에 거부하며
  일반 파일에 출력이 남지 않는지도 검사한다. 실제 앱에는 read-oracle이 포함되지 않는다.
- 제품 semantic 테스트는 임시 DB를 사용하면서 운영 서비스의 primary authority 잠금을
  요청해 `operational_owner_active`로 종료됐다. 테스트 빌드에만
  `BLABEE_PRODUCT_TEST_AUTHORITY`를 지정해 별도 임시 authority root를 필수로 요구한다.
  테스트용 Keychain namespace가 없거나 lease gate/root가 잘못되면 즉시 거부한다.
  재시작과 테스트 계정 cleanup도 같은 격리 root를 사용한다.
- 제품 테스트의 packet 만료 fixture는 이전 120초에서 현재 정책인 600초로 맞췄다.
  continuation의 별도 120초 유효기간은 변경하지 않는다.

제품 semantic routing 생성과 원시 journal append 거부는 기존
`BLABEE_JOURNAL_TEST_HARNESS` 조건을 유지한다. 새로운 authority define이 없는
정식 빌드는 기존 primary writer lock을 계속 획득한다. 따라서 제품 테스트를
일반 journal harness로 바꿔 우회하지 않는다.

## 검증

- 정확한 Keychain oracle 계약 및 부적절한 FD 거부: 두 테스트 통과.
- 두 marketplace의 실제 Codex Plugin 설치·목록·삭제: 격리 CODEX_HOME에서 통과.
- 동일 턴의 연속 결정 경계 및 semantic 제품 명령/raw append 거부: 두 테스트 통과.
- 별도 읽기 전용 코드 검토에서 제품 잠금·routing 보존과 cleanup 격리를 확인했다.

전체 Node 회귀는 `npm test`로 실행한다.
로그: `/private/tmp/blabee-layout-followup-node-full.log`.
전체 결과: 445 tests 중 444 pass / 0 fail / opt-in 1 skip, exit 0, 약 260초.
별도 앱 경로가 필요한 opt-in 검사는 새 Release 앱을 지정해 추가 실행했고 5/5 통과했다.
복사된 서명 앱의 MCP 두 프로세스가 공유 lease를 유지하고, 마지막 종료 후 해제하며,
독점 잠금 중 일반 시작을 거부하고 읽기 전용 DMG에서도 같은 동작을 확인했다.
테스트가 만든 마운트와 프로세스는 정상 정리했고 원본 검사 앱의 binary hash도 보존됐다.
로그: `/private/tmp/blabee-layout-followup-runtime-lease.log`.

이 테스트의 authority는 격리되어 있으므로
정식 설치 서비스의 primary 잠금 동작이나 실제 사용자 선택 전달을 검증했다고 계산하지 않는다.
