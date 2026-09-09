# r21 승인 카드 수정본 — 빌드·설치 준비 기록

- 작성일: 2026-09-10 (KST)
- 요청: 수정본을 설치본에 반영하고 관련 변경 커밋. 푸시는 요청 범위 밖이다.
- 결과: 새 앱 빌드·서명·무결성 검사 완료. 기존 설치본의 활성 Codex/MCP 사용 때문에 교체는 보류.
- 실제 설치·재시작·새 카드 클릭·승인 왕복: 미실행.

## 새 앱

- 위치: `build/local-approval-20260910-r21/Blabee.app`
- 버전 `0.1.0`, build `21`, `arm64`, 선언 최소 macOS `13.0`.
- 현재 소스를 private snapshot에 복사하고 별도 scratch에서 release 컴파일했다.
- 입력 136개 파일 fingerprint:
  `0eb8aa562ecfb98b7b0ac15f26f9181ca1c24f8eb70ec9ee73b547881ed98dc1`.
- snapshot·컴파일·앱 조립·최종 검증 단계에서 원본과 snapshot의 fingerprint 일치를 확인했다.
- coordinator SHA-256:
  `8961ae2caac67fae1480e6f5ec64fe8c05f0e467b8bbc598ac27ab98e4f62946`.
- assembly manifest SHA-256:
  `1412b84e4c41b580fc94cd67414f3de1c2bf7e8a17b89eddfcaa68c98f4d06f0`.
- runtime identity:
  `sha256:0301ccd9aa2a513a793dcaf100cda54eaa29837cd6effc5a72fb34796f958921`.
- `verifyInternalAppBundle`과 `codesign --verify --deep --strict` 통과.
- 기존 설치본 identity를 한정된 이전 런타임 호환 목록으로 포함했다. 이 목록은 이전 Hook의
  승인 자격을 새로 부여하거나 설치 중 프로세스 보호를 해제하지 않는다.
- ad-hoc 서명이다. Developer ID 서명·Apple 공증·새 DMG/ZIP 제작은 수행하지 않았다.
- 상세: 같은 폴더의 `build-report.json`. private 빌드 디렉터리는 보존했다.

## 설치가 아직 반영되지 않은 이유

읽기 전용 검사에서 `/Applications/Blabee.app`은 build `18`이며 실행 파일 inode
`69415526`을 Pet `7526`, 소유 서비스 `7530`, MCP `41018`, `61889`, `71523`이 사용했다.
MCP `41018`·`71523`의 부모는 Codex `32127`, MCP `61889`의 부모는 Codex `61825`였다.
숫자는 검사 당시의 PID이며 나중에 종료 명령의 대상으로 재사용하면 안 된다.

프로세스 표시 경로만으로 동일 세대를 판단하지 않고 `lsof`의 실제 실행 파일 매핑을
대조했다. 다른 일부 MCP도 설치 경로를 표시했지만 실제 매핑은 별도 백업 앱이었다.
관련 Codex/MCP에는 현재 작업 세션도 포함되므로 일괄 종료나 강제 교체를 하지 않았다.

현재 제품의 `AppInstallationProcessGuard.requireInactive`는 대상 앱 안의 실행 파일을
사용하는 프로세스가 있으면 `applicationActive`로 거부하도록 되어 있다. 이번에는 사전
확인으로 이미 활성 사용을 확인해 설치를 시도하지 않았다. 실제 설치 UI가 오류를 반환한
시험이나 설치 성공으로 보고하지 않는다.

현재 설치본 coordinator SHA-256은 이전과 같은
`eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`다.
설치본 이동·교체·신규 백업 생성, 사용자 프로세스 종료, Codex 설치/신뢰/세션/서비스 설정
변경은 하지 않았다.

## 이어서 설치하기

1. 사용자가 Blabee를 사용하는 Codex 작업을 마무리하고 해당 세션을 정상 종료한다.
2. Blabee 메뉴바의 종료를 사용해 Pet과 앱이 소유한 서비스를 종료한다.
3. 활성 프로세스가 없는지 다시 확인한 뒤 위 새 앱을 실행해 설치 안내에서 교체한다.
   보호가 계속 작동하면 강제 종료·우회하지 않고 남은 프로세스를 확인한다.
4. 설치된 build `21`·서명·실행 파일 identity 및 서비스 연결을 확인한다.
5. 평소 방식으로 Codex를 시작해 세 버튼 표시, 이번만 승인·거절·직접 선택 및 같은 명령의
   새 요청에 재승인이 필요한지 검증한다.

## 소스와 커밋 범위

새 빌드에는 아직 커밋되지 않았던 설치 복구·Codex 재검사·구형 래퍼 정리·연결 상태
화면과 Hook 일회성 승인 개선이 함께 들어 있다. 공유 UI와 전송 코드의 의존성을 유지해
관련 제품 Swift·테스트·안내/검증 문서를 함께 보존한다. 다른 앱·CI·데모 사이트·아키텍처
웹 문서·PDF·개인 임시 파일·빌드 바이너리는 커밋하지 않는다.

소스 자동 검증은 직전 작업의 Swift Testing 809개 + XCTest 5개, Node 360개 통과를
사용한다. 이번에는 동일 입력 fingerprint의 fresh release 빌드와 앱 검사를 추가했다.
실제 사용자 승인 성공은 이 결과와 구분한다.

- 승인 수정: [원인 및 검증 기록](PERMISSION_CARD_APPROVAL_KO.md).
- 연결 화면: [설정 상태 구분](CONNECTION_STATUS_UI_KO.md).
