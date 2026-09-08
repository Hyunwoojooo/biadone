# 앱 실행형 서비스 안정화 — 내부 테스트

작성일: 2026-09-07
상태: 구현·자동 회귀 및 2026-09-08 build 13의 설치·연결·정상 종료·단일 세션 선택 왕복 검증 완료. Keychain 승인 대기 UX, 메모리 증가 관찰과 다른 Mac 검증은 남음.

## 목적과 선택

`BLB-MACOS-SERVICE-001`의 ad-hoc 앱 자동 시작 오류 때문에 Pet만 열리고
서비스에 연결되지 않는 문제를 내부 테스트에서 분리한다. 사용자가 설정에서
**앱 실행형 서비스 켜기**를 한 번 선택하면 이후 Blabee 앱 실행과 수명을 같이하는
자식 서비스를 사용한다. 기본값은 꺼짐이며 기존 macOS 등록을 자동으로 전환하지 않는다.

이 방식은 로그인 시 항상 상주하는 서비스가 아니다. 메뉴바 패널의 X/바깥 클릭은
화면만 닫고, 메뉴바의 **Blabee 종료**는 앱이 소유한 서비스도 종료한다. 종료는 모드
선택을 지우지 않는다. **앱 실행형 끄기**를 선택해야 다음 실행의 자동 시작도 꺼진다.

이는 SMAppService 서명·실행 제약의 근본 원인이 해결됐다는 뜻이 아니다.
Developer ID·공증 및 clean Mac 로그인 자동 시작 자격은 별도 유지한다.

## 안전 경계

- 실행 파일은 현재 검증된 Blabee 번들의 coordinator 하나이며 shell을 거치지 않는다.
  새 `app-service` 모드는 기존 product service의 고정 경로·설정·서명·저널 규칙을 재사용한다.
- macOS 등록이 enabled/requiresApproval이면 먼저 사용자에게 기존 등록 해제를 안내한다.
  unknown에서는 실행하지 않는다. 어떤 등록도 자동 해제하거나 다시 등록하지 않는다.
- Pet의 singleton과 기존 DB authority/socket owner lease를 유지한다. 이미 실행 중인
  서비스를 자기 자식으로 간주하거나 PID 검색으로 종료하지 않는다.
- 부모만 보유하는 lifetime pipe가 닫히면 자식이 종료한다. 부모의 crash에서도 작동해야 한다.
  정상 종료는 bounded cleanup이며 자식이 종료됐는지 불명확하면 새 프로세스를 시작하지 않는다.
- 시작 완료는 자식이 소켓을 실제 게시한 신호 + runtime identity가 검증된 `get_state`
  snapshot으로 판단한다. 프로세스 spawn/등록 API 성공만으로 준비됨을 표시하지 않는다.
- 재시작·끄기·종료 시 generation이 바뀐다. 이전 요청의 늦은 성공/실패로 새 상태를 덮어쓰지 않는다.
- 기존 Pet polling을 재사용한다. 실패 시 조회 간격을 늘리고 시작/재연결에 상한을 둔다.
  상한 뒤에는 수동 재시작만 허용한다. 카드나 `codex queue`를 자동 재전송하지 않는다.
- 기존 Codex 실행·resume·설치본·셸과 보안 설정, Keychain 무결성 검사는 변경하지 않는다.

## 구현과 자동 검증 기록

- `PetAppService.swift`: 모드 선택, 서비스 상태, 중복 시작 방지, 수동 복구,
  종료 작업 합류, 이전 세대 응답 차단, 실패 시 polling backoff.
- `AppOwnedServiceProcess.swift`와 `main.swift`: 현재 앱과 자식의 runtime identity 대조,
  직접 실행과 소유 PID 정리, 부모 소실 pipe, 독립 종료 watchdog,
  소켓 게시 후 READY 및 제한된 시작 오류 코드 전달.
- `PetApplication.swift` / `PetViewModel.swift` / `PetView.swift`: 앱 시작·종료 연결,
  설정 버튼과 진행 상태, 원인별 한국어 복구 안내, 연결 유실 시 카드 선택 차단.
- 검증일: 2026-09-07. `npm run test:swift` Swift Testing **668개**와 XCTest **5개** 통과.
  새 backend/controller/VM 테스트는 **40개**이며, 전체 회귀에 포함된다.
  선택 실행하는 1,200-event 성능 benchmark는 이번 실행에서 건너뛰었다.
- `npm test`: **360개 통과, 실패·건너뜀 0**. 임시 fixture의 패키징과 기존 Hook/UDS/
  SQLite/Plugin 회귀를 포함하며 설치된 Pet의 실사용을 의미하지 않는다.
- arm64 `blabee-coordinator` release 빌드 및 `git diff --check` 통과.
  이 빌드는 컴파일 검증용이며 `/Applications/Blabee.app`나 DMG를 교체하지 않았다.
- 독립 process/lifecycle QA의 발견 사항을 수정했다. 최종 한정된 소스 검토에는
  미해결 high/medium finding이 없다. 중복 ready 알림과 초기화 오류 유실을 보완하고,
  취소된 종료·재시작 뒤 지연 응답·권한 카드 제거/복구 회귀 테스트를 추가했다.

## 2026-09-08 — build 13 설치본 실사용 검증

### 설치 식별자와 보존 범위

- macOS 26.6.2, arm64. release 빌드를 재실행하고
  `build/app-owned-service-20260908-r13/Blabee.app`을 조립했다.
- 기존 앱 설정에서 macOS 서비스 등록을 명시적으로 해제했고, 등록되지 않음 UI와
  `gui/501/com.biadone.blabee.coordinator` job 부재를 확인했다.
- 구 Pet을 정상 종료한 뒤 번들 전체를 교체했다. build 12 백업은
  `/private/tmp/blabee-before-app-service-r13.7JfSFz/Blabee.app`이며 임시 폴더이므로 영구 보관을 보장하지 않는다.
- `/Applications/Blabee.app`의 `CFBundleVersion=13`, deep/strict ad-hoc 서명과 설치 전후
  실행 파일 SHA-256 일치를 확인했다.
  실행 파일: `8ef87db36b0f3c54ccce286fbe8b0eeea521465fe1e0e12483258993d4667863`.
  Runtime identity: `sha256:f1511716368475d9f0d0e6ab8fec550b6f7d68b4d33d1c7ba12e81f23dd1bd08`.
  Assembly manifest: `sha256:488a41359e189638e3a858121544e21818b1ce073c089d6f6c2106b88b4b712c`.
- build 12의 검증된 identity에 한해 기존 Hook/MCP 호환 정책을 포함했다.
  소스·번들·설치된 Plugin 파일이 동일해 Plugin cache는 다시 쓰지 않았다.
- 공식 Codex, 셸/PATH, 다른 Codex 세션, Keychain 데이터/ACL을 수동 편집하지 않았다.
  macOS가 표시한 Keychain 요청에는 사용자의 승인이 기록됐다. DMG·커밋·푸시는 수행하지 않았다.

### 실제 결과

| 항목 | 판정 | 관측 근거 |
|---|---|---|
| opt-in 및 연결 | 통과, 첫 승인 지연은 별도 이슈 | UI에서 켜기 선택. 첫 시도는 12초 기한 초과, 명시적 재시도에서 사용자 Keychain 승인 후 서비스 연결됨과 identity-bound `get_state` 성공 |
| 패널 X | 통과 | 패널 숨김 뒤 Pet 71044 / 자식 78361 유지, 같은 소켓 응답 성공 |
| 앱 정상 종료 | 통과 | 앱에 정상 종료 AppleEvent 전달 후 두 PID 및 소켓 부재. 다른 Codex 프로세스 종료 명령은 수행하지 않음 |
| 앱 재실행 | 통과 | Pet 80829 / 그 자식 80868 한 쌍 생성, opt-in 유지, 추가 승인 없이 소켓 응답과 연결됨 UI 확인 |
| 새 native Codex 자동 연결 | 통과 | 수정하지 않은 공식 0.153.4의 독립 read-only TUI에서 Hook 경계와 새 session 등록 확인 |
| 카드·선택·반환 | 통과, 단일 세션/권장 1번 | 실제 카드 화면, rank 1 선택 이벤트, 새 사용자 턴, durable claim, 명령 출력/종료 코드 각각 확인 |
| 검증 세션 종료 | 통과 | 테스트 TUI의 `/exit` exit 0, 테스트 Codex·MCP·code-mode-host PID 부재. Blabee 앱/서비스는 계속 실행 |

왕복 session은 `01a07eee-7c03-78b0-9aa4-21d8c3edf846`이다. 첫 턴
`01a07eee-7c9a-7d63-8195-a05c9c0153c7`은 `BLABEE_R13_INITIAL_OK`를 실제로 한 번 출력했다.
이후 다음 증거를 분리해 확인했다. 시각은 UTC다.

1. 저널 1241 `decision_selection_claimed`, 02:55:19: 권장 1번 선택 접수.
2. 저널 1244 `continuation_transport_completed`, 02:55:32: 전달 완료.
   이 이벤트의 `work_outcome_status=not_recorded`를 작업 성공으로 해석하지 않았다.
3. 저널 1246 `queued_action_context_claimed`, 02:55:34: 동일 continuation의 claim 정확히 1개,
   새 delivery turn `01a07ef1-3aff-7e93-aa81-5ea109d4aa92`에 바인딩.
4. 같은 Codex transcript의 `CommandExecution`, 02:55:45:
   `/usr/bin/printf 'BLABEE_R13_RETURN_OK\n'` 정확히 1회, stdout `BLABEE_R13_RETURN_OK`와
  줄바꿈, stderr 없음, exit 0. 02:55:52 새 턴의 최종 답변·완료 기록 확인.

선택 접수부터 명령 완료까지는 약 25.3초였다. 이는 성공 증거지만 즉시 응답이나
응답 시간 자격을 의미하지 않는다. 독립 읽기 전용 QA도 선택/전달/claim 각 1개와
반환 명령 1회, 해당 새 턴의 검증된 Hook 작업 내용을 교차 확인했다.

선택 검증 중 자동화의 마지막 클릭 전 검사는 이미 바뀐 카드 상태를 보고 중단했다.
실제 선택은 그 전에 접수돼 있었다. 따라서 자동화가 버튼을 눌렀다고 주장하지 않고,
실제 rank 1 접수·같은 세션 반환·명령 실행의 일치로 판정한다. 입력이 마우스인지 단축키인지
개별적으로 확정하지 않았고, 확인을 위해 동일 선택을 다시 보내지 않았다.

### 새로 관찰된 주의점

- 첫 시작의 12초 기한 초과는 `SecItemCopyMatching` 대기와 일치했다.
  재시도 자식의 2초 스택 샘플과 securityd의 사용자 승인 기록을 대조했다.
  승인 후 연결은 복구됐지만, 새 ad-hoc 빌드의 첫 Keychain 승인 UX가 해결됐다는 뜻은 아니다.
  비밀번호·Keychain 항목 삭제나 보안 우회로 처리하지 않는다.
- 같은 자식 PID 80868의 RSS가 elapsed 1:40의 174,992 KiB에서 7:34의 528,336 KiB,
  11:28의 680,624 KiB로 증가했다. 짧은 CPU 표본은 0.1%였지만 메모리 누수인지,
  작업/저널 처리 후 유지되는 할당인지 추가 분리가 필요하다. 독립 QA의 11:13~13:05
  약 112초 표본은 RSS 680,640 KiB로 동일했고 CPU 0.1~0.2%였다.
  계속 증가하는 누수로 단정하지 않으며 성능·발열 안정화 완료로도 보고하지 않는다.
- 이 검증은 권한 승인 카드, 다중 세션 FIFO, 자동 팝업의 포커스/화면 전환별 동작,
  메뉴바 오른쪽 클릭 종료 입력, 부모 crash, sleep/wake, 다른 Mac 및 DMG 검증을 대체하지 않는다.
- 기존 Vercel MCP OAuth 경고와 skill 설명 축약 경고도 관찰됐으나 이번 Blabee 왕복은 성공했다.
  관련 계정 설정은 변경하지 않았다.

## 남은 설치본 검증 게이트

현재 `/Applications`의 build 13에 반영됐고, 2026-09-08 r14 DMG의 fresh 빌드·패키징 검증도 완료했다.
이번 DMG 제작 중 설치본은 교체하거나 재시작하지 않았다.
위의 제한된 통과 항목과 다음 잔여 항목을 구분하며 내부 테스터 배포 준비 완료로 보고하지 않는다.

1. 첫 Keychain 승인 지연 상태를 일반 연결 오류와 구분하고 데이터 보존 복구를 검증한다.
2. 메모리 증가를 통제된 유휴/작업 표본으로 재현하고 원인·안정화 수준을 확인한다.
3. 메뉴바 오른쪽 클릭 종료, 부모 강제 종료 시 자식 정리, Keychain 실패와 앱 교체 경쟁을 검증한다.
4. 단일 왕복 외의 FIFO·권한 카드·중단 복구·화면 전환을 각각 검증한다.
5. r14 DMG로 다른 Mac 최초 설치·재실행·업데이트를 검증한다. DMG 제작 완료와
   내부 테스터 배포 자격은 분리한다. 산출물은 [r14 릴리스 기록](INTERNAL_DMG_R14_RELEASE_KO.md)을 따른다.

## 완료 기준

1. 미선택 상태의 앱·설정 열기에는 서비스 시작/등록 mutation이 없다.
2. opt-in 시작과 재실행, 등록 충돌, 중복 클릭, 잘못된 bundle/입력은 명시적으로 처리된다.
3. 정상 준비·시작 실패·연결 유실·기한 만료·수동 복구 상태가 자동 테스트에서 구분된다.
4. 종료/부모 소실 시 소유한 자식만 정리되고 다른 서비스/Codex는 유지된다.
5. 늦은 snapshot·타이머와 종료 중 재시도가 새 인스턴스에 영향을 주지 않는다.
6. 실제 Pet → Codex 단일 카드 왕복의 로컬 통과와 다른 Mac 설치/업데이트 자격을 분리한다.

## 참고

Apple의 [`SMAppService.Status.enabled`](https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/enabled)는
등록돼 실행 자격이 있다는 뜻이며 현재 실행 중이라는 증거가 아니다. 이 계획은 macOS
보안 검사를 해제하지 않고 별도 앱 수명주기에서 동일 제품 서비스를 실행하는 선택이다.
