# r77 배포 검토 후 수정

검증일: 2026-09-30 Australia/Sydney.

대상은 [r77 배포 검토](../../build/release-public-20260930-r77/RELEASE_REVIEW.md)에서
확인한 서비스 등록 경로, Codex 관리 실행 파일 경로 검사, Claude 연결 안내다.
이 문서는 소스 수정과 격리 회귀 결과를 기록한다. 기존 r77 DMG와 설치 앱은 변경하지 않았다.

## 서비스 등록과 계정 권한

신규 SMAppService 등록 UI와 연결 준비의 등록 fallback을 제거했다. 오래된 화면에서
캡처한 `registerOnboardingService` 호출도 등록하지 않는다. 이 실행 방식에는 앱 소유
credential이 없어 필수 로그인 권한을 전달할 수 없기 때문이다.

이미 등록된 서비스는 사용자가 명시적으로 등록 해제한 뒤 앱 실행형으로 전환한다.
등록 해제 또는 상태 조회만으로 서비스를 재시작하지 않는다. 등록 상태가 unknown이거나
앱 소유 child의 종료가 확인되지 않으면 기존 차단을 유지한다.
Mac 로그인 시 **Blabee 앱**을 여는 설정은 별개이며 그대로 유지한다.

후속 검토에서는 앱 실행형이 이미 enabled 상태로 legacy 등록 때문에 blocked가 된 뒤
등록을 해제하면, 연결 화면이 이미 해제된 등록을 다시 해제하라고 안내하는 경우를 찾았다.
해제 확인 뒤 같은 화면의 기본 버튼을 ‘서비스 다시 시작’으로 바꿨다. 도구 미선택 상태에서도
누를 수 있고, 실행 시 조건을 재검사해 이미 재시작했거나 등록 상태가 바뀐 오래된 호출을
차단한다. 해제·조회 자체는 재시작하지 않으며, 서비스 소유 credential을 얻어도 별도의
서버 계정 권한을 얻기 전에는 선택 실행을 허용하지 않는다.

## Codex 조상 경로 검사

기존 검사는 실행 파일의 모든 조상 디렉터리에 size/mtime/ctime까지 비교했다.
서명 검사 도중 runtime 밖에 무관한 sibling 파일이 생성되어도 `.changed`로 거절하는
현상을 격리 fixture로 재현했다. 직접 영향은 별도 `managed-codex` 및 managed doctor의
full-bundle qualification이며, 일반 Plugin/queue 전체가 같은 문제라는 뜻은 아니다.

모든 열린 조상 FD가 **로컬 APFS**일 때에만 디렉터리의 dev/inode/type/mode/uid/gid를
비교하고, 검사 구간의 rename/delete/revoke/attribute 변경 이력은 kqueue vnode 감시로
확인한다. WRITE/LINK는 무관한 자식 항목 변경과 구분한다. 감시는 검사 동안만 존재하고
성공·실패 모두 FD를 닫는다. 상시 watcher나 자동 재시도는 추가하지 않았다.

각 FD의 stat baseline 전에 감시를 등록하고 EV_RECEIPT를 검사한다. 검증 전후 이벤트,
등록·조회 오류, 중단은 모두 거절한다. APFS가 아니거나 로컬 파일시스템 여부를 확인하지
못하면 기존의 엄격한 메타데이터 비교를 유지한다. leaf 해시·서명·메타데이터,
O_NOFOLLOW와 부모 FD에 대한 named-path 연결 검사는 유지했다.

Apple 문서상 vnode 이벤트 지원은 파일시스템별로 다를 수 있으므로 위 완화를 APFS로
제한했다. [Apple kevent 설명](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kevent.2.html)

실제 임시 APFS 디렉터리에서 무관한 파일 변경은 WRITE, 디렉터리 변경은 WRITE/LINK,
chmod 후 원복은 ATTRIB, rename 후 원복은 RENAME으로 관측했다. 이 검사는 이벤트 종류
확인용이며 성능 측정이나 모든 파일시스템의 보장은 아니다.

## Claude 연결 안내

현재 공개 경로인 MCP·Hook에 맞춰 개발용 Channels 안내를 제거했다.
Claude 창에서 확인할 로그인·프로젝트 신뢰·MCP 연결 승인으로 안내하고,
앱 실행형 서비스의 ‘내부 테스트’ 표시도 제거했다. Claude 브릿지 실행 동작은 변경하지 않았다.

## 변경 파일

- 서비스·상태: `app/coordination/PetViewModel.swift`, `app/service/PetAppService.swift`.
- 연결 문구: `app/coordination/PetClaudeConnection.swift`.
- 화면: `app/ui/settings/PetSettingsView.swift`,
  `app/ui/onboarding/PetConnectionSetupView.swift`, `app/ui/onboarding/PetFirstRunView.swift`.
- 런타임 신뢰: `bridges/codex/swift/runtime/CodexRuntimeBundle.swift`.
- 회귀: `Tests/swift/BlabeePetTests/`의 `CodexRuntimeTrustTests.swift`,
  `PetAppServiceTests.swift`, `PetOnboardingTests.swift`, `PetConnectionSetupIntegrationTests.swift`.
- 문서: `docs/features/PRODUCT_ACCESS.md`, `docs/features/ONE_CLICK_CONNECTION/TECH_SPEC.md`, 이 기록.

## 검증 기록

기존 `npm run test:swift`의 직렬 잠금과 임시 scratch 경로를 사용했다.
로그와 이번 작업 전 기준 사본은 `/private/tmp/blabee-r77-review-fixes-xr6ez8t4/`에 있다.

| 검사 | 결과 |
| --- | --- |
| 관련 Swift 필터 | 291개 통과, `focused-swift.log` |
| 광범위 Swift (`--skip thousandReplayIDs`, 마지막 재시작 안내 보완 전) | 공통 251 + 앱 1,696 = 1,947개 통과, `full-swift.log` |
| 마지막 재시작 안내 보완 후 관련 Swift | 238개 통과, `final-ui-swift.log` |
| 변경 파일 공백·잔여 문구·문서 링크 | 이상 없음 |

Codex 신규 회귀는 정상 대조군과 source/private 부모의 sibling 파일·디렉터리 생성/삭제
5조건을 허용하고, 외부/bin 조상 교체·symlink ABA·권한/ACL 변경 후 원복 등 6조건을 거절한다.
신규 서비스 회귀는 필수 계정 접근 제어와 등록 상태를 함께 검사하며, 새로운 등록·자동
해제·자동 선택이 발생하지 않는지 확인한다.

최종 재시작 보완의 두 검사 함수는 8개 사례를 실행했다. 등록 해제 후 도구 미선택 상태의
재시작, 해제·조회 시 실행 없음, 재시작 후 소유 credential과 계정 허가의 분리, 중복 콜백
거절을 확인했다. 등록이 재등장하거나 unknown이 되는 경우는 화면을 새로고침한 경우와
하지 않은 경우 모두 실행을 거절했다. 위 실행 간 중복된 테스트는 합산하지 않는다.

실제 Keychain 복구, 대량 SQLite receipt benchmark, 실제 패키지 payload, 설치 Codex
검사의 opt-in 4개는 실행하지 않았다. `thousandReplayIDs` 대량 반복도 제외했다.
비 APFS fallback과 kqueue 시스템 호출 실패 분기는 정적으로 검토했으며 실패 주입이나
다른 파일시스템의 실측으로 확인하지 않았다. UI 검사는 fixture 기반이며 설치 화면 수동
검사가 아니다. 테스트용 컴파일 외 배포 빌드·패키징·공증은 수행하지 않았다.

## 배포물과 남은 확인

기존 r77 DMG SHA-256은 아래와 같고 이번 수정 전 값과 일치한다.

`c7042a2053141fe8382b2d671bd730bd0b1bc032b879668a8a2ad4ce45361e89`

따라서 **기존 r77에는 이번 수정이 들어 있지 않다.** 새 배포 번호로 빌드·서명·공증한 뒤
최종 DMG checksum을 다시 계산해야 한다. 이후 새 설치/기존 등록 전환, OAuth 완료,
Codex·Claude 각각 새 카드 선택부터 동일 세션의 실제 실행까지 최소 실사용을 확인한다.

운영 DB·Keychain·인증정보·사용자 세션, 설치 앱, GitHub Release는 변경하지 않았다.
commit·push도 수행하지 않았다. 다른 작업자의 기존 변경은 기준 사본과 분리해서 검토했다.
