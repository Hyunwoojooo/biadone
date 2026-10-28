# P1 도구 작성·모델 없는 검사 결과

검사일: 2026-09-26. Node v22.23.2.
범위: [README](README.md)에 설명한 독립 관측 도구와 합성 입력 검사.

## 결과

**도구 작성과 모델 없는 검사: 통과. 실제 Claude P1 관측: NOT_RUN.**

```sh
env -u NODE_OPTIONS -u NODE_PATH node --test --test-reporter=spec dev/experiments/claude-async-rewake-p1/p1.test.mjs
```

- 39개 검사 통과, 실패·취소·건너뜀 0개. 이번 실행 전체 시간 약 10.68초.
- 실제 Node Hook 프로세스 두 개에 동시에 합성 Stop 입력을 보냈다.
  종료 코드는 0과 2였고, 예약·예정 종료 기록은 각각 한 건이었다.
  exit 2 프로세스의 시작부터 종료까지 5,038ms가 관측됐다.
  이는 한 번의 로컬 측정이며 Claude wake 지연이나 성능 벤치마크가 아니다.
- 같은 run의 후속 Stop은 출력 없이 exit 0으로 종료했다.
- 세 설정 대조군의 구조와 결과, 세션·cwd·prompt 바인딩, 빈 background/cron 목록 요구,
  대기 중 새 입력·세션 종료·재시작·수동 취소, 기록 제한·민감 원문 제외를 검사했다.
- 잘못된/초과 크기/미완료 stdin, 손상 기록·설정 변경·symlink·권한·잠금 경합에서
  알림을 발생시키지 않는지 검사했다. 중단된 잠금을 탈취하거나 기록을 초기화하지 않는다.
- 설정 준비 CLI와 기록 조회·취소 CLI도 새 임시 전용 run에서 검사했다.
- runtime 파일의 import·호출 검사로 네트워크, Claude 실행기, 제품 코드 참조가 없음을 확인했다.
- 새 JavaScript 파일의 문법, JSON 구문, 문서의 로컬 링크·UTF-8·공백도 확인했다.

5초 CLI 검사를 제외한 Stop 대기는 주입한 시계와 대기 barrier로 통제한다.
stdin·writer lock 제한은 실제 짧은 타이머로 검사한다.
따라서 기능 조건 통과와 실제 타이머 측정은 서로 다른 증거다.

## 검토 중 수정한 오류

새 UserPromptSubmit 또는 SessionEnd의 입력 검증이 실패하면 먼저 대기하던 Stop이
취소되지 않을 수 있었다. 입력 관측 오류도 해당 run의 취소로 기록하도록 수정했다.

잘못된 prompt ID와 malformed/초과 크기 CLI 입력을 대기 중에 주입하는 회귀 검사를 추가했다.
오류 입력 자체는 exit 1이고, 앞서 대기하던 알림은 최종 검사에서 억제된다.
JSONL 취소 기록이 일시적 잠금 경합으로 실패하는 경우도 발견해,
잠금과 독립적인 `cancelled/` 표시를 먼저 남기도록 보완했다.
잘못된 CLI 입력·정상 관측의 lock_busy·수동 취소의 세 경합 검사에서
JSONL 취소 쓰기를 실패시킨 뒤 잠금을 해제해도 기존 알림이 억제됨을 확인했다.
실제 키 입력 시각과 최종 로컬 결정 이후 Claude 수신 사이의 경쟁까지 보장하지는 않는다.

## 변경 범위

이 디렉터리에만 `core.mjs`, `hook.mjs`, `prepare.mjs`, `record.mjs`, `p1.test.mjs`,
`settings.examples.json`, `README.md`, `RESULTS.md`를 추가했다.
제품 app·Engine·bridge, 기존 P0, 의존성, 사용자 Claude 설정은 변경하지 않았다.

## 미실행·미확인

- 실제 Claude 실행, 모델/API 호출, 같은 세션 wake·ACK, 사용자 화면의 Hook 오류 표시.
- 후보 Claude 버전에서 args·asyncRewake·prompt ID·background/cron 입력의 실제 지원.
- CLI 설정이 적용된 최종 도구·Hook·MCP 목록과 계정/정책 격리.
- 작업 claim·선택 실행, 10분 대기, 다중 세션, 장시간 자원 사용, 사용자 배포 적합성.
- Swift 검사·빌드·패키징·서명·설치·운영 앱/서비스 재시작.

JSONL의 예정 종료와 합성 stdin의 ACK 일치는 native 수신·실행 증거가 아니다.
report는 항상 `native_qualification: NOT_EVALUATED`를 반환한다.
이 기록 도구에는 제품 MAC/freshness, 악의적 파일 수정·rollback 방지,
전원 장애 내구성 또는 전체 native 설정 봉인 기능이 없다.

다음 단계는 별도 macOS 테스트 사용자 또는 VM의 격리 상태를 확인하고,
각 대조군을 새 테스트 세션에서 관측하는 것이다. 현재 사용자 세션에 연결하거나
기존 작업을 재전송하지 않는다.
