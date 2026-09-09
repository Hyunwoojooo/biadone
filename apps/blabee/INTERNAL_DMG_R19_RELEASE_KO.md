# Blabee 내부 DMG r19 릴리스 기록

작성일: 2026-09-09 (KST) · 지정된 내부 테스터용 · 공개 배포 미승인

## 전달 파일

전달 ZIP: `Blabee-0.1.0-internal-arm64-20260909-r19-testers.zip`

ZIP에는 다음 7개 일반 파일만 포함한다.

- `TESTER_START_HERE_KO.md` — 먼저 읽는 간단 안내
- `INTERNAL_TEST_INSTALL_GUIDE.md` — 설치·업데이트·연결 상세 안내
- `INTERNAL_DMG_R19_RELEASE_KO.md` — 이 릴리스의 검증 범위와 제한
- `TESTER_RESULT_TEMPLATE_KO.md` — 단계별 결과 양식
- `Blabee-0.1.0-internal-arm64-20260909-r19.dmg`
- `Blabee-0.1.0-internal-arm64-20260909-r19.dmg.sha256`
- `CONTENTS.sha256` — 위 여섯 파일의 SHA-256

외부 `.zip.sha256`도 제공한다. checksum은 파일 손상·불일치 확인용이며 출처 보증,
Developer ID 서명이나 Apple 공증을 대신하지 않는다. 구 PDF·소스·사용자 설정·로그·
Codex 실행 파일은 넣지 않는다. 기존 r18 DMG·ZIP은 보존한다.

앱 버전 `0.1.0`, build `19`, exact `arm64`, 선언된 최소 macOS `13.0`.
앱 ad-hoc 서명, DMG 미서명·미공증, `public_distribution_ready=false`.

DMG SHA-256:
`320b3fb7f53b33489b2d8ddd71b179865cde7bfaaff4d1b3be40e59bdaead396`

## r19에서 바뀐 점

- DMG/Downloads 등에서 앱을 열면 먼저 설치 위치 안내를 제공한다.
- **응용 프로그램에 설치하고 시작**으로 설치를 요청하고, 기존 앱이 있으면
  대상·버전을 검토한 뒤 **백업하고 교체**를 별도로 확인한다.
- 기존 앱이나 연결된 MCP가 사용 중이면 교체를 중단한다. 알 수 없는 사용 상태도
  안전을 위해 중단할 수 있다. 사용 중 앱 덮어쓰기로 우회하지 않는다.
- 이번 ZIP 안내는 **Codex 연결하기 = Plugin 설치**, **Codex 실행 다시 검사 = 상태 검사**를
  구분한다. `plugin_not_installed`와 `error_code=none`이 함께 있어도 연결 완료가 아니다.

일반 Codex 실행 방식·공식 설치본·셸 설정·기본 resume은 변경하지 않는다.
DMG 설치는 Plugin 설치나 Hook 신뢰를 자동으로 완료하는 동작이 아니다.

## 검증된 범위와 남은 확인

이 ZIP은 이미 제작된 r19 DMG를 그대로 사용한다. ZIP 제작 때문에 앱을 다시 빌드하거나
개발 Mac 설치본을 교체하지 않는다.

| 구분 | 기록 |
|---|---|
| r19 제작 단계 | fresh private source snapshot의 arm64 release 빌드 완료 |
| r19 DMG 검사 | 이미지·checksum·읽기 전용 mount·deep/strict 서명·build 19·arm64 확인 |
| 이전 구현 단계의 자동 검사 | Swift Testing 788개 + XCTest 5개, Node 360개 통과 |
| r19 제작 단계의 집중 검사 | 패키징 Node 81개, 설치/실행 Swift 71개 통과 |
| 실제 설치 안내 | 설치 창·기존/새 build·백업 교체 확인 창 관찰 |
| 실제 사용 중 보호 | 기존 Pet·서비스·MCP가 실행 중이어서 교체 차단, 기존 앱 유지 확인 |
| r19 설치 완료·설치본 실행 | 미검증 |
| r19 다른 Mac의 서비스·Hook·카드 선택 반환·권한 왕복 | 미검증 |

자동 검사 수치는 앞선 구현·DMG 제작 단계의 증거다. 이번 ZIP의 무결성 검사나 실제 설치
성공과 혼동하지 않는다. 단일 단계의 성공으로 전체 제품 동작이 검증됐다고 판단하지 않는다.

## 알려진 제한

- Apple Silicon 내부 테스트 후보다. Intel·다른 Mac/OS·최초 설치·업데이트·장시간 안정성은
  별도 자격 확인이 필요하다. 현재 선언된 최소 OS가 모든 해당 OS의 실기기 통과를 뜻하지 않는다.
- Apple 공증 전이다. macOS/조직 정책으로 실행이 차단되면 우회하지 않는다. 전체 Gatekeeper
  해제, quarantine 제거, 임의 재서명, Codex/host 개별 교체는 하지 않는다.
- **Blabee 종료**는 Pet과 앱이 소유한 서비스를 종료한다. Codex의 MCP까지 종료하지 않으므로
  업데이트가 계속 차단될 수 있다. Codex 작업을 안전하게 마치고 정상 종료한 뒤 확인한다.
  사용 상태가 불명확하거나 차단이 지속되면 진단을 보고하고 중단한다.
- macOS 자동 시작 서비스의 서명 문제는 별개로 남아 있다. 내부 테스트는 사용자가 직접 켜는
  **앱 실행형 서비스**를 사용하며, 자동 시작 서비스의 미등록 자체는 오류가 아니다.
- 첫 Keychain 승인 지연·반복 암호 요청·장시간 메모리 증가 문제는 별도로 관찰한다.
  예상하지 못한 요청이나 반복 오류가 있으면 중단한다.
- 수정본/불명확한 구형 셸 래퍼는 자동 정리하지 않는다. 기존 설정을 삭제하거나 symlink로
  우회하지 말고 상태를 보고한다.
- 명령 권한의 **이번만 허용**은 검증된 Codex 0.153.4 arm64 서명·현재 실행 관계에 한정된다.
  같은 버전 번호만으로 버튼 표시를 보장하지 않는다. 미검증 경로에서는 **거절**과
  **Codex에서 직접 결정**을 사용한다. 실제 버튼 왕복은 이번 테스트의 별도 확인 항목이다.

설치: [먼저 읽기](TESTER_START_HERE_KO.md), [상세 가이드](INTERNAL_TEST_INSTALL_GUIDE.md).
결과: [테스트 결과 양식](TESTER_RESULT_TEMPLATE_KO.md). 미실행은 미실행으로 남긴다.
