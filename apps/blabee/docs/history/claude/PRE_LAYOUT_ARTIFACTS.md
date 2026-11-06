# Claude 디렉터리 이동 전 검증 기록

2026-09-20. 제품 소스의 새 위치는 `bridges/claude/`, 공통 테스트는
`Tests/bridges/claude/`와 `Tests/swift/`, 독립 검증 앱은 `dev/claude-standalone/`이다.
옛 `claude/`에 남은 생성물에서 개발 이력 확인에 필요한 기록과 기준점을 보관했다.
이 자료는 과거 검증의 근거이며 현재 제품 실행이나 세션 권한의 입력으로 사용하지 않는다.

## 보관 위치와 검증

- [로컬 보관 폴더](../../../build/claude-tests/history/2026-09-20-pre-layout/)
- [파일별 크기·SHA-256·보관 이유](../../../build/claude-tests/history/2026-09-20-pre-layout/manifest.json)
- [보관 전후 제품·테스트 소스 무변경 확인](../../../build/claude-tests/history/2026-09-20-pre-layout/product-source-integrity.json)

옛 `claude/build/<상대 경로>`는 보관 폴더 안의 같은 상대 경로에 대응한다.
740개 파일, 20,850,748 bytes(약 19.88 MiB)를 복사했고 원본과 복사본의 SHA-256을
대조했다. 기존 문서가 명시적으로 참조하는 실재 파일 66개를 모두 포함한다.
제품·브릿지·테스트 등 398개 소스 파일의 보관 전후 해시도 동일했다.

`manifest.json`의 SHA-256은
`28990e0c7be5e4651444b927fc34da64459437e7ec4b494d9bd11ccbf635c890`이다.
보관 폴더는 사용자 전용 권한이며 루트 `build/`의 Git 제외 규칙을 따른다.
이 문서만 다른 체크아웃에 복사해도 로컬 보관 파일이 함께 전달되지는 않는다.

## 주요 기록

| 구분 | 보관한 기록 |
| --- | --- |
| CP-01 세션 권한 | [authority 검사](../../../build/claude-tests/history/2026-09-20-pre-layout/cp01-authority/), [기존 core 회귀](../../../build/claude-tests/history/2026-09-20-pre-layout/cp01-core-regression/) |
| CP-01B 제품 계약 | [계약·공유 fixture·문법 검사](../../../build/claude-tests/history/2026-09-20-pre-layout/cp01b-contracts/) |
| CP-02 등록·metadata | [등록 단계 로그와 변경 범위](../../../build/claude-tests/history/2026-09-20-pre-layout/product-registration/) |
| CP-03 권한 연결·갱신 | [세션 수명 검증과 변경 범위](../../../build/claude-tests/history/2026-09-20-pre-layout/product-lifetime/) |
| CP-04 수명·누적 상태 | [검증 로그·호출 스택 표본·변경 범위](../../../build/claude-tests/history/2026-09-20-pre-layout/product-lifecycle/) |
| 작업 전 기준점 | CP-01, CP-01B, CP-02, CP-03, CP-04의 `hashes.json`·`status.txt`; [CP-04 기준점](../../../build/claude-tests/history/2026-09-20-pre-layout/cp04-baseline-ygujs80_/) |
| 초기 공통 엔진·Pet 통합 기준 사본 | [공통 엔진 기준 사본](../../../build/claude-tests/history/2026-09-20-pre-layout/shared-core-baseline-q6lsr39x/), [Pet 통합 기준 사본](../../../build/claude-tests/history/2026-09-20-pre-layout/pet-integration-baseline-l3vfnr9g/), native/ingress와 C-L01의 기준 사본 |
| 실제 클릭 확인 | [Pet 클릭·harness 왕복 증거](../../../build/claude-tests/history/2026-09-20-pre-layout/pu-rYIiED/evidence.json), [사용자 클릭 확인](../../../build/claude-tests/history/2026-09-20-pre-layout/pu-rYIiED/click-confirmation.json) |
| 선택한 파일 생성 결과 | [result-a.txt](../../../build/claude-tests/history/2026-09-20-pre-layout/live-test/result-a.txt), [cl01-a.txt](../../../build/claude-tests/history/2026-09-20-pre-layout/cl01-live-DtrzTk/cl01-a.txt), [pet-a.txt](../../../build/claude-tests/history/2026-09-20-pre-layout/shared-pet-live/project/pet-a.txt) |
| Pet 표시 검증 | [공통 Pet 이미지](../../../build/claude-tests/history/2026-09-20-pre-layout/common-pet/artifacts/), [이전 비교 이미지와 로그](../../../build/claude-tests/history/2026-09-20-pre-layout/pet-baseline-render/) |

앞선 날짜별 bridge/native/Hook 검사 로그, source review diff, 수동 확인용 script도
manifest에 기록했다. 실패·중단·sandbox·CLT 오류와 500회 검사 기대값 수정 전 로그를
최종 성공 로그와 함께 보존했다. 이번 보관 작업에서 기능 테스트를 다시 실행하지 않았다.
`pu-rYIiED` 기록의 Hook·모델 역할은 테스트 harness가 수행했다. 실제 사용자 클릭과
테스트 왕복의 증거이며, 실제 Claude 모델 검증으로 해석하지 않는다.

## 1차 기록 보관 당시 유지한 실행 데이터

1차 기록 보관에서는 원본을 삭제하지 않았다. 옛 `claude/build/`의 앱 번들, `runtime/`, `sessions/`,
자격 파일, 저장 키와 DB는 보관 대상에서 제외하고 원래 위치에 유지했다.
실행 중인 옛 앱·Coordinator를 종료하거나 기존 세션 데이터를 새 제품에 재주입하지 않았다.
`node_modules/`, 컴파일 캐시와 재생성 가능한 실행 파일도 복사하지 않았다.

## 옛 폴더 삭제 완료 — 2026-09-20

이후 사용자의 삭제 요청에 따라 옛 개발 앱과 소유 Node Coordinator를 정상 종료했다.
삭제 직전 해당 경로를 사용하는 프로세스·열린 파일이 없음을 확인한 뒤 `claude/`를 삭제했다.
설치된 Blabee와 Codex 세션, Claude 데스크톱 앱은 종료·교체하지 않았다.

- [전체 복구용 압축본](../../../build/claude-tests/history/2026-09-20-retired-folder/claude-before-removal.tar.gz)
- [원본 파일 목록](../../../build/claude-tests/history/2026-09-20-retired-folder/source-manifest.json)
- [백업 검증 결과](../../../build/claude-tests/history/2026-09-20-retired-folder/verification.json)
- [삭제 완료 기록](../../../build/claude-tests/history/2026-09-20-retired-folder/removal.json)

일반 파일 61,126개(5,874,894,940 bytes)와 디렉터리·심볼릭 링크를 보관했다.
압축본은 2,234,289,823 bytes이며, SHA-256은
`1e31a417ec551e8b6f0b35758799a349e9591383e1840bf7fe49ee22a2d00c6a`이다.
파일별 내용·권한과 링크 대상을 검증했고, 남아 있던 테스트용 Unix 소켓 4개만 제외했다.
삭제 전후 제품·브릿지·테스트 소스 398개의 해시가 동일했다.

복구본에는 이전 앱·의존성·캐시와 runtime·session 데이터도 포함된다.
보관 디렉터리는 `0700`, 압축본과 목록은 `0600`이며 Git에서 제외된다.
이 복구본은 과거 파일 보존용이며 현재 제품의 세션 권한이나 실행 입력으로 사용하지 않는다.
새 제품 개발은 `bridges/claude/`, 독립 개발 앱은 `dev/claude-standalone/`을 사용한다.
