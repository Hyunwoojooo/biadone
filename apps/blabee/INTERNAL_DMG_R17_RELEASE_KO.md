# Blabee 내부 DMG r17 릴리스 기록

작성일: 2026-09-09 (KST)
대상: 지정된 내부 테스터. 공개 배포 미승인.

## 전달 파일

전달용 ZIP:
`build/tester-distribution/Blabee-0.1.0-internal-arm64-20260909-r17-testers.zip`

ZIP을 풀면 다음 파일이 들어 있다.

- `TESTER_START_HERE_KO.md` — 먼저 읽는 간단 안내
- `INTERNAL_TEST_INSTALL_GUIDE.md` — 설치·업데이트·복구 상세 안내
- `INTERNAL_DMG_R17_RELEASE_KO.md` — 이 릴리스의 검증과 제한
- `TESTER_RESULT_TEMPLATE_KO.md` — 테스트 결과 제출 양식
- `Blabee-0.1.0-internal-arm64-20260909-r17.dmg`
- `Blabee-0.1.0-internal-arm64-20260909-r17.dmg.sha256`
- `CONTENTS.sha256` — 위 여섯 파일의 SHA-256 목록

ZIP의 `.zip.sha256`은 외부 전달 무결성을 추가 확인할 때 ZIP과 함께 전달한다.
압축을 푼 뒤 내부의 `.dmg.sha256` 검사는 반드시 별도로 수행한다.
체크섬은 손상·파일 불일치 확인용이며 Developer ID 서명이나 Apple 공증을 대신하지 않는다.
구 PDF, 소스 코드, 사용자 설정·로그·Codex 실행 파일은 ZIP에 포함하지 않는다.

DMG SHA-256:
`7d131ed04899a7ca78f4c3758a5965a7d90beb79260cd2f1b791336a72867bae`

앱 버전 `0.1.0`, build `17`, exact `arm64`, 선언된 최소 macOS `13.0`.
앱은 ad-hoc 서명, DMG는 미서명·미공증이며 `public_distribution_ready=false`다.
Intel 및 조직 정책상 미공증 앱을 실행할 수 없는 환경은 이번 테스트 대상이 아니다.

## 포함한 변경

- 구형 Codex 셸 연결 검사와 명시적 복구: 정확한 원본 v4 래퍼만 사용자 확인 뒤
  고유 백업으로 이동한다. `.zshrc`, Codex 본체, 대화 기록, 다른 Plugin은 변경하지 않는다.
- **수동 수정본은 자동 정리하지 않는다.** r15에서 `.local/bin/codex`로 직접 수정한
  래퍼는 자동 복구 보장 대상이 아니다. 상태를 보고하고 수동 복구 범위를 별도로 확인한다.
- **Codex 실행 다시 검사**의 진행·완료·시각·소요 시간·결과 표시 및 비식별 진단 복사.
- 앱 실행형 서비스와 기존 Plugin/Hook 연결 경로를 유지한다. 일반 `codex`, `/resume`,
  PATH 또는 셸 함수를 새 래퍼로 가로채지 않으며 공식 Codex 런타임을 번들에 넣지 않는다.
- 검증한 build 15·16의 제한된 이전 runtime identity 호환 정책을 포함한다.
  이전 바이너리를 섞은 것이 아니며, 열린 모든 Codex 세션의 이관 성공을 뜻하지 않는다.

## 제작과 검증

기존 `.build` 바이너리를 재사용하지 않고 현재 작업 트리의 private source snapshot에서
`npm run build:internal-dmg`로 새 release 빌드를 생성했다. 포함한 소스는 아직 미커밋이며
이번 요청에서는 commit/push나 설치본 교체를 하지 않았다.

release 입력 fingerprint: 124개 파일,
`bb809f481cdd70cfe9732cb41561a5a49fffa42ace151aa0f69798d68f003a88`.

fresh release 입력 바이너리 SHA-256:
`60ff1a04d0b814d8d7f6e7b18dfbb610ade4a2c91d3cba08142f2166f77d7a94`.
앱 ad-hoc 서명 전 입력의 hash이며, 서명된 내장 바이너리 hash와 구분한다.

| 검사 | 결과 | 범위 |
|---|---|---|
| 전체 Node 회귀 | 360 통과, 실패·건너뜀 0 | 계약·Hook·영속성·패키징·검사기 회귀 |
| 전체 Swift 회귀 | Swift Testing 696 + XCTest 5 통과 | 명시적 성능 benchmark는 제외 |
| fresh release | 통과 | private snapshot 일치·exact arm64·로컬 `/Users/` 경로 검사 |
| 빌더의 앱/DMG 검증 | 통과 | build 17·deep/strict 서명·DMG 검증·readonly mount·정상 detach |
| 게시된 DMG checksum | 통과 | `.dmg.sha256`의 `OK` 확인 |
| 완성 DMG 독립 재검사 | 통과 | `hdiutil verify`, 다시 mount한 앱의 서명/build/arm64, 정확한 루트 3개, 정상 detach |
| 내장 Plugin·Codex 분리 | 통과 | Hook/launcher/skill이 현재 소스와 동일, Codex 본체·code-mode-host 없음 |

서명된 내장 coordinator SHA-256:
`78cfa6f926c1b01d5b3a111349096f392e91f45c8d3ab44610455dc2616d7f72`.
assembly manifest SHA-256:
`0f2684a685b39496db7d42eb11069872ef6865703d3b237cba5f87f0cb5a4ffb`.

Swift 테스트의 최초 샌드박스 실행은 Xcode 캐시 쓰기 제한으로 시작하지 못했다.
승인된 실행에서 위 전체 회귀를 통과했으며 이를 제품 실패와 구분했다.

빌드 재현 형식:

```sh
npm run build:internal-dmg -- \
  --build-number 17 \
  --output "$PWD/build/internal-dmg-20260909-r17/Blabee-0.1.0-internal-arm64-20260909-r17.dmg" \
  --compatible-previous-app /absolute/path/to/verified-build-15/Blabee.app \
  --compatible-previous-app /absolute/path/to/verified-build-16/Blabee.app
```

기존 출력은 덮어쓰지 않는다. 이후 새 배포 후보에는 더 큰 build 번호와 새 출력 경로를 쓴다.
실제 제작에는 검증된 r15 DMG를 읽기 전용으로 mount한 앱과 설치된 build 16을 사용했다.

## 실제 사용 검증과 구분할 것

개발 Mac의 build 16은 사용자 제공 화면에서 **서비스 연결됨**, **자동 시작 서비스 미등록**,
**Plugin 설치됨 · Hook 상태 확인**을 관찰했다. 실행 검사 결과는 Codex `0.153.4`,
2.9초, `plugin_installed_hook_trust_unknown`, `error_code=none`이었다.
이것은 build 16의 제한된 관찰이지 새 r17 설치·다른 Mac·진단 복사·선택 반환의 성공 증거가 아니다.

이번 패키징 작업에서는 개발 Mac의 실행 중인 Blabee·서비스·Codex를 종료·교체·재시작하지 않았다.
테스터는 설치 확인과 별도로 **원래 답변 종료 → Pet 카드 → 선택 → 같은 세션의 새 턴 →
실제 작업 결과**를 확인한다. 다른 사람이 설치한 결과를 기다리는 것은 이번 배포의 목적이다.

## 알려진 제한

- 미공증 내부 앱이다. 시스템 전체 Gatekeeper 비활성화, quarantine 삭제 또는
  조직 보안 정책 우회는 하지 않는다. 정책상 실행할 수 없으면 테스트를 중단한다.
- `BLB-MACOS-SERVICE-001`: 기존 macOS 자동 시작 서비스의 서명 문제는 미해결이다.
  내부 테스트는 사용자가 선택한 **앱 실행형 서비스** 경로를 사용한다.
- `BLB-APP-SERVICE-001`: 첫 Keychain 승인 대기로 시작 기한을 넘을 수 있다.
  예상한 Blabee 요청인지 먼저 확인하고 반복 암호 요청은 중단·보고한다.
- `BLB-APP-SERVICE-002`: 서비스 메모리 증가와 장시간 안정성은 계속 조사 중이다.
- `BLB-SHELL-001`: 수정본 래퍼/불명확한 셸 초기화는 자동 정리 범위 밖이다.
- `BLB-RECHECK-001`: 완료 표시의 사용자 관찰은 있지만 새 r17의 검사 시작 과정·진단 복사
  버튼·같은 결과의 새 시도 갱신은 다른 Mac에서 별도로 확인해야 한다.
- Plugin 설치, `/hooks` 신뢰, 서비스 연결, 카드 표시, 선택 반환은 서로 다른 확인 단계다.
  일반 Codex Plugin 연결과 관리형 App Server 권한 승인의 자격도 별개다.
- clean Mac 설치/이전 r15 업데이트, FIFO, sleep·재로그인, 중단 복구와 전체 권한 카드 왕복은
  이번 패키징 통과만으로 검증 완료 처리하지 않는다.

설치 절차는 [설치 가이드](INTERNAL_TEST_INSTALL_GUIDE.md), 결과 제출은
[테스트 결과 양식](TESTER_RESULT_TEMPLATE_KO.md)을 사용한다.
