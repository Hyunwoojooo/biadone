# Blabee 내부 DMG r18 릴리스 기록

작성일: 2026-09-09 (KST) · 지정된 내부 테스터용 · 공개 배포 미승인

## 전달 파일

전달 ZIP: `Blabee-0.1.0-internal-arm64-20260909-r18-testers.zip`
저장 위치: `build/tester-distribution/`.

ZIP에는 정확히 다음 7개 파일을 넣는다.

- `TESTER_START_HERE_KO.md` — 먼저 읽는 간단 안내
- `INTERNAL_TEST_INSTALL_GUIDE.md` — 설치·업데이트·복구 상세 안내
- `INTERNAL_DMG_R18_RELEASE_KO.md` — 이 릴리스의 검증과 제한
- `TESTER_RESULT_TEMPLATE_KO.md` — 결과 제출 양식
- `Blabee-0.1.0-internal-arm64-20260909-r18.dmg`
- `Blabee-0.1.0-internal-arm64-20260909-r18.dmg.sha256`
- `CONTENTS.sha256` — 위 여섯 파일의 SHA-256

외부 `.zip.sha256`도 별도로 제공한다. checksum은 파일 손상·불일치 확인용이며
Developer ID 서명이나 Apple 공증을 대신하지 않는다. 구 PDF·소스·개인 설정·로그·
Codex 실행 파일은 전달하지 않는다. ZIP을 푼 뒤 내부 checksum을 검사하고 설치한다.

앱 버전 `0.1.0`, build `18`, exact `arm64`, 선언된 최소 macOS `13.0`.
앱 ad-hoc 서명, DMG 미서명·미공증, `public_distribution_ready=false`.

DMG SHA-256:
`ae22851504d924b33dbce83acdf1790ae93e996c4c4eefbe8b1e585c85e213e2`

## 포함한 변경

- 일반 Codex Hook에도 조건부 **이번만 허용**을 추가했다. 기본 `codex`·`/resume`·
  공식 런타임·PATH·셸 함수는 바꾸지 않으며 Codex 본체/동반 host를 동봉하지 않는다.
- Codex `0.153.4` arm64 고정 서명/CDHash와 live process ancestry가 입력/출력 시
  검증된 요청만 허용할 수 있다. 버전 문자열만 같다고 자격이 생기지 않는다.
  그 외 연결에서는 **거절**, **Codex에서 직접 결정**만 표시한다.
- 입력으로 받은 자격 표식은 폐기하고 로컬 검증 결과로 재생성한다. 응답의 exact schema,
  세션·턴·명령·세션 위치를 바이트 단위로 대조한 뒤 해당 요청의 `behavior: allow`만
  출력한다. 세션 전체·앞으로도 허용 정책이나 자동 승인 재시도는 만들지 않는다.
- Hook cwd를 **세션 위치**로 표시한다. 실제 명령의 workdir/environment가 제공되거나
  검증됐다는 의미가 아니다. 위치가 중요하거나 판단하기 어려우면 Codex에서 직접 결정한다.
- 기존 구형 셸 연결 복구, 재검사 진행/완료 표시·진단 복사, 앱 실행형 서비스를 유지한다.
- 검증된 build 16·17의 제한된 이전 runtime identity를 포함한다. 허용 메서드는
  `emit_decision`, `session_start`, `stop`, `user_prompt_submit`뿐이며 구형 권한 응답을
  새 허용 자격으로 승격하지 않는다. 업데이트 후 새 Codex 세션에서 `/hooks`를 확인한다.

## 제작과 검사 결과

현재 작업 트리의 private source snapshot에서 `npm run build:internal-dmg`로 새 release를
컴파일했다. 기존 `.build`·임시 승인 실험 바이너리를 재사용하지 않았다.
소스는 미커밋이며 이번 요청에서 설치본 교체·재시작·commit/push는 수행하지 않았다.

| 검사 | 결과 | 범위 |
|---|---|---|
| 전체 Swift | Testing 722 + XCTest 5 통과 | 성능 benchmark 별도 |
| 전체 Node | 360 통과, 실패·건너뜀 0 | 계약·Hook·저널·패키징 회귀 |
| 최종 fixture 정리 후 집중 재검사 | 7 통과 | Hook 출력 정책과 관련 테스트 |
| 독립 소스 QA | 패키징 차단 문제 없음 | 자격·응답 바인딩·반복 요청·문서 |
| fresh release | 통과 | private 입력 일치·arm64·로컬 경로 검사 |
| 빌더 DMG 검사 | 통과 | build·서명·이미지·readonly mount·detach |
| 완성 DMG 독립 재검사 | 통과 | `hdiutil verify`, deep/strict 서명, build 18, arm64 |
| 이미지 내용 | 통과 | 앱·Applications 링크·내부 안내의 루트 3개 |
| Plugin 내용 | 통과 | hooks/launcher/skill 소스 일치, Codex·host 없음 |
| DMG sidecar checksum | 통과 | SHA-256 일치 |

Swift 최초 실행은 샌드박스의 Xcode 캐시 쓰기 제한으로 시작하지 못했고, 승인된 재실행에서
전체 검사를 통과했다. 첫 빌드 시 출력 폴더 미준비와 독립 이미지 검사 시 상대 경로 실수는
바로잡아 재실행했다. 위 결과는 수정된 경로의 실제 성공 결과이며 제품 오류와 구분한다.

release 입력 fingerprint: 128개 파일,
`469ec69edb172f765e22d9f6cb35ed921798860b166ed6e2f0b8b159d7606814`.

fresh 서명 전 입력 바이너리 SHA-256:
`f973539c675cfa1826aa6cb63a261f7077a848c895dd4fce01279c9b1840ca07`.
서명된 내장 coordinator SHA-256:
`eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`.
assembly manifest SHA-256:
`cc3a3450c238f66cdcc5887e668540f2be917f8aa46b4547adacc465184e1d23`.

## 일회성 범위의 근거와 아직 검증하지 않은 것

정확한 Codex `rust-v0.153.4` 소스의
[approvals.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/core/src/tools/approvals.rs)는
Hook Allow를 `ReviewDecision::Approved`로 반환하고,
[sandboxing.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/core/src/tools/sandboxing.rs)는
`ApprovedForSession`만 캐시에 저장한다. Blabee 회귀 테스트에서도 동일 명령의 두 번째
요청은 새 ID로 대기하며 이전 선택으로 승인되지 않는 것을 확인했다.

이 소스·자동 검사는 실제 설치된 Pet 클릭 → native Hook 소비 → 명령 실행·완료 →
같은 권한 재요청의 새 결정을 대신하지 않는다. **이 실제 왕복은 미검증이며 이번 내부
테스트의 확인 항목이다.** launcher가 coordinator stdout을 종료까지 버퍼링하므로
delivery ACK 역시 adapter 출력 접수일 뿐 Codex 소비·작업 성공의 증거가 아니다.
사용자에게서 관찰한 build 16 서비스 연결/검사 성공은 r18 성공으로 합치지 않는다.

## 알려진 제한

- Apple Silicon 내부 테스트 전용이다. Intel·clean Mac·다른 macOS·최초 설치/업데이트·
  sleep·재로그인·다중 세션 FIFO·장시간 안정성은 별도 확인이 필요하다.
- 미공증 앱 실행이 조직 정책상 차단되면 우회하지 않는다. 시스템 전체 Gatekeeper 해제,
  quarantine 제거, Codex/host 개별 교체, 세션 lock 삭제를 안내하지 않는다.
- `BLB-MACOS-SERVICE-001`: macOS 자동 시작 서비스 서명 문제는 미해결이다.
  테스터는 사용자 opt-in **앱 실행형 서비스**를 사용한다.
- `BLB-APP-SERVICE-001`: 첫 Keychain 승인 대기로 시작 기한을 넘을 수 있다.
  반복 암호 요청은 중단·보고한다. 예상한 앱 요청인지 먼저 확인한다.
- `BLB-APP-SERVICE-002`: 메모리 증가·장시간 안정성은 계속 조사 중이다.
- 수정본/불명확한 구형 셸 래퍼는 자동 정리 범위 밖이며 파일 삭제·symlink 교체로 우회하지 않는다.
- Plugin 설치, Hook 신뢰, 서비스 연결, 다음 작업 제안, 권한 카드, 선택 반환, 실행 성공은
  서로 다른 검사다. 허용 버튼이 없더라도 기본 Codex의 native 결정 경로는 유지한다.

설치: [먼저 읽기](TESTER_START_HERE_KO.md), [상세 가이드](INTERNAL_TEST_INSTALL_GUIDE.md).
결과: [테스트 결과 양식](TESTER_RESULT_TEMPLATE_KO.md). 미실행은 미실행으로 기록한다.
