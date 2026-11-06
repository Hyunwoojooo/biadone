# VM 없이 별도 macOS 사용자로 P1 준비하기

점검일: 2026-09-27 Asia/Singapore (2026-09-26 16:21 UTC부터).

**판정: 별도 표준 사용자 계정은 조건부 대안으로 준비할 수 있다. 실제 실행 준비 완료는 아니다.**
현재 일반 계정은 `joo`(UID 501) 하나이며 새 계정의 로그인 환경은 아직 관측하지 않았다.
이번에는 시스템·파일 메타데이터와 소스만 점검했다. 계정 생성·전환, 설치, Claude 실행·인증,
모델 호출, 앱·서비스 재시작, 운영 DB·Keychain·인증정보 변경은 하지 않았다.
제품 코드와 기존 P1 도구는 변경하지 않고 이 안내 문서만 추가했다.

이 절차의 목적은 **5초 Hook 이후 같은 테스트 Claude 세션의 반응을 관측**하는 것이다.
깨끗한 Mac의 Blabee 첫 설치·Gatekeeper 검사, 실제 선택 작업 실행, 공개 배포 적합성까지
통과한 것으로 판단하지 않는다. 기존 VM 안내는 [ISOLATED_RUNBOOK.md](ISOLATED_RUNBOOK.md)에 있다.

## 1. 이번에 확인한 사실

| 항목 | 확인 결과 | 해석 범위 |
| --- | --- | --- |
| 호스트 | macOS 27.0, build 26A428 | 새 OS 다운로드 없이 현재 OS의 별도 계정 사용 가능 |
| 일반 로컬 사용자 | `joo`, UID 501 한 개 | 테스트 계정은 아직 없음 |
| 현재 PATH의 `claude` | `~/Library/Application Support/Blabee/shell/claude-v1/bin/claude` | wrapper 내용은 설치 coordinator의 `claude-auto-launch`를 호출함. 실험 실행 경로로 사용하지 않음 |
| 설치 Blabee | `/Applications/Blabee.app`, 0.1.0 / build 71 | 디스크의 Info.plist 관측값. 실행 중 프로세스나 현재 소스와 같은 빌드라고 추정하지 않음 |
| 관련 실행 프로세스 | 관측한 Blabee·Claude·Codex 실행 파일의 UID는 모두 501 | 명령 인자·환경값은 수집하지 않음. 이름이 다른 프로세스·모든 IPC가 조사됐다는 뜻은 아님 |
| 실행 중 Claude CLI | `~/.local/share/claude/versions/2.1.281` 경로가 관측됨 | 기존 세션은 그대로 유지. P1 후보 2.1.282 파일과 별개 |
| Blabee 사용자 디렉터리 | Application Support의 Blabee·runtime·shell 경로는 UID 501, mode 0700 | 다른 UID에 일반 파일 권한으로 열리지 않음. DB·키 내용은 읽지 않음 |
| 전역 Claude 파일 정책 | 아래 세 경로 미존재 | 파일 정책만 확인한 결과이며 계정의 원격 정책·플러그인을 배제하지 않음 |
| 장치 관리 | `profiles status -type enrollment`: DEP No / MDM No | 등록 상태 조회. 모든 로컬 프로파일이나 원격 계정 정책을 열람한 것은 아님 |
| 전역 셸 초기화 | 확인한 파일에서 Blabee·Claude 자동 연결 경로 미발견 | 새 계정의 실제 PATH·Hook 목록은 이후 별도 확인 |

확인한 전역 Claude 파일 정책 경로:

- `/Library/Application Support/ClaudeCode/managed-settings.json`
- `/Library/Application Support/ClaudeCode/managed-settings.d`
- `/Library/Application Support/ClaudeCode/managed-mcp.json`

`com.anthropic.claudecode` 관련 Managed Preferences/Preferences의 알려진 후보 경로도 없었다.
하지만 MDM 정책은 특정 plist 파일 하나의 부재로 판정하지 않는다.
공식 관리 도메인과 적용 우선순위는 [Claude 관리 설정](https://code.claude.com/docs/en/managed-settings)에 따른다.

전역 서비스 점검 범위는 `/Library/LaunchAgents`, `/Library/LaunchDaemons`, 현재 사용자의
`~/Library/LaunchAgents`, 설치 앱 내부 LaunchAgents/LaunchDaemons다.
일반 plist의 Label·실행 경로에서 관련 항목을 찾았고 설정·환경값은 출력하지 않았다.
두 Wizvera symlink는 링크 목적지만 확인했고, Canva plist 한 개는 파싱되지 않았다.
따라서 전체 전역 서비스가 완전히 분리됐다고 판정하지 않는다.

설치 앱 내부에는 `com.biadone.blabee.coordinator` LaunchAgent가 있었으며 LaunchDaemon 디렉터리는 없었다.
해당 label을 gui/501·user/501·system에서 조회한 샌드박스 명령은 113을 반환했다.
이를 서비스가 꺼졌다는 증거로 사용하지 않는다. 실제 coordinator 프로세스는 관측됐다.

셸 점검은 `/etc/zprofile`, `/etc/zshrc`, `/etc/profile`, `/etc/bashrc`,
`/etc/zshrc_Apple_Terminal`, `/etc/paths.d` 및 관련 초기화 파일 존재 여부에 한정했다.
`ZDOTDIR`는 기본 홈 경로 선택에 사용됐고, `10-cryptex`의 `codex.system` 문자열은
Apple cryptex 경로였다. 이를 OpenAI Codex 자동 연결로 분류하지 않았다.

## 2. 계정 분리를 뒷받침하는 소스 근거

현재 작업 소스에는 다음 조건이 있다. **설치 build 71의 모든 동작을 실증한 결과는 아니다.**

- [ClaudeAutoConnectSetup.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift):
  자동 연결 설정은 현재 사용자 홈을 기준으로 만든다.
- [ProductServiceConfiguration.swift](../../../app/service/product-support/ProductServiceConfiguration.swift):
  서비스 데이터 경로는 사용자 Application Support를 사용하며 디렉터리 소유 UID·0700 권한을 검사한다.
- [UnixDomainSocketTransport.swift](../../../app/service/UnixDomainSocketTransport.swift):
  공통 transport의 서버·클라이언트 경로는 상대 UID와 현재 effective UID가 같은지 확인한다.
- [PetOnboarding.swift](../../../app/ui/onboarding/PetOnboarding.swift):
  등록 경로는 `SMAppService.agent`다.

이 근거는 별도 계정을 사용할 이유가 되지만 완전한 보안 격리나 모든 Claude 통신 경로의
검증을 의미하지 않는다. 실험은 설치 coordinator를 호출하지 않는 독립 경로로 구성한다.

## 3. 재사용할 수 있는 파일

**재사용 후보는 실행 파일의 검증된 복사본과 P1 소스뿐이다. 사용자 설정·세션·인증정보는 제외한다.**

| 파일 | 점검 결과 | 사용 방식 |
| --- | --- | --- |
| `/Users/joo/.local/share/claude/versions/2.1.282` | arm64, 222245312 bytes, 아래 SHA-256. 기존 공식 manifest 대조 기록과 일치 | 새 계정 소유의 전용 bin 디렉터리로 일반 파일 복사 후 다시 검증 |
| `/Users/joo/.hermes/node/bin/node` | arm64, Node v22.23.2, 112937728 bytes, 아래 SHA-256 | 새 계정 소유의 전용 bin 디렉터리로 일반 파일 복사 후 다시 검증 |
| 이 디렉터리의 P1 소스·문서 | 런타임·설정·테스트 6개 파일 해시가 이전 검사 기록과 같음 | 새 계정 홈 안으로 파일 복사. 원래 저장소를 작업 폴더로 사용하지 않음 |

두 실행 파일의 `codesign --verify --strict`는 샌드박스 밖의 읽기 전용 재검증에서 종료 코드 0이었다.
샌드박스 안에서는 둘 다 invalid signature를 반환했으므로 그 결과만으로 파일 손상이라고 판단하지 않았다.
`otool -L`에 표시된 의존성은 시스템 라이브러리뿐이었다. 이는 복사 후 실제 실행 가능성이나
Gatekeeper 판정, 새 계정의 Claude 옵션 지원까지 보장하는 검사는 아니다.
Claude는 실행하지 않았고 Node만 `--version`으로 버전을 확인했다.

```text
Claude 2.1.282 SHA-256
fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4

Node v22.23.2 SHA-256
18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572
```

Claude 해시는 [기존 공식 manifest 대조 기록](ISOLATED_RUNBOOK.md)을 재사용했다.
이번에는 로컬 파일 해시와 코드 서명을 확인했으며 manifest를 다시 내려받지는 않았다.
Node 해시는 이번 로컬 복사 동일성 기준이며 새로 공식 배포 manifest에 대조한 결과는 아니다.

두 파일은 합계 약 335MB다. 복사해 재사용하면 macOS 이미지와 런타임을 새로 다운로드하지 않아도 된다.
다만 향후 Claude 로그인·모델 응답에는 인터넷이 필요하다.
Node 원본의 상위 `.hermes` 디렉터리는 0700이므로 새 계정에서 원본 경로를 그대로 실행하려 하지 않는다.
원본 홈의 권한을 넓히거나 기존 설치를 다른 소유자로 바꾸지 않는다.

## 4. 사용자가 준비할 단계

아래 단계는 **아직 수행하지 않았다.** 계정 생성에 필요한 관리자 인증과 Claude 로그인은 사용자가 직접 한다.

1. **시스템 설정 → 사용자 및 그룹 → 사용자 추가**에서 `blabeep1` 같은 표준 계정을 만든다.
   기존 사용자 복제·마이그레이션은 하지 않는다. Apple Account/iCloud 로그인은 이 실험에 필요하지 않다.
   [Apple 사용자 추가 안내](https://support.apple.com/guide/mac-help/add-a-user-or-group-mchl3e281fc9/mac)
2. 기존 `joo` 계정은 로그인된 상태로 두고 **빠른 사용자 전환**으로 새 계정에 로그인한다.
   기존 세션을 종료할 필요는 없다. 두 계정의 프로세스는 동시에 자원을 사용할 수 있으므로
   이 환경의 지연을 깨끗한 Mac 성능 수치로 일반화하지 않는다.
   [Apple 빠른 사용자 전환](https://support.apple.com/guide/mac-help/switch-quickly-between-users-mchlp2439/mac)
3. 새 계정에서는 설치된 Blabee를 열거나 자동 연결 설정을 켜지 않는다.
   기존 `.claude`, `.claude.json`, `.codex`, 셸 설정, Keychain, 운영 DB를 복사하지 않는다.
4. 후속 파일 준비 단계에서 위 두 실행 파일과 P1 소스·문서만 전달한다.
   전송용 폴더를 썼다면 새 계정 홈 내부로 복사한 파일을 사용하고 외부 경로에 링크하지 않는다.
   대상 계정 소유의 `~/blabee-p1/bin`, `~/blabee-p1/tools`, `~/blabee-p1/runs`를 사용한다.
   원본과 복사본 SHA-256, 코드 서명, 소유 UID·디렉터리 권한을 재확인한다.
5. 새 계정의 Terminal에서 사용자 UID·홈·실행 경로와 적용 정책을 확인한다.
   Blabee wrapper 대신 `~/blabee-p1/bin/claude-2.1.282`의 절대 경로를 사용할 계획으로 준비한다.
   `sudo -u`나 `HOME` 바꾸기만으로 실제 사용자 전환을 대신하지 않는다.
6. 실제 실험을 진행하는 후속 단계에서 사용자 본인이 Claude에 새로 로그인한다.
   별도 유료 계정 구매를 요구하지 않는다. 같은 Claude 계정을 사용하더라도 서버 정책과
   동기화 플러그인이 들어올 수 있으므로 목록을 확인한다. 호스트 인증파일을 복사하지 않는다.
7. 새 계정 안에서 모델 없는 P1 검사를 먼저 수행하고 이후 세 대조군을 각각 새 run·새 세션으로 관측한다.
   이때 기존 [실행 절차](ISOLATED_RUNBOOK.md)의 경로를 새 계정의 실제 경로로 맞춘다.
   기존 VM용 예시의 호스트 경로·placeholder를 그대로 실행하지 않는다.

계정 추가 이후에 필요한 명령은 실제 계정명·경로를 확인한 뒤 준비한다.
이 문서는 계정이나 프로그램을 자동으로 만들거나 실행하지 않는다.

## 5. 새 계정에서 남아 있는 확인

| 조건 | 현재 상태 | 이후 확인할 것 |
| --- | --- | --- |
| 실제 UID·홈·프로젝트 분리 | 미확인 | 새 GUI 로그인 사용자 UID, 새 홈, 새 빈 project, 현재 계정의 설정 경로를 참조하지 않는지 |
| 도구 복사와 권한 | 미수행 | 복사본 hash·서명·UID·권한, 검증된 Node 절대 경로 |
| 실제 CLI 버전·옵션 | 미실행 | 정확히 2.1.282인지, 생성한 설정·도구 제한·MCP 제한이 적용되는지 |
| 계정 정책·동기화 플러그인 | 미확인 | 실험과 충돌하거나 기존 Blabee를 호출하는 Hook·MCP·필수 플러그인이 없는지 |
| 첫 세션과 Hook 입력 | 미관측 | fresh SessionStart, 실제 prompt_id, background/cron 목록, 같은 세션의 단회 wake |
| 세 대조군 A/B/C | 미실행 | `async-exit0`, `rewake-exit0`, `rewake-exit2`를 순차 실행해 반응·오류 UI 기록 |

관리 정책이 존재한다는 이유만으로 실패로 판단하지 않는다. 실험과 충돌하는 설정이 있으면
정책을 삭제·우회하지 않고 충돌을 기록한다. 예를 들어 `managed-mcp.json` 때문에 계획한
`--strict-mcp-config` 조합이 거절되면 그 환경에서 해당 실행 경로를 중단한다.
[관리 MCP](https://code.claude.com/docs/en/managed-mcp#servers-passed-with-mcp-config-or-strict-mcp-config)

실행이 허용된 후에는 `/status`의 설정 출처와 `/plugin`의 실제 플러그인 목록 등을 확인한다.
계정 동기화 플러그인은 로컬 설치 목록이 비어 있어도 Hook·MCP를 제공할 수 있다.
[정책 적용 확인](https://code.claude.com/docs/en/managed-settings#check-that-a-policy-is-in-force),
[계정 플러그인](https://code.claude.com/docs/en/plugins/loading#plugins-synced-from-claude-ai)

`--settings` 병합, `--setting-sources ""`, `--tools ""`, `--strict-mcp-config`만으로 모든 설정이
분리됐다고 판단하지 않는다. 기존 세션 재개·개발 Channels·권한 우회·임의 작업 실행은 P1 범위에 없다.
현재 [39개 검사 기록](RESULTS.md)은 이전 모델 없는 검사 결과이며 이번 준비 점검에서 재실행하지 않았다.
실제 Claude P1 상태는 계속 **NOT_RUN**, 기록기의 native 판정은 **NOT_EVALUATED**다.

## 6. 이번 검사와 변경 범위

- 읽기 전용: OS·일반 계정 목록·MDM 등록 상태, 관련 프로세스 실행 파일명과 UID,
  정책 파일 존재 여부, launchd plist의 제한된 메타데이터, 전역 셸 경로, 공개 소스.
- 재사용 후보: 파일 크기·SHA-256·시스템 라이브러리 의존성·코드 서명, Node 버전.
- `ps`와 `dscl`의 샌드박스 제한은 승인된 읽기 전용 재조회로 구분했다.
- 이 문서의 로컬 링크·UTF-8·공백을 확인했다. 제품/P1 소스 변경 및 테스트·빌드는 수행하지 않았다.
- 사용자 계정·앱·설정·세션·DB·Keychain·인증정보는 변경하지 않았다. commit·push도 하지 않았다.
