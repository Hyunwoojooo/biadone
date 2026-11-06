# P1 격리 환경 준비와 실제 관측 절차

확인 시각: 2026-09-26 15:50 UTC. **준비 상태 확인 완료 / native 실행 환경 미준비 / Claude 실행 NOT_RUN**.

이번 작업은 호스트의 공개 설치 메타데이터와 도구 소스를 읽고 문서·실행 예시를 검사했다.
사용자·VM 생성, 바이너리 다운로드·설치, Claude 실행·인증, 모델 호출, 기존 앱·세션·DB·Keychain 변경은 하지 않았다.
아래 설치·실행 명령은 **새 격리 환경을 준비한 뒤 별도의 실제 관측 단계에서만** 실행한다.

## 1. 현재 확인한 상태

| 항목 | 관측값 | 의미 |
| --- | --- | --- |
| 호스트 | macOS 27.0, 26A428, arm64 | 게스트 OS 값은 별도로 기록해야 함 |
| 일반 로컬 사용자 | UID 501 계정 한 개 | 별도 테스트 사용자는 없음. 디렉터리 서비스 읽기만 수행 |
| VM | 확인한 앱·CLI·저장 위치에서 미발견 | 모든 디스크·원격 VM을 조사한 것은 아님 |
| 현재 `claude` 명령 | Blabee의 `shell/claude-v1/bin/claude` | 설치 coordinator의 `claude-auto-launch`를 호출하므로 실험에 사용하지 않음 |
| native 파일 | `~/.local/share/claude/versions/2.1.282`, arm64, 222245312 bytes | 실행 없이 경로·형식·해시 확인 |
| 공식 manifest 대조 | 아래 SHA-256 일치 | 파일 일치 증거이며 실제 Hook 지원·동작 검증은 아님 |
| Hook용 Node | v22.23.2, arm64 | Node의 버전 출력만 실행. 게스트에 별도 준비 필요 |
| 전역 Claude 설정 파일 | 확인한 세 경로에 없음 | MDM·서버 정책·계정 플러그인이 없다는 증거는 아님 |
| 테스트 계정·게스트 도구 제한 | 미확인 | 계정이나 인증정보를 읽지 않음 |

VM 조사 범위는 `/Applications`와 `~/Applications`의 UTM, Parallels Desktop, VMware Fusion,
VirtualBox, VirtualBuddy, Viable 및 PATH의 tart/prlctl/utmctl,
`~/.tart/vms`, `~/Virtual Machines.localized`, `~/Parallels`, `~/Documents/Parallels`,
`/Users/Shared/Parallels`다. 전역 설정은 `/Library/Application Support/ClaudeCode/`의
`managed-settings.json`, `managed-mcp.json`, `managed-settings.d` 존재 여부만 확인했다.

고정할 첫 후보는 **Claude Code 2.1.282 / darwin-arm64**다. `latest`나 `stable`을 대신 쓰지 않는다.

```text
SHA-256: fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4
size: 222245312 bytes
official buildDate: 2026-09-24T04:11:54Z
official commit: 88e628ac87357ab077f78e21f78aee6156f01ab3
```

근거: [공식 manifest](https://downloads.claude.ai/claude-code-releases/2.1.282/manifest.json),
[공식 arm64 파일](https://downloads.claude.ai/claude-code-releases/2.1.282/darwin-arm64/claude).
manifest와 파일 URL의 HEAD는 확인했지만 바이너리를 내려받거나 GPG·Gatekeeper 검증을 수행하지 않았다.

## 2. 사용자 쪽에서 필요한 준비

**현재 설치 앱과 전역 서비스까지 분리하기 위해 새 macOS VM을 권장한다.**
별도 표준 사용자는 홈·로그인 세션 분리에 유용하지만 `/Applications`, `/Library`의 앱·정책·서비스를
공유하므로 그것만으로 이 실험의 분리가 완료됐다고 판단하지 않는다.

1. 예를 들어 UTM의 새 VM에서 `Virtualize → macOS`를 선택하고 호환되는 macOS를 새로 설치한다.
   설치 이미지·게스트 OS 버전을 기록한다. 이 Mac에서 해당 VM 앱과 게스트의 실제 호환성은 아직 확인하지 않았다.
2. 기존 Mac 복원·마이그레이션, 전체 홈 공유, iCloud Keychain 동기화, 공유 클립보드를 사용하지 않는다.
   Blabee 앱·로그인 항목·서비스는 게스트에 설치하지 않는다.
3. `blabeep1` 같은 전용 로컬 계정을 준비한다. 관리자 인증이 필요한 VM 설치·계정 생성은 사용자가 직접 처리한다.
4. 이 P1 디렉터리의 소스와 문서만 게스트로 복사한다. 저장소 전체, `.claude`, `.codex`, 인증파일,
   운영 데이터는 복사하지 않는다. 전송용 공유폴더를 썼다면 실험 전에 분리하고 게스트 내부 복사본만 사용한다.
5. Claude 인증은 나중에 허용된 테스트 계정으로 새로 진행한다. 호스트의 인증정보를 복사하지 않는다.
   같은 조직 계정의 관리 정책·플러그인이 들어올 수 있으므로 새 VM만으로 이 부분을 확인한 것으로 간주하지 않는다.

UTM 절차와 공유 기능은 [UTM macOS 문서](https://docs.getutm.app/guest-support/macos/)에 근거한다.
표준 사용자 대안을 선택할 경우 [Apple 사용자 추가 절차](https://support.apple.com/guide/mac-help/add-a-user-or-group-mchl3e281fc9/mac)를 따르되,
공유 전역 환경에 대한 추가 확인이 끝날 때까지 native 실험을 시작하지 않는다.

## 3. 다음 단계에서의 도구 준비

아래 예시는 **게스트의 전용 계정에서만**, 경로가 아직 없을 때 사용한다. 지금 실행하지 않았다.
Node v22.23.2 arm64는 게스트에 별도로 준비한다. 다른 Node 버전을 쓰면 모델 없는 검사를 다시 수행한다.

```sh
P1_ROOT="$HOME/blabee-p1"
(
  set -eu
  umask 077
  mkdir -m 700 "$P1_ROOT"
  mkdir -m 700 "$P1_ROOT/bin" "$P1_ROOT/runs"
)
```

어느 블록에서든 오류가 나면 이후 블록을 실행하지 않는다. 기존 run을 재사용하거나 덮어쓰지 않는다.
P1 소스·문서는 `$P1_ROOT/tools/`에 복사한다. 아래 명령은 파일만 받으며 실행하지 않는다.
일반 `install.sh`는 고정 버전을 인수로 줘도 최신 bootstrap 바이너리를 실행하는 경로가 있어 여기서는 쓰지 않는다.
근거: [공식 설치 문제 해결](https://code.claude.com/docs/en/troubleshoot-install#raw-mode-is-not-supported-during-install).

```sh
(
  set -eu
  umask 077
  test -d "$P1_ROOT/bin"
  test ! -e "$P1_ROOT/bin/claude-2.1.282"
  test ! -L "$P1_ROOT/bin/claude-2.1.282"
  curl --fail --location --proto '=https' \
    'https://downloads.claude.ai/claude-code-releases/2.1.282/darwin-arm64/claude' \
    --output "$P1_ROOT/bin/claude-2.1.282"
  printf '%s  %s\n' \
    'fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4' \
    "$P1_ROOT/bin/claude-2.1.282" | shasum -a 256 -c -
  chmod 700 "$P1_ROOT/bin/claude-2.1.282"
)
```

해시가 다르면 해당 블록은 중단하며 실행 권한을 부여하지 않는다.
macOS의 출처 확인을 우회하거나 quarantine을 제거하지 않는다.
실제 관측을 시작하는 다음 단계에서는 이 파일의 `--version`도 확인하고,
출력이 정확히 2.1.282가 아니면 진행하지 않는다.

`P1_NODE`에는 게스트에서 검증한 Node의 절대 경로를 직접 지정한다.
호스트의 Node 경로나 Blabee wrapper, 자동 업데이트되는 `claude` 심볼릭 링크는 쓰지 않는다.

```sh
P1_NODE="/absolute/path/to/verified/node"
P1_TOOLS="$P1_ROOT/tools"
P1_CLAUDE="$P1_ROOT/bin/claude-2.1.282"
env -u NODE_OPTIONS -u NODE_PATH "$P1_NODE" --test "$P1_TOOLS/p1.test.mjs"
```

## 4. 세 대조군의 순차 실행

| 순서 | mode | 새 run 이름 | 확인할 차이 |
| --- | --- | --- | --- |
| A | `async-exit0` | `a-async-exit0` | 대기 뒤 출력 없는 기준선 |
| B | `rewake-exit0` | `b-rewake-exit0` | asyncRewake만 켜고 exit 0인 경우 |
| C | `rewake-exit2` | `c-rewake-exit2` | exit 2 알림 후 같은 세션 ACK와 오류 UI |

동시에 실행하지 않는다. 각 행은 새 run과 새 session ID를 쓰고, 다음 행 직전에 prepare를 수행한다.
run 유효기간은 준비 후 30분이다. 실패한 run을 수정·초기화·재시도하지 말고 필요하면 새 이름으로 준비한다.

아래는 A의 예시다. B/C에서는 `P1_RUN`의 이름과 `--mode`를 함께 바꾼다.

```sh
P1_RUN="$P1_ROOT/runs/a-async-exit0"
(
  set -eu
  test -x "$P1_CLAUDE"
  printf '%s  %s\n' \
    'fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4' \
    "$P1_CLAUDE" | shasum -a 256 -c -
  env -u NODE_OPTIONS -u NODE_PATH "$P1_NODE" "$P1_TOOLS/prepare.mjs" \
    --run "$P1_RUN" --mode async-exit0
  P1_SESSION_ID="$(env -u NODE_OPTIONS -u NODE_PATH "$P1_NODE" --input-type=module -e \
    'import {readFileSync} from "node:fs"; console.log(JSON.parse(readFileSync(process.argv[1], "utf8")).session_id)' \
    "$P1_RUN/manifest.json")"
  test -n "$P1_SESSION_ID"
  cd "$P1_RUN/project"
  env -u NODE_OPTIONS -u NODE_PATH DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 \
    "$P1_CLAUDE" --session-id "$P1_SESSION_ID" \
    --setting-sources "" --settings "$P1_RUN/settings.json" \
    --tools "" --strict-mcp-config --mcp-config "$P1_RUN/mcp-empty.json"
  printf '%s  %s\n' \
    'fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4' \
    "$P1_CLAUDE" | shasum -a 256 -c -
)
```

이 명령은 다음 단계에서 **일반 대화형 TTY**로 실행한다. `-p`, SDK, resume, Channels 옵션,
권한 우회는 사용하지 않는다. 환경변수는 이 명령에만 적용하며 기존 셸 설정은 수정하지 않는다.
공식 문서상 `DISABLE_AUTOUPDATER`는 자동 업데이트, `DISABLE_UPDATES`는 더 넓은 업데이트 차단 설정이다.
후보 버전의 실제 지원은 미확인하므로 실행 전후 native 파일과 도구 파일의 해시도 비교한다.

첫 프롬프트 전에 확인할 사항:

- 프로젝트 신뢰 확인을 유지하고, native UI에서 활성 Hook·플러그인·MCP·도구를 확인한다.
- `--settings`는 merge이며 `--setting-sources ""`로 관리 정책까지 제거되는 것이 아니다.
  빈 `--setting-sources`의 후보 버전 동작도 아직 확인하지 않았다.
  `--tools ""`는 내장 도구 제한이고 Hook 자체나 MCP·플러그인의 포괄적인 차단은 아니다.
- 관리 `managed-mcp.json`이 적용되면 `--strict-mcp-config` 조합 자체가 거절될 수 있다.
  인증 계정의 동기화 플러그인도 별도로 확인하며 관리 정책을 제거해 통과시키지 않는다.
- 예상하지 않은 Hook·MCP·플러그인 도구가 보이거나 목록을 확인할 수 없으면 프롬프트를 보내지 않는다.
  관리 정책을 수정·우회하지 않고 필요한 조건을 기록한다.
- 각 대조군에서 최초 입력은 `준비되면 READY만 답하고 기다려 주세요.` 한 번만 보낸다.
  첫 Stop 후 5초 대기와 알림, C의 ACK를 관측한다. 재촉하는 입력은 해당 run을 취소하므로 보내지 않는다.
- 초기 관측창은 30초로 두되 응답 지연은 시간 초과로 기록한다. 이것만으로 기능 미지원이라고 단정하지 않는다.
  반복 모델 응답·예상 밖 도구 동작이 발생하면 그 테스트 세션만 중단한다.

CLI 설정의 의미와 우선순위: [CLI reference](https://code.claude.com/docs/en/cli-reference),
[settings](https://code.claude.com/docs/en/settings),
[업데이트 환경변수](https://code.claude.com/docs/en/env-vars),
[관리 MCP](https://code.claude.com/docs/en/managed-mcp#servers-passed-with-mcp-config-or-strict-mcp-config),
[계정 플러그인](https://code.claude.com/docs/en/plugins/loading#plugins-synced-from-claude-ai).

## 5. 관측·종료·다음 단계 판정

다른 게스트 Terminal 창에서 기록을 조회할 수 있다. 아래 Node 명령은 모델을 호출하지 않는다.

```sh
env -u NODE_OPTIONS -u NODE_PATH "$P1_NODE" "$P1_TOOLS/record.mjs" \
  --run "$P1_RUN" --operation report
env -u NODE_OPTIONS -u NODE_PATH "$P1_NODE" "$P1_TOOLS/record.mjs" \
  --run "$P1_RUN" --operation cancel
```

cancel은 알림을 억제하며 Claude 프로세스를 종료하지 않는다. 실험 TTY는 정상 종료하고 기존 사용자 세션은 건드리지 않는다.
새 Terminal에는 앞서 정한 `P1_NODE`, `P1_TOOLS`, `P1_RUN`의 정확한 절대 경로를 다시 지정해야 한다.

각 run의 `observations.json`에 게스트 OS·Claude 실제 버전·격리/도구 확인·같은 세션 wake·오류 UI를 기록한다.
`report`의 `native_qualification`은 여전히 `NOT_EVALUATED`이며 합성 입력 ACK나 예정 종료 기록을 성공으로 바꾸지 않는다.
native Hook의 prompt ID 유무/변화, background/cron 목록 유무도 확인한다. 값이 없으면 guard를 완화하지 않는다.

현 시점에 통과한 것은 준비 상태 조사와 이전 모델 없는 검사다. VM·테스트 계정 준비와 실제 동작 검증은 남아 있다.
최종 P1 판정은 세 대조군의 native 관측 이후에만 한다. 작업 claim·실행, 10분 수명, 다중 세션 및 제품 배포 판정은 이후 단계다.

## 이번 문서의 검사

- README와 이 문서의 로컬 링크·UTF-8·공백, 셸 예시 8개의 `zsh -n` 문법 검사 통과.
- 실제 실행 블록에 테스트 소유 셸 대역만 연결하여 해시 실패·prepare 실패·manifest 읽기 실패·
  프로젝트 폴더 부재 네 경우에서 후속 native 호출 대역에 도달하지 않음을 확인했다.
  실제 Claude/모델은 실행하지 않았으며 임시 검사 파일은 정리했다.
- 기존 P1 runtime·설정 예시·테스트 소스 6개는 조사 시작 시의 SHA-256과 동일하다.
  제품 빌드·회귀 검사와 기존 39개 P1 검사는 이번 문서 변경에 대해 재실행하지 않았다.
