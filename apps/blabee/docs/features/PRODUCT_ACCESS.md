# 로그인 필수 및 원격 사용 제어

2026-09-27 소스 구현과 운영 Supabase 적용, r75 공개 배포를 완료했다. 현재 PC의 설치 앱 교체는 별도다.
관리자 지정·계정 정지·전체 중지 방법은 [관리자 운영 문서](ACCESS_CONTROL_ADMIN.md)를 따른다.

## 동작

- Google/GitHub 소셜 로그인과 서버의 `active` 응답이 있어야 새 Blabee 카드·선택·승인·작업 전달·claim을 처리한다.
- 계정 정지와 전체 서비스 중지는 별개다. 전체 재개가 개별 정지를 풀지 않는다.
- 공통 서비스가 60초 간격으로 직접 HTTPS 조회한다. 일시적인 통신 실패만 마지막 허가의 원래 만료까지 허용한다. 최대 300초이며 JWT·Auth 세션이 먼저 만료되면 더 짧다.
- 새 서비스에는 허가가 없다. 디스크의 플래그, 온보딩 완료 여부, UI가 보내는 허용 값으로 권한을 복구하지 않는다.
- 명시적인 로그아웃은 UI를 즉시 잠그고 서비스에 `clear`를 보낸다. 진행 중인 로컬 요청이 있으면 해당 요청 종료/제한시간 뒤 전송한다. 서비스가 거절을 확인하면 기존 허가는 즉시 제거된다.
- 원격 중지는 정상 연결에서 다음 서버 확인 때 반영된다. 오프라인 Mac을 즉시 차단하는 방식은 아니며 기존 허가도 5분을 넘겨 연장하지 않는다.
- 이미 시작한 Codex/Claude 작업을 종료하지 않는다. 완료·전달 확인·정리는 계속 받는다. 아직 답하지 않은 Codex 승인 요청은 다음 정리/상태 확인 때 기본 승인 화면으로 돌려준다.
- 로그아웃·계정 전환·권한 만료·정지를 건넌 이전 카드는 새 권한으로 실행하지 않는다. 실패하거나 불확실한 작업은 자동 재전송하지 않는다.
- 첫 온보딩 완료 기록은 유지한다. 이후 로그인/권한 차단 화면은 별도이며 설정과 진단을 열 수 있다.

### 서비스 실행 방식

로그인 권한 전달은 Blabee 앱이 직접 시작한 서비스의 소유 credential에 결합한다.
기존 `SMAppService`의 `service` 실행 경로는 이 credential을 만들지 않으므로,
제품 화면에서 새 macOS 자동 시작 서비스를 등록하지 않는다. 과거에 등록한 사용자는
설정에서 등록을 명시적으로 해제한 뒤 앱 실행형 서비스를 켜거나 다시 시작한다.
등록 상태가 확인되지 않거나 이전 서비스의 종료가 불명확하면 새 실행을 허용하지 않는다.
자동 등록 해제·서비스 채택·계정 권한 검사 우회는 하지 않는다.

macOS 로그인 시 Blabee 앱을 여는 ‘로그인 시 시작’ 설정은 별개이며 유지한다.

## 권한 소유와 시간

`ProductAccessController`가 공통 서비스 메모리에서 허가를 소유한다. HTTPS 작업은 Coordinator actor와 Claude registry의 직렬 작업 밖에서 실행한다. 실행 경로는 짧은 메모리 검사만 한다. 기존 Engine journal의 MAC·freshness·revision·단일 claim·세션 결합 검사는 그대로 유지한다.

서버 nonce·사용자 UUID·세션 UUID 형식·상태·시간 범위를 검사한다. 서버 응답의 만료와 서버 시간 차이를 요청 시작 당시의 `mach_continuous_time`에 더한다. Mac의 벽시계를 늦추거나 잠자기에서 복귀해도 허가가 늘어나지 않는다. 요청 5초, 리소스 6초 제한, 응답 16 KiB 제한을 두며 리다이렉트·캐시·쿠키를 사용하지 않는다. HTTP 401/403은 명시적 거절, 429/5xx와 통신 실패는 갱신 없는 일시 실패, 잘못된 성공 응답은 차단이다.

서버 요청 epoch와 작업 권한 generation을 구분한다. 동일 계정의 정상 토큰 갱신은 유효한 작업 권한을 유지할 수 있지만, 로그아웃·거절·만료·계정 전환은 generation을 바꾼다. 만료를 지나 도착한 새 허가도 이전 작업의 generation을 복원하지 않는다. Codex는 실제 queue 명령 직전과 Hook claim 응답 직전에 재검사한다. Claude는 카드 생성, 선택, Hook 전달, claim 응답에 같은 권한을 결합한다.

클라우드 계정과 권한 데이터는 Coordinator SQLite에 저장하지 않는다. refresh token은 앱의 기존 계정 저장소 밖으로 전달하지 않는다. access token은 소유 앱의 capability로 인증한 로컬 요청에만 담고 응답·로그·journal에 넣지 않는다.

## 내부 IPC 계약

요청 종류는 `product_access_v1`이다. 최상위 payload는 다음 필드만 허용한다.

```json
{
  "schema_version": 1,
  "request_id": "소문자 UUID",
  "auth_token": "소유 앱의 64자리 hex capability",
  "operation": "update",
  "revision": 1,
  "payload": {"user_id": "소문자 UUID", "access_token": "현재 access JWT"}
}
```

`operation`은 `update`, `clear`, `status`, `refresh`다. `update`만 위 두 필드를 받으며 나머지는 빈 object를 받는다. `revision`은 1 이상의 정수다. 변경은 증가하는 revision만 받고, 같은 토큰의 정확한 `update` 재시도와 이미 지운 `clear` 재시도는 멱등적이다. `status`는 revision을 변경하지 않고, `refresh`는 서비스의 현재 revision과 일치해야 한다.

응답 필드는 `schema_version`, `request_id`, `revision`, `service_generation`, `state`, `user_id`, `remaining_seconds`다. 초기 서비스 revision은 0이며 `service_generation`은 서비스 인스턴스 UUID다. `state`는 `signed_out`, `checking`, `active`, `suspended`, `service_paused`, `social_login_required`, `unavailable`, `expired` 중 하나다. `user_id`는 UUID 또는 null, 남은 시간은 0…300초다. 토큰은 반환하지 않는다.

UI는 단일 poll 루프를 사용한다(확인 중 1초, 안정 상태 5초). 응답의 request ID, revision, service generation, 사용자, 현재 소유 capability, UI generation을 확인한다. 늦은 응답은 로그인이나 카드 선택을 되살리지 않는다. 서비스 health/온보딩 조회는 작업 실행 권한과 구분한다.

## 검증과 배포 순서

- 격리 SQL: `npm run test:access-sql`. PGlite의 합성 Auth schema/세션으로 RLS, 관리자 제한, 원자적 감사 기록, 만료, 중지·재개를 검사한다.
- Swift: 기존 `npm run test:swift` 직렬 잠금에서 ProductAccess/PetAccess/계정 및 Operational 관련 필터를 실행한다. 네트워크·계정·clock은 합성 구현을 주입한다.
- Claude: `Tests/bridges/claude/shared-engine` 테스트도 같은 Swift 잠금으로 직렬 실행한다. `ClaudeProductAccessIntegrationTests`는 메모리 저장소와 임시 파일만 사용한다.

후속 운영 검증은 실제 OAuth 갱신의 AMR, Supabase Auth schema와 HTTP 오류 매핑, 관리자 계정 지정, 계정/전체 중지·재개, 오프라인 5분·잠자기·재실행을 포함한다. 소스·격리 테스트 통과가 운영 적용 또는 설치 앱 동작을 의미하지 않는다. 이 기능이 없는 기존 배포 앱은 원격 차단되지 않으므로 새 앱을 배포해야 한다.

## 이번 변경의 검증 기록

- 앱·공통 서비스·Codex 관련 선택 실행: Swift 157개 통과(공통 21개, 앱 136개).
- Claude 접근 제어·기존 세션·저장 권한·수명 관련 선택 실행: Swift 72개 통과.
- PGlite SQL suite 통과: 검증 그룹 16개, 관리자 운영 SQL 예제 6개 실행.
- 대상 파일 `git diff --check` 통과.
- 기존 Claude 테스트가 임의 nonce의 첫 글자에 따라 가짜 Hook credential을 잘못된 nonce로 골라 다른 오류를 검증하던 경우를 수정했다. 비밀값 반사 차단 코드는 완화하지 않았다.
- 장시간 스트레스 3개(`thousandPrompts`, `fiveHundredCycles`, `hundredThousandPollsAreReadOnly`)는 제외했다. 첫 광범위 실행은 장시간 반복을 중단한 뒤 범위를 제한해 다시 실행했다.
- 테스트용 컴파일만 수행했다. 운영 DB·Keychain·사용자 세션 변경, 설치 앱 재시작/교체, 배포용 빌드·패키징·공증, commit·push는 수행하지 않았다.

실행 로그는 `/private/tmp/blabee-access-20260927-TnAAAn/`의 `access-swift-final.log`, `claude-access-verified.log`, `access-sql.log`에 있다. 이 경로는 임시 검증 산출물이다.

주요 수정 위치는 `app/account/{ProductAccess,PetAccessController,PetAccessView,PetAccountController}.swift`, `app/service/ProductAccessService.swift`, `app/coordination/{CoordinatorOperationalApplication,PetViewModel}.swift`, `app/entrypoints/main.swift`, 공통 Pet 화면·패널, Codex 실제 전달 직전 검사, Claude native/legacy ingress·registry·service 조립이다. 새 DB migration은 `supabase/migrations/202609270001_blabee_access_control.sql`이며 Engine 저장 schema는 변경하지 않았다.

## 후속 운영·배포 확인

위 초기 소스 검증 이후 사용자의 배포 요청에 따라 운영 migration과 소유자 관리자 지정을 적용했다. 실제 제품의 OAuth·PKCE·HTTP·권한 응답 검사 코드를 재사용한 일회성 앱으로 Google 로그인, refresh, active→suspended→active, 관리자 전체 상태 유지 호출, 검사 세션 local logout, 이전 JWT의 403 거절을 확인했다. 기존 Keychain과 설치 앱의 로그인 세션은 읽거나 변경하지 않았다.

[r75 공개 릴리스](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.75)는 새 Release 빌드, 앱·Node·DMG Developer ID 서명, Apple Accepted, stapling 및 Gatekeeper 검사를 통과했다. GitHub 재다운로드의 SHA-256이 공증 후 원본과 일치하고, 앱이 조회하는 공개 릴리스 목록의 최대 빌드가 75임을 확인했다. 기존 회귀 검사 229개와 SQL 검증을 재사용했으며 장시간 반복 검사는 추가하지 않았다.

실제 설치 앱 화면의 로그인·선택 전환, 오프라인·잠자기, GitHub OAuth 실로그인, 다른 Mac/VM의 새 설치는 이번 배포 검증에 포함하지 않았다. 소스 commit·push와 현재 PC의 설치 앱 교체도 수행하지 않았다. 배포 로그와 검증 경계는 `build/release-public-20260927-r75/VALIDATION.md`에 기록한다.
