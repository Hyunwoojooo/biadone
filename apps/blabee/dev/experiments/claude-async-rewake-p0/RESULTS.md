# P0 모의 검증 결과

실행일: 2026-09-25. 판정: **모의 회귀 63개 통과 / 실제 Claude 및 제품 지원 미검증**.

## 변경 범위

`dev/experiments/claude-async-rewake-p0/`에 새 파일 5개만 작성했다.
제품 `engine/`, `bridges/`, `app/`, 계약, 패키지 설정 및 기존 계획 문서는 수정하지 않았다.
README, 이 결과 문서, 상태 모형, 테스트 저장소, 회귀 테스트가 전부다.

## 수행한 검사

- Node v22.23.2 내장 runner로 `fixture.test.mjs`: **63 pass, 0 fail, 0 skipped**.
- 3개 `.mjs` 파일의 `node --check` 통과.
- 입력 snapshot 결함을 검토 중 발견해 수정하고 회귀를 추가했다. `offer` 호출 직후 원본 선택지를
  바꿔도 검증되지 않은 값이 저장되지 않는다. `arm`/`select`/`claim` 요청도 대기 전에 복사한다.
- 별도 QA에서 최종 수정과 검증 경계를 읽기 검토했다. 추가 지적 없음.

사용한 명령은 [README](README.md)에 있다. 기존 제품 테스트 runner, Swift 빌드/테스트,
패키징, 설치, 앱 재시작, 모델/API 호출, 운영 DB/Keychain/인증정보 접근, commit/push는 하지 않았다.
테스트 파일은 생성한 전용 임시 디렉터리만 쓰고 종료 때 정리한다.

## 확인한 모의 조건

| 계획 사례 | P0에서 확인한 범위 |
| --- | --- |
| A01 | 선택한 표식만 반환. wake, claim, 표식 기록, 완료는 별도 단계. 중복 표식/완료 거절 |
| A02–A03 | 같은/다른 cwd의 A/B 세션 역순 처리. 세션·소유자·incarnation·역할·ref·nonce 불일치 거절 |
| A04 | 반복 arm/선택/wake와 동시 claim에서 대기자·claim·본문 반환·표식 각각 최대 1개 |
| A05 | 쓰기 전 실패는 미소비 유지. claim 저장 후 응답 유실은 재반환 거절. 알림 유실 시 자동 재전송/실행 없음 |
| A06 | 카드/continuation/readiness 경계, stale generation/revision, 잘못된 시계 거절 |
| A07 | preflight 이후 새 입력·취소·만료·revision·연결 변경을 commit에서 재검증. 오래된 Stop 재등록 거절 |
| A08 | 취소·카드 닫기 모사·interrupt·종료 전후 stale claim 거절. claim 뒤 무효화도 표식 생성 거절 |
| A09 | 논리적 timeout 이후 같은 대기자 재등록 방지. 재연결/서비스 incarnation 변경으로 이전 인증/ref 거절 |
| A10 | MAC 변조, 잘림, journal 유실, 유효한 과거 journal, freshness 유실, 파일/anchor 전이 중단 거절 |
| A12 일부 | 299,999ms 전후 readiness와 599,999ms 전후 카드 유효기간을 구분. ACK 없는 5분 이후 선택은 거절 |

이 표의 성공은 모두 **합성 이벤트와 테스트 인증을 사용한 상태 모형의 결과**다.
진짜 Hook·MCP·사용자 클릭·자동 실행의 통과로 읽으면 안 된다.

## 요청 수와 시계 측정의 구분

최종 실행의 A04 카운터는 다음과 같다. 이 사례는 완료 호출을 하지 않고 표식까지 확인한다.

| 항목 | 수 |
| --- | ---: |
| arm 요청 | 100 |
| claim 요청 | 20 |
| 생성한 논리 대기자 / 전달한 모의 알림 | 1 / 1 |
| 저장한 claim / 본문 반환 / 표식 | 1 / 1 / 1 |
| 완료 | 0 |
| journal load / 검증한 snapshot record | 146 / 1,131 |

load/record 수는 이 작은 fixture가 매 읽기에 전체 snapshot chain을 검사한 횟수다.
제품 semantic replay 횟수나 최적화 전후의 성능 비교가 아니다.
최종 전체 Node 검사 출력의 소요 시간은 약 193ms였다. fake clock상의 120/300/600초 경계와
이 실행 시간은 다른 측정이며, 실제 wake·claim latency, CPU/RSS 또는 모델 사용량의 근거가 아니다.

## 미실행 및 남은 조건

- 실제 Claude `asyncRewake` 설정·exit 2, 같은 터미널 세션의 wake, native UserPromptSubmit/ID 순서: 미실행.
- A11 자기 대기자 때문에 idle을 막는지, A13 busy/승인 대기, A14 Hook 오류 UX/Stop 루프: 미실행.
- A15 clear/compact/resume의 실제 권한 수명: 미실행. 합성 generation 변경만 검사했다.
- A12의 실제 10분 대기/선택, 5세션 부하·정리 시간·CPU/RSS·모델 요청 수: 미실행.
- 실제 프로세스 crash/재시작, 다중 프로세스 파일 lock, fsync/전원 장애, 제품 MAC/freshness: 미검증.
  `reopenStoreObject`는 기존 메모리 인증/freshness가 남은 상태에서 파일을 새 객체로 읽을 뿐이다.
- 실제 cwd canonicalization·MCP 인증 출처, Pet UI/단축키, 설치·공증·배포: 미검증.

P0 결과는 native Claude 지원이나 제품 배포 승인이 아니다. 다음 단계는 별도 테스트 사용자/VM,
새 테스트 계정·세션, 도구 제한을 확보한 뒤 P1의 짧은 실제 wake 관측을 별도로 진행하는 것이다.
