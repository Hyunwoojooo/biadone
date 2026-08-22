# T-012b-2 제품 서비스 부트스트랩 보고서

업데이트: 2026-08-22
상태: 설치·등록 전 로컬 계약 자격 완료, 공개 자동 시작 미승인

## 결과

`Blabee.app` 안의 단일 `blabee-coordinator`를 제품 서비스로 실행할 수 있는
`service` 모드를 추가했다. 이 모드는 개발용 `daemon`의 임의 경로 인자를 노출하지
않으며 정확한 앱 번들 리소스와 사용자 Application Support의 고정 경로만 사용한다.

```text
Blabee.app/Contents/MacOS/blabee-coordinator service
├─ exact com.biadone.blabee / Blabee.app / executable / Resources 검사
├─ Contents/Resources/Contracts/v1 실제 디렉터리 검사
├─ ~/Library/Application Support/Blabee/config/service.json 읽기
└─ 기존 daemon core
   ├─ storage/coordinator.sqlite3
   ├─ storage/coordinator.key
   └─ runtime/blabee.sock
```

`service`는 추가 인자를 모두 거부한다. DB, key, socket, Contracts 또는 설정 경로를
명령행·`HOME`·`BLABEE_SOCKET`·현재 디렉터리에서 받지 않는다. 개발·시험용
`daemon --database ...` 계약은 그대로 유지한다. 제품 서비스는 Keychain 시험용
환경변수도 상속하지 않고 primary freshness 경계만 사용한다.

## Application Support 설정 계약

설정 파일은 다음 두 키만 허용한다.

```json
{
  "schema_version": "1.0",
  "enabled_projects": [
    "/absolute/project/path"
  ]
}
```

- 설정 디렉터리 또는 파일이 없으면 활성 프로젝트 0개로 해석하며 자동 생성하지 않는다.
- 설정 디렉터리는 현재 사용자 소유의 실제 디렉터리와 mode `0700`이어야 한다.
- 설정 파일은 현재 사용자 소유의 실제 일반 파일과 mode `0600`이어야 한다.
- 파일은 directory descriptor 기준 `openat`, `O_NONBLOCK`, `O_NOFOLLOW`,
  `O_CLOEXEC`으로 열고
  읽기 전후 inode·size·type·owner·mode를 다시 확인한다.
- 최대 크기는 64 KiB, 프로젝트는 최대 256개, 각 UTF-8 경로는 최대 4096 byte다.
- strict JSON, exact key, 버전, 절대 경로를 요구한다. 정규화 뒤 중복은 거부하고
  결과는 UTF-8 byte 순서로 정렬한다.
- 파일이 존재하지만 손상됐거나 권한이 안전하지 않으면 조용히 무시하지 않고
  `product_service_config_invalid` 또는 `product_service_config_unsafe`로 시작을 막는다.

현재 이 설정을 쓰는 제품 UI·원자 updater는 아직 없다. 런타임의 동적
`enable_project`도 재시작 뒤 영속된다고 주장하지 않는다.

## 정적 LaunchAgent 계약

앱 조립기는 다음 파일을 서명 전에 포함한다.

```text
Contents/Library/LaunchAgents/com.biadone.blabee.coordinator.plist
```

plist는 `Label`, `BundleProgram`, `ProgramArguments`, `RunAtLoad` 네 키만 가진다.
실행 대상은 번들 상대 경로 `Contents/MacOS/blabee-coordinator`이고 실제 모드 인자는
두 번째 argv인 `service`다. `Program`, 사용자별 절대 경로, 환경변수, 사용자·그룹
변경 키는 허용하지 않는다.

실제 로그인·오류 수명주기를 검증하기 전 재시작 루프를 만들지 않도록
`RunAtLoad = true`만 사용하고 `KeepAlive`는 넣지 않았다. 이 plist는 앱 안에 있을
뿐 아직 `SMAppService.register()`로 등록되지 않았으므로 자동 시작하지 않는다.
[Apple의 `SMAppService.agent(plistName:)`](https://developer.apple.com/documentation/servicemanagement/smappservice/agent%28plistname%3A%29)가 요구하는 번들 위치에 맞춘 정적 계약이다.

## 검증 결과

- Product service 집중 테스트: 10/10 통과. FIFO를 포함한 특수 파일의 즉시 거부 포함
- Swift `BlabeePetTests` 전체 회귀: 65/65 통과
- `npm run test:t012`: 7/7 통과
- `npm run test:t011`: 23/23 통과
- `npm run test:contracts`: 114/114 통과
- Swift release build: 통과
- 실제 release 바이너리로 임시 `Blabee.app` ad-hoc Hardened Runtime 조립: 통과
- `codesign --verify --deep --strict`: 통과
- LaunchAgent 디렉터리 `0755`, plist `0644`, exact 네 키와 manifest
  hash·size·mode 포함: 통과
- 서명 후 LaunchAgent `RunAtLoad` 변조: codesign이 sealed resource 변경으로 거부
- 번들 내부 Doctor 읽기 전용 검사: app/runtime/embedded coordinator/Plugin layout 통과

실제 `service`는 실행하지 않았다. 따라서 사용자 Application Support, 제품 Keychain,
socket 또는 daemon 상태를 만들거나 바꾸지 않았다. `SMAppService`, `launchctl`,
`/Applications`, PATH, shell 설정도 변경하지 않았다.

## 남은 경계

- 실제 `SMAppService` 등록·해제와 System Settings 승인 상태
- 로그인·로그아웃, crash, sleep, 앱 이동·업데이트 시 수명주기
- `KeepAlive` 또는 on-demand socket activation 정책
- 설정을 안전하게 쓰는 onboarding/UI와 안정적인 project identity
- signed Data Protection Keychain/access group과 prompt 동작
- Developer ID, 공증, Gatekeeper, DMG, updater, 터미널 매트릭스
- Application Support 상위 경로 전체의 descriptor 단위 traversal과 같은 UID의
  동시 파일 변경에 대한 더 강한 hardening

실제 등록과 제품 Keychain을 처음 실행하는 단계는 시스템 상태를 바꾸거나 암호
요청을 띄울 수 있으므로 별도의 사용자 동의를 받은 뒤 수행한다.
