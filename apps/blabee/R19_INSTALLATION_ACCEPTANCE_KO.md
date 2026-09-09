# r19 DMG 제작·설치 검증 기록

작성일: 2026-09-09 (KST)
상태: DMG 제작·패키지 검사 및 실제 설치 안내·사용 중 차단 확인 완료.
기존 Pet·서비스·MCP가 실행 중이어서 교체는 중단됐으며, 설치 성공 경로는 미검증이다.
후속 요청으로 r19 테스터 ZIP 제작과 압축 해제·checksum·문서 검증을 완료했다.

## 이번 파일

- DMG: `build/internal-dmg-20260909-r19/Blabee-0.1.0-internal-arm64-20260909-r19.dmg`
- 같은 폴더의 `.dmg.sha256`을 함께 사용한다.
- 버전 `0.1.0`, build `19`, exact `arm64`, 선언된 최소 macOS `13.0`.
- 앱은 ad-hoc 서명, DMG는 미서명·미공증이다. 지정된 내부 테스트 전용이며 공개 배포하지 않는다.
- r18 DMG·ZIP은 수정하지 않았다. 후속 ZIP 요청 결과는 아래 별도 항목에 기록한다.
  기존 r18 ZIP의 가이드·빌드 번호·checksum을 r19 검증에 사용하지 않는다.

DMG SHA-256:
`320b3fb7f53b33489b2d8ddd71b179865cde7bfaaff4d1b3be40e59bdaead396`

## 설치 확인 순서

1. DMG와 checksum이 있는 폴더에서 아래 명령의 `OK`를 확인한다.

   ```sh
   shasum -a 256 -c Blabee-0.1.0-internal-arm64-20260909-r19.dmg.sha256
   ```

2. DMG 안의 `Blabee.app`을 연다. 이제 원본 위치에서는 서비스·Codex 설정 대신
   **Blabee 설치가 필요합니다** 안내가 나와야 한다.
3. 이 앱의 build `19`, 설치 위치 `/Applications/Blabee.app`, 기존 앱의 버전을 확인한다.
4. **응용 프로그램에 설치하고 시작**을 선택한다. 기존 앱을 교체해야 하면 별도의
   **백업하고 교체** 확인이 나온다. 같은 앱이나 더 최신 앱이면 설치된 앱 열기를 제공한다.
5. 설치된 Blabee 또는 관련 MCP가 실행 중이면 교체를 중단해야 한다. 앱 메뉴바의
   **Blabee 종료**는 Pet과 소유 서비스만 종료하며 Codex에 붙은 MCP까지 종료하지 않는다.
   Codex 작업을 안전하게 마친 뒤 정상 종료할 시점을 사용자와 정한다. 프로세스 강제 종료,
   검사 우회, 실행 중 앱 덮어쓰기로 테스트를 통과시키지 않는다.
6. 설치가 성공하면 `/Applications/Blabee.app`의 build·서명·실행 PID identity를 확인한다.
   설치본 열기 성공과 서비스 연결·Hook 신뢰·카드 선택 반환은 서로 다른 검증이다.

자동 처리가 안 될 때의 Finder 안내는 유지된다. 다른 프로세스의 사용 상태를 확인할 수 없거나
macOS가 차단하면 무리하게 교체하지 않는다. macOS 보안 확인은 사용자가 직접 판단하며
quarantine 삭제·전체 Gatekeeper 해제·서명 재작성은 하지 않는다.

## 제작·자동 검사 증거

- `npm run build:internal-dmg -- --build-number 19 --compatible-previous-app /Applications/Blabee.app --output <위 DMG의 절대 경로>` 성공.
- 새 private source snapshot에서 release 컴파일. 기존 빌드 실행 파일을 재사용하지 않았다.
- release 입력 134개 파일의 SHA-256 fingerprint:
  `f82bfabc7ddcc2471b7b0b469aa6e113cb5ceaab970ce70440ffab5be33758f2`.
  빌드 완료 후 원본 fingerprint와 일치했다.
- 서명 전 입력 바이너리:
  `a54bc40053a0585020f3df945dd1a15f2d87de0ced7168a2f7a36ec0527cb5b4`.
- 최종 DMG 내 coordinator:
  `5c39fbd9249ef2ee171102ac43c5d12c785cc65fa2d3432bbed4512c95fd09b9`.
- assembly manifest:
  `6e04711cabc53a3dc760750c1ca2ef87492a8e0bb1e898d69f609017590a8c47`.
- 빌더 검사와 별도의 `hdiutil verify`, sidecar checksum, 읽기 전용 mount,
  `codesign --verify --deep --strict`, `verifyInternalAppBundle`, exact arm64 확인 통과.
- 이미지 루트는 `Blabee.app`, `Applications -> /Applications`, `INTERNAL_TESTING.txt` 세 항목.
- 패키징 집중 Node 테스트 81개 통과, 실패·건너뜀 0.
  최초 sandbox 실행에서는 DiskImages 접근 오류로 3개가 실패했고,
  승인된 일반 macOS 실행에서 같은 테스트 전체가 통과했다. 제품 수정으로 해결한 오류가 아니다.
- 설치·교체·실행 경로 집중 Swift 테스트 71개 통과 (`AppInstallation|ProductInvocation`).
- DMG 내 Hook 설정과 제안 스킬의 바이트가 현재 소스와 일치했다.
  이전 runtime 호환 정보는 검증한 build 18 하나이며 `emit_decision`, `session_start`,
  `stop`, `user_prompt_submit`에 한정된다. 설치의 실행 중 보호를 완화하지 않는다.
- 이전 구현 턴의 전체 Swift 788개 + XCTest 5개, 전체 Node 360개 통과는 이전 증거다.
  이번 실제 설치의 성공을 대신하지 않는다.

## 실제 환경의 시작 상태

- 설치본: `/Applications/Blabee.app`, build `18`, deep/strict 서명 검사 통과.
- 설치 전 coordinator SHA-256:
  `eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`.
- 최초 관찰에서 이 설치본을 실행하는 Pet·서비스·MCP 프로세스 16개.
  이 상태에서는 자동 교체의 사용 중 보호가 작동해야 한다.
- Computer Use: Finder의 접근성 트리는 조회 가능하지만 Blabee 이름/설치 절대 경로 조회는
  `-10005: timeoutReached`. 번들 ID 조회는 여러 설치본 때문에 ambiguous였다.
  이 오류는 Blabee 설치 오류 코드와 구분한다.
- 준비 후 다시 확인한 설치본 coordinator 해시는 위 build 18 값과 동일하다.
  기존 앱·서비스·MCP·Codex를 종료하거나 교체하지 않았다.
- 검사한 DMG를 `/private/tmp/blabee-r19-install.3OgzXN`에 읽기 전용으로 마운트해 준비했다.
  아래 승인 후 검증을 마치고 정상 해제했다.

## 승인 후 실제 UI 검증 — 2026-09-09

- 사용자가 새 앱 실행과 백업·교체 시도를 승인했다. Codex·MCP가 사용 중이면
  종료하거나 우회하지 않고 멈추는 범위를 유지했다.
- 마운트된 r19 앱의 build·deep/strict 서명·coordinator SHA를 다시 대조한 뒤
  Computer Use에서 정확한 앱 경로로 실행했다. **Blabee 설치** 창과
  **Blabee 설치가 필요합니다** 안내를 실제 접근성 트리·화면에서 확인했다.
- 화면에 원본 build `19`, 기존 설치본 build `18`, 대상 `/Applications/Blabee.app`이 표시됐다.
  새 설치 안내 창의 조회는 성공했다. 이전 build 18 Pet 화면의 timeout 원인까지
  해결됐다고 판단하지 않는다.
- **응용 프로그램에 설치하고 시작** 클릭 후 **기존 Blabee를 백업하고 교체할까요?**
  확인 창, 기존/새 build, 백업 및 Codex 비변경 안내를 확인했다.
- 다음 클릭 직전에 도구가 사용자 화면 변경을 감지해 해당 자동 입력을 중단했다.
  같은 버튼을 재전송하지 않고 최신 상태를 다시 조회했다. 이후 화면에 아래 결과가
  표시됐으므로 설치 시도의 사용 중 차단은 관찰했지만, 마지막 확인 클릭의 주체를
  도구 실행 성공으로 기록하지 않는다.

  > 설치된 Blabee 또는 관련 프로세스가 실행 중입니다. 종료한 뒤 다시 시도하세요.

- 오류 뒤 설치 버튼은 비활성, **다시 확인**과 **닫기**는 사용 가능했다.
- 기존 설치본은 build `18`, coordinator SHA
  `eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`로 유지됐고
  deep/strict 서명 검사도 통과했다. 실제 백업·교체·새 설치본 실행 성공으로 기록하지 않는다.
- 이 시도 전후 Pet PID `7526`, 소유 서비스 PID `7530` 및 설치본 MCP 15개를 확인했다.
  새 설치 창 PID `58697`만 닫기 버튼으로 종료했다. 다른 프로세스는 종료하지 않았다.
- 검증 후 `hdiutil detach /private/tmp/blabee-r19-install.3OgzXN`이 `disk4 ejected`로 성공했다.
  원본 r19 DMG와 checksum은 보존했다. 코드 수정·재빌드·commit/push는 하지 않았다.

## 남은 확인

- 설치본 사용 프로세스가 안전하게 종료된 환경의 최초 설치/기존 앱 교체.
- 새 설치본의 identity·실행 확인, 서비스 연결, Hook·선택 반환.
- 다른 Mac·Downloads·quarantine·App Management 환경.

## 후속 테스터 ZIP 제작 — 2026-09-09

- 사용자 요청은 기존 r19를 ZIP으로 묶는 것이다. 앱 재빌드·설치·프로세스 종료·commit/push는 하지 않았다.
- ZIP: `build/tester-distribution/Blabee-0.1.0-internal-arm64-20260909-r19-testers.zip`.
- 크기: `2526650` bytes. SHA-256:
  `7ae2a1348ad9ea304b7107a48fc6cd942c74872785d62b7d720cb157f780c834`.
- 동일 폴더의 `.zip.sha256`도 생성하고 검증했다. ZIP 내부는 r19 DMG·sidecar,
  최신 Markdown 안내 4개, `CONTENTS.sha256`의 정확히 7개 일반 파일이다.
- 가이드에 설치 창·백업 확인·사용 중 차단, 정상 종료와 MCP 구분,
  **Codex 연결하기**와 **Codex 실행 다시 검사**의 차이 및 `plugin_not_installed` 대응을 반영했다.
- 새 private 임시 폴더에 압축 해제한 뒤 ZIP 무결성, 여섯 내부 hash·DMG sidecar,
  원본 DMG/문서 바이트 일치, 상대 링크·앵커 12개를 확인했다. 별도 QA의 High/Medium 차단 이슈는 없다.
- 구 PDF·Codex 실행 파일·개인 설정·원문 로그는 포함하지 않았다.
- r18 ZIP SHA-256은
  `65f323725b26279ff59d9133eb5a6a5bafa7dba7f39651003cd67074d4fff227`로 유지된다.
- ZIP 검사 성공은 위 설치·다른 Mac·Hook/서비스/선택 왕복의 미검증 상태를 바꾸지 않는다.
  전달할 안내와 양식은 [r19 릴리스 기록](INTERNAL_DMG_R19_RELEASE_KO.md)을 따른다.

설계와 안전 경계: [앱 설치 위치 복구](INSTALLATION_RECOVERY_PLAN_KO.md).
