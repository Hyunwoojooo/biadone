# GitHub 업데이트와 Codex 관리 세션

## 목표와 사용자 선택

사용자가 설정에서 업데이트를 선택하면 GitHub Releases의 새 Blabee를 다운로드하고,
검증 후 Blabee와 관리 중인 Codex를 종료·교체·복원한다. 원래 터미널을 우선 유지하며,
복원할 터미널이 없거나 지원하지 않는 환경에서는 macOS Terminal의 새 창을 사용한다.

사용자는 2026-09-13에 Blabee 관리 세션 도입을 선택했다. 기존 외부 Codex 세션은
처음 한 번 정상 종료하고 관리 세션으로 전환해야 한다. 일반 `codex` 명령이나 기존
사용자 셸 설정은 변경하지 않는다. 복원 대상은 저장된 대화와 작업 폴더다. 미전송
입력 초안과 중단된 도구 프로세스의 메모리 상태는 복원하지 않는다.

## 구조

1. `PetAppUpdates`는 기존 `blabee-vX.Y.Z+build.N` 형식의 공개 정식 릴리스를 비교한다.
   자동 설치에는 정확한 `Blabee-X.Y.Z-arm64-rN.dmg`와 `.dmg.sha256` 자산이 필요하다.
2. `AppUpdateDownloadPreparer`는 제한된 HTTPS 주소·크기·시간으로 다운로드한다.
   SHA-256, Blabee Developer ID와 Team ID, 공증, 앱 버전, 실제 서명 식별값을 검증한다.
   런타임은 macOS 기본 도구만 사용하며 Xcode를 요구하지 않는다.
3. `AppUpdateRuntimeCopy`가 현재 전체 앱의 검증된 별도 복사본을 만든다. 실행 파일의
   inode가 달라야 설치된 앱의 공유 사용 잠금 때문에 업데이트가 막히지 않는다.
4. 업데이트 도우미는 종료·설치·복원 단계를 사용자 전용 journal에 기록한다.
   기존 `AppInstallationService`의 고정 설치 경로, 서명 확인, 사용 잠금, 백업과
   배타적 교체를 재사용한다. 구형·미확인 프로세스가 남으면 교체하지 않는다.
5. `UpdateManagedCodex` 감독 프로세스는 자기 전용 AppServer와 TUI만 관리한다.
   원래 터미널에서 대기할 수 있어 터미널 종류에 상관없이 같은 자리에서 재개한다.

새 production 의존성, 전역 프로세스 종료, 격리 속성 삭제, 사용자 설정 수정은 필요 없다.

## 관리 세션 저장·종료 기준

Codex의 native TUI에 종료 신호를 보내는 것만으로 저장 완료를 확인할 수 없다.
관리형 승인 프로필과 독립된 전용 lifecycle 프로필을 사용한다.
현재 자동 종료·복원 대상으로 검증한 버전은 `0.154.0`, `0.155.0`, `0.155.1`이며
목록에 없는 버전과 prerelease는 거부한다. Plugin 지원이나 승인 프로필 통과만으로
자동 종료·복원 지원을 추정하지 않는다.

- 전용 AppServer의 시작·재개·턴·요청·승인 상태를 관찰한다.
- 정확한 UUID의 대화 파일이 이 세션의 `CODEX_HOME`에 저장됐는지 먼저 확인한다.
  Codex가 아직 파일을 만들지 않은 새 대화는 종료하지 않고 사용자에게 안내한다.
- 새 변경 요청을 막고, 진행 중인 턴이나 요청이 있으면 종료를 진행하지 않는다.
- 모든 소유 스레드의 구독을 해제하고 `thread/closed`를 기다린다.
  `thread/unsubscribe` 응답만으로는 저장 완료가 아니다.
- 서버의 stdout·stderr를 끝까지 읽고 저장 실패, 출력 손실과 제한 시간 초과를 검사한다.
  서버 종료 신호나 종료 코드만으로 성공을 추정하지 않는다.
- 저장 완료를 확인한 뒤에만 자기 TUI 자식을 종료하고 터미널 상태를 복원한다.
- 정확한 thread UUID와 cwd로 재개하며 writable 재개 응답을 확인한다.
  `--last`, 초기 프롬프트 재전송, `/quit` 메시지 주입은 사용하지 않는다.

Codex 저장 실패는 `ShutdownComplete` 이후에도 문제가 될 수 있으므로
`RUST_LOG=warn`, `LOG_FORMAT=json`을 전용 자식 환경에만 적용한다. 사용자 로그 전체를
보관하지 않고 필요한 실패 여부만 기록한다. writer lock 파일은 삭제하지 않는다.

## 트랜잭션과 복구

준비 → 다운로드 검증 → 종료 대상 검토 → 사용자 실행 확인 → 도우미 준비 확인 →
Blabee 종료 → 관리 세션 저장·종료 → 설치 교체 → 새 앱 실행 확인 → 세션 재개 확인.

- 다운로드 실패는 실행 중 앱과 세션에 영향을 주지 않는다.
- 도우미가 준비됐다고 확인하기 전에는 Blabee를 종료하지 않는다.
- 일부 세션 종료가 실패하면 앱 교체를 시작하지 않고 이미 종료한 세션을 복원한다.
- 기존 설치 서비스의 게시 전 실패는 기존 검증된 롤백을 따른다.
- 게시 후 오류와 새 앱 실행 실패는 앱·백업을 보존하고 복구 상태로 남긴다.
  실행 여부가 불명확한 앱을 무조건 다시 덮어쓰지 않는다.
- 앱 설치 성공과 일부 세션 복원 실패를 따로 표시한다. 모호한 복원을 반복하지 않는다.

## 검증 계획

| 범위 | 필요한 증거 |
| --- | --- |
| 릴리스 파일 | 태그·파일명·크기·URL·SHA·서명·공증·버전·runtime identity 일치와 각 불일치 거부 |
| 도우미 | 전용 디렉터리, 별도 inode, 원본/복사본 변경 거부, 준비 전 앱 종료 없음 |
| 세션 | busy 거부, 모든 root/하위 스레드 종료, 저장 오류·pipe 손실·지연 거부 |
| 설치 | 실행 중 사용 잠금 보존, 기존 앱 변경 감지, 실패 전후 백업 보존 |
| 복원 | 정확한 UUID/cwd, writable 응답 확인, 중복 요청/중간 중단 처리 |
| 사용자 환경 | 격리 테스트용 세션의 실제 업데이트 왕복, 원래 터미널 유지 및 Terminal fallback |

자동 테스트·서명·공증과 실제 사용자 환경 검증은 각각 기록한다. 아직 공개된 릴리스가
없는 저장소에는 업데이트가 표시되지 않는다. 처음 updater를 포함한 앱은 수동 설치가
필요하며, 이후 더 높은 빌드의 GitHub Release로 자동 업데이트 경로를 검증한다.

### 2026-09-16 검증 결과

- Swift 관련 회귀 검사: 373개, 19개 suite 통과. 다운로드·설치·세션·복구·기존 Codex 연결 포함.
- 전체 AppPackaging: 145개 통과, 앱 경로가 필요한 opt-in 검사 1개 생략.
  조립한 앱을 지정해 해당 검사도 별도 실행: 5개 통과, 생략 없음.
- 공식 Codex 0.154.0 실제 AppServer: 시작 → 저장 → 구독 해제 → `thread/closed` →
  종료 코드 0 및 두 출력 EOF → 같은 UUID로 새 서버에서 재개 → 정상 종료 통과.
  네트워크와 사용자 홈 접근을 차단한 임시 `CODEX_HOME`에서 실행했고 모델 턴은 보내지 않았다.
  양성 fixture는 테스트 세션에만 `thread/section/move`를 적용해 파일을 생성했다.
  생성 전에는 새 세션의 광고된 파일이 실제로 없음을 확인했다.
- 독립 리뷰의 알림 순서·보조 대화·취소된 승인·저장 오류·Terminal 창 지적을 수정 확인했다.
- Release 실행 파일 빌드와 로컬 r41 앱 조립, 임시 서명 검증 통과.

로컬 검증 앱: `build/local-automatic-update-20260916-r41/Blabee.app`.
이 로컬 검증 앱은 배포용 Developer ID 서명·공증본이 아니다. 검증 당시 현재 설치된 앱을
교체하지 않았고, 이후 별도 배포용 DMG를 아래와 같이 게시했다. 공증된 두 버전 사이의 실제 다운로드·교체·대화 복원,
원래 터미널 유지, Terminal 권한 허용/거부 및 새 창 복원은 별도 실사용 검증이 남아 있다.

검증 로그:
`/private/tmp/blabee-automatic-update-final-tests.log`,
`/private/tmp/blabee-update-packaging-all.log`,
`/private/tmp/blabee-update-native-lease.log`.
실제 Codex wire 기록: `/private/tmp/blabee-native-update-contract-6wul28d5/result.json`
(SHA-256 `8dd7851612cfd01c31c23c8c23c628b0184dd7044e21dc81dcfd2cd398352b8f`).
재현 스크립트: `scripts/verify-update-managed-codex-native.py`.

### 2026-09-21 lifecycle 지원 확장 — 빌드 없이 검증

공식 `0.155.0`·`0.155.1` macOS arm64 패키지에서 각각 시작 → 테스트 대화 저장 →
구독 해제 → `thread/closed` → 두 출력 EOF와 종료 코드 0 → 새 AppServer에서 같은
UUID/cwd로 writable 재개 → 정상 종료를 확인했다. 버전별 공식 모델 catalog와 임시
`CODEX_HOME`을 사용했고 네트워크·사용자 홈 접근은 OS에서 차단했다. 모델 턴은 0개다.
두 버전의 thread unload, persistence shutdown, AppServer lifecycle 공식 소스도
파일별 SHA-256이 동일했다. 저장 완료 판단과 실패 시 거부 규칙은 변경하지 않았다.

검증기는 `--expected-version`과 별도 검증한 공식 실행 파일의 `--expected-sha256`을
명시적으로 요구한다. `--work-dir`은 새 private 증거 폴더를 둘 기존 절대 경로이며 기본은
`/private/tmp`다. `--execute`, `--codex`, `--catalog`도 함께 지정한다. 실제 Codex를
실행하지 않는 Node/Python 회귀 4개는 버전/해시 불일치, 명시적 실행 동의와 no-turn
RPC 경계를 검사한다.

실제 wire 증거는 `/private/tmp/blabee-codex-all-stable-9CoDxB/update-lifecycle-8zb21udx/`
아래 `blabee-native-update-contract-3eykujz1/result.json`(0.155.0),
`blabee-native-update-contract-xraf73qk/result.json`(0.155.1)에 있다.
Swift 회귀 소스는 새 버전 허용과 미검증 버전 거부를 보완했지만 실행하지 않았다.
이번 검증은 Swift 컴파일·앱 빌드·패키징·설치 교체·터미널 UI 복원을 수행하지 않았으며,
설치된 제품의 전체 업데이트 왕복이나 실행 중 모델 작업의 저장·복원 증거는 별도로 필요하다.

### r41 배포 완료 — 2026-09-16

- [GitHub 공개 최신 릴리스](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.41)
- 배포 파일: `build/release-dmg-20260916-r41/Blabee-0.1.0-arm64-r41.dmg`
- Developer ID Application 서명, Hardened Runtime, 보안 타임스탬프 확인.
- Apple 공증 `Accepted`: `791a87e4-7bea-4b1b-b44b-1547ae09dc5b`.
- DMG stapling·Gatekeeper 및 내부 앱 Gatekeeper `Notarized Developer ID` 확인.
- 최종 SHA-256: `a7f94bebb1624b9ecf57d837ddae4f40469a39c01c4083288869b7590d8afa17`.
- DMG·checksum·`r41-provenance.json` 게시 후 재다운로드 일치 확인.
  로그인하지 않은 공개 릴리스 목록과 DMG 다운로드도 별도로 확인했다.

릴리스 태그는 기존 커밋 `f0b4144b6315133585feaa81eb5ae4c3f11394e3`을 기준점으로 삼는다.
빌드에는 아직 커밋되지 않은 변경이 포함돼 있으므로 GitHub 자동 소스 압축본은 이 바이너리의
전체 소스를 재현하지 않는다. 소스 입력 fingerprint와 패키징 스크립트 해시는 공개 provenance에
기록했고, 이 차이를 릴리스 설명에도 명시했다. 로컬 앱 교체와 전체 터미널 복원 실사용 검증은
이 배포 작업에서 수행하지 않았다.

### r42 배포 완료 — 2026-09-16

- [GitHub 공개 릴리스](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.42)
- 배포 파일: `build/release-dmg-20260916-r42/Blabee-0.1.0-arm64-r42.dmg`.
- 설치 자산이 유효하면 강조된 **업데이트** 버튼으로 앱 내부 다운로드·검증을 시작한다.
  설치 자산을 확인하지 못한 경우만 릴리스 페이지를 안내한다.
- 변경 후 관련 Swift 검사 46개 통과. 새 Release 빌드의 입력 해시 일치와 바이너리 내
  새 안내 문구 포함·이전 준비 버튼 문구 제거를 확인했다. r35·r41 런타임 호환 정보를 포함한다.
- Developer ID 서명·Hardened Runtime·타임스탬프, Apple 공증 `Accepted`, stapling,
  DMG와 내부 앱 Gatekeeper `Notarized Developer ID` 확인.
- 공증 제출 ID: `1cb19071-b76b-4833-8677-82f59a3e4380`.
- 최종 SHA-256: `c929f2db5cae70638dd4c436df1a30c2d63ce82a34554c739e957e21723b4145`.
- 공개 정식 최신 릴리스로 게시하고, 로그인 없이 DMG·checksum·`r42-provenance.json`을
  다시 다운로드해 일치를 확인했다. 기존 r41 자산의 ID·체크섬은 유지됐다.
- 소스 태그는 r41과 같은 기존 커밋을 기준으로 하며, 위 소스 압축본 관련 제한은 그대로다.
  현재 설치 앱 교체와 전체 업데이트·터미널 복원 실사용 검증은 이번 배포 범위에 포함하지 않았다.

## 사용 방법과 배포 조건

1. 이 기능이 포함된 Blabee를 `/Applications/Blabee.app`에 처음 한 번 설치한다.
2. 기존 대화를 이어가려면 Codex의 `/status`에 표시된 Session ID를 먼저 확인하고 정상 종료한다.
   Blabee 설정의 **앱 업데이트 → Codex 자동 복원 설정**에 이 ID를 입력하고 원래 프로젝트
   폴더를 선택한다. 새 대화는 ID를 비워 두고 연다.
3. 원래 쓰던 터미널에서 직접 시작하려면 다음 명령을 사용한다. 특정 대화를 바로 이어갈
   때만 정확한 세션 UUID를 `--resume`에 넣는다.

   ```sh
   /Applications/Blabee.app/Contents/MacOS/blabee-coordinator managed-session \
     --cwd /absolute/project/path --resume 00000000-0000-0000-0000-000000000000
   ```

4. **업데이트 확인 → 업데이트**를 누른다. 브라우저를 열지 않고 앱에서 다운로드·검증을
   시작한다. 정상적인 설치 자산이 없는 릴리스에만 **릴리스 페이지 열기**를 대신 표시한다.
   작업·승인이 진행 중이면
   먼저 마치고 다시 준비한다. 종료 대상과 미전송 입력 안내를 확인한 뒤 **종료하고 업데이트**를 누른다.
5. 복원 실패가 표시되면 기존 터미널과 표시된 세션 상태부터 확인한다. 같은 세션을
   반복 실행하거나 writer lock을 지우지 않는다.

관리 세션 안에서 다른 대화로 전환해 주 대화 식별이 모호해진 경우에는 자동 종료를
거부한다. 이어갈 대화의 ID를 확인하고 정상 종료한 뒤 그 ID로 관리 세션을 다시 연다.

Terminal 새 창을 처음 열 때 macOS가 Blabee의 Terminal 제어를 요청할 수 있다.
필요하면 **시스템 설정 → 개인정보 보호 및 보안 → 자동화**에서 허용한다.
권한을 거부하거나 창 열기의 결과가 불확실하면 자동으로 다시 명령을 보내지 않고
오류를 표시한다. 기존 터미널에서 기다리던 관리 세션은 이 새 창 제어를 사용하지 않는다.

GitHub 정식 릴리스에는 공증 완료 후 계산한 checksum을 DMG와 함께 올린다.
예를 들어 빌드 42의 태그는 `blabee-v0.1.0+build.42`, 자산은
`Blabee-0.1.0-arm64-r42.dmg`, `Blabee-0.1.0-arm64-r42.dmg.sha256`이다.
위 버전은 형식 예시이며, 이 문서 자체가 게시·설치 완료를 뜻하지 않는다.
draft/prerelease 또는 자산이 누락된 릴리스는 자동 설치 대상으로 사용하지 않는다.

## 근거

- [Codex 0.154.0 thread unload](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex persistence shutdown](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/handlers.rs)
- [Codex app-server lifecycle](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/lib.rs)
- [Codex 0.155.0 thread unload](https://github.com/openai/codex/blob/rust-v0.155.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex 0.155.1 thread unload](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Codex 0.155.1 persistence shutdown](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/session/handlers.rs)
- [Codex 0.155.1 app-server lifecycle](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/lib.rs)
- [기존 배포용 빌드와 공증](development/RELEASE_DMG_PACKAGING.md)
