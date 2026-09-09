# r20 설정 화면 검증 준비·교체 보류 기록

- 작성일: 2026-09-09 (KST)
- 결과: 새 앱 빌드·무결성 검사 완료. 설치본 사용 중 사전 확인으로 교체·재시작 보류.
- 실제 설정 화면 클릭·펼침·스크롤, Codex 선택 반환은 미검증.

## 준비된 앱

- 위치: `build/local-readiness-20260909-r20/Blabee.app`
- 버전: `0.1.0`, build `20`, `arm64`, 선언된 최소 macOS `13.0`.
- 현재 소스의 private snapshot을 만든 뒤 새 scratch에서 release 컴파일했다.
- 빌드 입력 136개 파일 fingerprint:
  `8b9e607f3fd686ffd40b381b15e2f3e21036741fb843a4ba849d767ed88b9f12`.
- snapshot 직후, 빌드 직후, 앱 조립 직후와 최종 검사에서 live source/snapshot 일치를 확인했다.
- coordinator SHA-256:
  `52a9e7a2dd2d32ecf14510bf35498bef795b657b30021358dca8ddcdf53c6a58`.
- assembly manifest SHA-256:
  `31dac8a5ef1a838080b84c9c3a10e665d6436868a1b811bfbca7409e491c2bd3`.
- 앱 runtime identity:
  `sha256:1a303958dc11d8b67569af936d3c925a0699e67e72172cb09e04f4e7c5f64cc3`.
- `codesign --verify --deep --strict`, `verifyInternalAppBundle`의 build/architecture/plist 검사 통과.
  Plugin 6개 파일도 현재 소스와 바이트가 일치한다.
- ad-hoc 서명이며 Apple 공증·공개 배포 자격은 없다. 이번에는 DMG/ZIP을 만들지 않았다.
- 상세 빌드 자료: 같은 폴더의 `build-report.json`.
  private scratch `/private/tmp/blabee-readiness-r20-build-lljmhj`는 보존했다.

## 설치본과 실행 상태

- 현재 `/Applications/Blabee.app`은 build `18`. build 20으로 교체되지 않았다.
- coordinator SHA-256:
  `eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`.
- assembly manifest SHA-256:
  `cc3a3450c238f66cdcc5887e668540f2be917f8aa46b4547adacc465184e1d23`.
- runtime identity:
  `sha256:6a88333872f0a036847ca8641e1df52de3ff84af58a51b68d3abe05d4ee51dbb`.
- Pet PID `7526`, 소유 서비스 PID `7530`, Codex 자식 MCP PID `61889`가 현재 설치본
  실행 파일의 같은 inode `69415526`을 사용함을 `lsof`로 확인했다. PID는 이 시점의 관찰값이다.
- 다른 일부 MCP의 프로세스 표시 경로는 `/Applications/Blabee.app`이지만 실제 매핑은
  이전 백업 앱이었다. 표시 경로만으로 실행 세대가 같다고 판단하지 않았다.
- 현재 소스의 설치 보호는 대상 앱 안 실행 파일의 사용을 발견하면 `applicationActive`로
  교체를 거부한다. 이번에는 사전 관찰에서 사용을 확인했으므로 설치·덮어쓰기를 시도하지 않았다.
  설치 UI의 거부 결과를 이번 턴에서 재현했다고 주장하지 않는다.
- 기존 앱을 이동·교체하지 않았으므로 새 백업도 만들지 않았으며 원본과 기존 백업을 보존했다.
  Pet·서비스·Codex·MCP를 종료하지 않았다.
- 프로젝트 설정 `config/service.json`의 확인 전후 SHA-256은
  `f012c31f5e2792c13a50ee50be101ab0be806ee1585739fd3c71cde93675b239`로 동일하다.

## 실제 화면 제어와 증거 경계

- Computer Use에서 정확한 `/Applications/Blabee.app` 경로 조회는
  `-10005: timeoutReached`로 실패했다.
- 번들 ID `com.biadone.blabee` 조회는 설치본·백업·이전 로컬 빌드가 함께 등록돼
  `Ambiguous app identifier`로 실패했다. 구형 복사본을 삭제하거나 등록을 바꾸지 않았다.
- 이 두 오류는 화면 제어 도구의 오류이며, Codex 연결 실패나 새 UI 자체의 결함으로 확정하지 않는다.
- 같은 사용자 계정의 Pet은 빌드와 무관하게 하나의 lease를 공유한다. 이를 우회한 두 번째 Pet이나
  임의의 mock 서비스로 실사용 검증을 대체하지 않았다.
- 별도 읽기 전용 QA도 기존 offscreen 렌더링 테스트는 안전하지만 실제 유리 효과·클릭·스크롤의
  증거가 되지 않음을 확인했다. 이전 턴의 Swift/Node/8개 렌더 검증과 이번 빌드 검사를 구분한다.
- 새 앱의 GUI 실행·설정 요약·상태별 버튼·상세 펼침·스크롤은 미검증이다.
  실제 Codex 카드 선택·원래 세션 반환 역시 수행하지 않았다.
- 코드 구조 확인에 쓴 그래프는 2026-09-03 세대여서 현재 파일과 어긋났다.
  설치 보호·Pet lease·빌드 경로는 coverage 확인 후 현재 소스를 직접 대조했다.

## 이어서 할 일

1. 사용 중인 Codex 작업을 마칠 시점에 사용자가 관련 세션을 정상 종료한다.
   어떤 세션인지 먼저 읽기 전용으로 범위를 확인할 수 있다. 일괄 강제 종료하지 않는다.
2. 사용 중 프로세스가 없는지 다시 확인한 후 Blabee를 정상 종료하고, 기존 앱 전체를 백업해 교체한다.
3. 새 설치본의 build·서명·실행 PID identity를 대조한 뒤 실제 설정 요약·버튼·펼침·스크롤을 확인한다.
4. UI 검증과 별도로 새 Codex 요청의 카드 수신 → 선택 → 원래 세션 반환을 검증한다.

Codex 실행 방식·Hook 신뢰·프로젝트 목록은 변경하지 않았고, commit/push도 수행하지 않았다.
