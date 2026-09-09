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
- ad-hoc 서명이다. 이 최초 앱 빌드 단계에서는 Developer ID 서명·Apple 공증·DMG/ZIP
  제작을 수행하지 않았다. 후속 DMG 제작 증거는 아래 별도 항목에 기록한다.
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

### 설치 재개 조건 재확인 — 2026-09-10 00:51 KST

- 설치본은 여전히 build `18`, 준비된 새 앱은 build `21`이다. 두 coordinator의
  SHA-256은 위 기록과 일치하며 새 앱의 `codesign --verify --deep --strict`도 통과했다.
- `lsof`로 설치본 inode `69415526`의 실제 사용자를 다시 확인했다:
  앱 프로세스 `7526`, 그 자식 서비스 `7530`, MCP `41018`·`71523`·`61889`.
- `ps`로 MCP `41018`·`71523`의 부모가 Codex `32127`, MCP `61889`의 부모가
  Codex `61825`인 것을 재확인했다. 이 PID는 관찰 기록이지 종료 명령 목록이 아니다.
- 따라서 정상 종료 조건은 아직 충족되지 않았다. 설치 보호를 우회하거나 설치를
  시도하지 않았으며 현재 또는 다른 Codex/MCP·Pet·서비스를 종료하지 않았다.
- 설치·재시작·설치된 r21의 실행 identity/서비스 연결·실제 승인 왕복은 계속 미완료다.
  이번 재확인은 실행 파일 사용 상태만 확인했으며 서비스 연결 성공을 새로 입증하지 않는다.
- 이 문서에 확인 결과만 추가했다. Codex 실행 파일·실행 방식·신뢰 설정·세션 기록은
  변경하지 않았다. 기존 소스 커밋은 `79f843e`이며 이 재확인 기록은 별도 커밋하지 않았다.

### 사용자 정상 종료 후 진행

1. 사용자가 Blabee를 사용하는 Codex 작업을 마무리하고 해당 세션을 정상 종료한다.
2. Blabee 메뉴바의 종료를 사용해 Pet과 앱이 소유한 서비스를 종료한다.
3. 활성 프로세스가 없는지 다시 확인한 뒤 위 새 앱을 실행해 설치 안내에서 교체한다.
   보호가 계속 작동하면 강제 종료·우회하지 않고 남은 프로세스를 확인한다.
4. 설치된 build `21`·서명·실행 파일 identity 및 서비스 연결을 확인한다.
5. 평소 방식으로 Codex를 시작해 세 버튼 표시, 이번만 승인·거절·직접 선택 및 같은 명령의
   새 요청에 재승인이 필요한지 검증한다.

## 후속 요청 — 새 앱 실행·내부 패키징 (2026-09-10 KST)

- Computer Use로 `build/local-approval-20260910-r21/Blabee.app`을 열었고
  **Blabee 설치** 창을 실제 확인했다. 원본 build `21`, 설치된 앱 build `18`,
  **응용 프로그램에 설치하고 시작** 버튼이 표시됐다. 설치/교체 버튼은 누르지 않았다.
- 현재 소스에서 fresh 빌더로 DMG를 생성했다. 입력 136개 파일 fingerprint는 최초
  r21 앱 빌드와 동일하다. 상세 결과는
  `build/internal-dmg-20260910-r21/build-report.json`에 보존한다.
- DMG: `build/internal-dmg-20260910-r21/Blabee-0.1.0-internal-arm64-20260910-r21.dmg`.
  SHA-256: `fffc4db01813ef6dc0d324cce248c00fc15110e398adce089d76f34517860bd7`.
- 생성 파이프라인의 이미지 검사·읽기 전용 mount·build/arm64/서명 확인에 더해,
  최종 DMG를 독립적으로 다시 mount하고 앱을 재검증했다. `diff -qr`로 DMG 안의 앱과
  위 실행 후보 앱의 모든 파일 내용이 일치함을 확인했다. 검사용 DMG는 정상 해제했다.
- `npm run test:t012`: 샌드박스에서는 79개 통과/3개 실패(`hdiutil` 사용 제한).
  권한을 허용받은 동일 명령 재실행은 82개 통과/실패 0/건너뜀 0이다. 소스 수정은 없었다.
- 이는 **설치 안내 창의 실행과 배포 앱 무결성** 증거다. `/Applications` 교체·설치본
  재시작·서비스 연결·승인 왕복 완료로 해석하지 않는다. Codex나 관련 세션은 종료하지 않았다.
- 테스터 ZIP: `build/tester-distribution/Blabee-0.1.0-internal-arm64-20260910-r21-testers.zip`.
  2,618,811 bytes, SHA-256:
  `c1333eca9c5cdabf96b175a8acfb7a76075db93279ffc0c09b873f67f56a3314`.
- 일반 파일 7개(DMG·sidecar·r21 안내 4개·CONTENTS.sha256)만 포함한다. `unzip -t`,
  별도 빈 폴더 추출, 내부 checksum 6개·DMG sidecar·외부 ZIP checksum, staging/추출본
  전체 파일 비교를 통과했다. 추출된 안내문은 원본과 같고 상대 파일 링크 14개를 확인했다.
  링크 검사의 최초 진단 스크립트는 정상적인 `./파일명`을 정규화하지 않아 거부했으나,
  경로 정규화를 고친 읽기 전용 재검사에서는 통과했다. 패키지 파일 수정은 필요 없었다.
- 마지막 읽기 전용 확인에서도 설치본 build `18`과 이전 coordinator hash가 유지됐다.
  기존 배포본과 Codex를 보존했고, 이번 문서·패키징 변경의 커밋/푸시는 하지 않았다.

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
