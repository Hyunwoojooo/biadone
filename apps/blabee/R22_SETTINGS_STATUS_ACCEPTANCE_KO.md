# r22 설정 상태 점 — 빌드·설치 준비 기록

- 작성일: 2026-09-10 (KST)
- 요청: 상태 점 변경을 포함한 새 앱을 안전하게 설치하고 실제 설정 화면을 확인한다.
- 결과: **새 앱 빌드·무결성 검사·설치 안내창 확인 완료. 설치본 교체는 보류.**
- 이유: 설치된 build 18의 실행 파일을 실행 중인 Codex의 자식 프로세스가 사용 중이다.

## 준비된 앱

- `build/local-settings-20260910-r22/Blabee.app`
- 버전 `0.1.0`, build `22`, `arm64`, 선언 최소 macOS `13.0`.
- 기존 빌드 실행 파일을 재사용하지 않고 private source snapshot에서 release 컴파일했다.
- 입력 파일 140개의 fingerprint:
  `b2f8dfdc74f481c960de013901294ec6924a4b294c2b614db2a96ed4aa2c71ca`.
- 원본·snapshot 입력 일치를 복사 직후, 컴파일 후, 앱 조립 후, 최종 검증 후 확인했다.
- coordinator SHA-256:
  `edb0453f36a82fc9d8486598e362cecc98beeaf2248ff175da463a8653b68b0a`.
- runtime identity:
  `sha256:dfc11d3c12df89b557139b6d8756bbe5fbd66225004f0b73dc55daad8770e95e`.
- assembly manifest SHA-256:
  `a98a7137874ad6addf7906cec3ac55e5009786757c6016a98059a2291ab92048`.
- `verifyInternalAppBundle`과 `codesign --verify --deep --strict` 통과.
- 기존 설치본 identity는 한정된 이전 런타임 호환 목록에 포함했다. 설치 보호나 이전 Hook의
  일회성 승인 자격을 우회하는 설정이 아니다.
- 세부 정보: 같은 폴더의 `build-report.json`. private 빌드 디렉터리도 보존했다.
- ad-hoc 서명이다. Developer ID 서명·공증·DMG·ZIP 생성은 수행하지 않았다.

## 이번에 실제 확인한 것

Computer Use로 위 새 앱을 열어 **Blabee 설치** 창을 확인했다.

- 현재 위치는 위 r22 앱 경로, 이 앱은 build `22`, 설치된 앱은 build `18`로 표시됐다.
- ‘응용 프로그램에 설치하고 시작’ 버튼이 표시됐다. 설치/교체 버튼은 누르지 않았다.
- 실행 파일 매핑에서도 새 앱 프로세스 PID `6193`이 r22 coordinator를 사용했다.
- 설치 안내창은 열어 두었다. 이는 새 설치본의 설정 화면·서비스 연결·승인 왕복 증거가 아니다.

읽기 전용으로 설치본의 실제 실행 파일 사용자도 확인했다.

- `/Applications/Blabee.app`은 build `18`이다.
- 앱 PID `90501`, 자식 서비스 `92128`, Codex 자식 `92804`가 설치본 coordinator
  inode `69415526`을 사용 중이었다.
- `92804`의 부모 PID `92591`은 `codex`였다. 인자나 환경 변수는 조회하지 않았다.
- PID는 검사 당시의 관찰값이다. 종료 명령의 대상으로 재사용하면 안 된다.
- 설치본 coordinator SHA-256은 기존과 동일했다:
  `eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`.

`AppInstallationProcessGuard.requireInactive`는 대상 앱 내부 실행 파일을 사용하는
프로세스가 있으면 교체를 거부한다. 사전 확인에서 활성 사용을 확인했으므로 이번에는
설치를 시도하지 않았다. ‘설치 시도에서 오류를 재현했다’거나 ‘새 설치가 완료됐다’고
해석하지 않는다. 사용자 프로세스 종료·설치본 이동/교체·Codex 실행/신뢰/세션/프로젝트
설정 변경은 수행하지 않았다.

## 설치를 마치는 순서

1. 사용자가 Blabee를 사용하는 Codex 세션을 `/exit`으로 정상 종료한다.
2. 기존 Blabee의 메뉴바 아이콘을 오른쪽 클릭해 종료한다.
3. 열어 둔 r22 설치창에서 **응용 프로그램에 설치하고 시작**을 누르고 교체 안내를 확인한다.
   창을 닫았다면 위 r22 앱을 다시 연다. 설치 보호가 계속 표시되면 남아 있는 사용자를 확인하고,
   강제 종료나 보호 우회를 하지 않는다.
4. 설치와 Blabee 재실행이 끝난 뒤 Codex를 다시 실행한다. 설치 전에 Codex를 다시 열면
   구형 설치본의 Plugin 프로세스가 다시 시작돼 교체가 막힐 수 있다.
5. 설치된 build `22`와 실행 경로를 확인하고, 설정에서 서비스·Plugin의 상태 점, 회색 Hook 안내,
   접힌 상세 상태, 라이트·다크 화면을 확인한다.

## 검증 범위

- 직전 소스 수정에서 Swift Testing 821개와 XCTest 5개 통과, 비활성 검사 2개 건너뜀.
  라이트·다크 offscreen 렌더링 및 독립 코드 검토도 완료했다.
- 이번에는 그 소스의 fresh release 빌드·앱 검증과 실제 **설치 안내창** 확인을 추가했다.
- 설치된 새 앱의 실행 경로·상태 점·펼침·스크롤·VoiceOver·실제 카드 반환은 **아직 미검증**이다.
- commit/push는 수행하지 않았다. [상태 점 변경 기록](CONNECTION_STATUS_UI_KO.md)을 함께 참고한다.
