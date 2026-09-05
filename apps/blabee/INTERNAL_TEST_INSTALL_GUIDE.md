# Blabee 내부 테스트 설치·설정 가이드

- 작성일: 2026-09-05
- 대상: Blabee 개발팀과 지정된 내부 테스터
- 대상 빌드: `Blabee 0.1.0-internal`
- 공개 배포 상태: 미승인

## 먼저 알아둘 점

새 fresh-build 절차로 생성하고 검증한 내부 DMG는 앱 설치부터 Codex Plugin 연결까지
한 화면에서 시험할 수 있는 설치본이다. 소스 코드를 내려받거나 dogfood 명령을 복사할
필요가 없다.

가장 짧은 설치 순서는 다음과 같다.

1. DMG에서 `Blabee.app`을 `/Applications`로 끌어 놓고 실행한다.
2. Blabee 설정에서 사용할 프로젝트를 추가하고 **서비스 등록**을 누른다.
3. 같은 설정 화면에서 **Codex 연결하기**를 누른다.
4. 새 Codex 세션을 열고 `/hooks`를 실행한다.
5. Blabee의 `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest`를 직접
   검토하고 신뢰한다.

**Codex 연결하기**는 Plugin 설치까지만 처리한다. Hook 신뢰는 보안상 Blabee가
대신 선택하지 않는다. 따라서 화면에 **Plugin 설치됨 · Hook 상태 확인**이 보이면
Plugin 설치는 끝났지만 Blabee가 Hook 신뢰 완료 여부를 자동 판정하지 않는다는
뜻이다. 새 Codex 세션에서 `/hooks`를 열어 사용자가 직접 상태를 확인한다.

앱 실행이나 설정 화면 열기만으로 Codex 프로세스를 실행하거나 Plugin을 설치하지
않는다. 사용자가 **Codex 연결하기** 또는 **다시 확인**을 명시적으로 눌렀을 때만
검증된 공식 Codex Plugin 명령을 실행하고, 설치 결과를 다시 조회해 확인한다.

Blabee는 공식 Codex 실행 파일, `codex` 명령, `~/.zshrc`, alias 또는 셸 함수를
교체하거나 수정하지 않는다. `PATH`와 기본 `/resume` 동작도 바꾸지 않는다. 일반
Codex는 설치 전과 같은 방법으로 실행한다.

## 1. 설치 전에 확인할 것

다음 내부 DMG의 기본 조건은 다음과 같다.

- macOS 13 이상
- 현재 제공 파일은 Apple Silicon(`arm64`)용
- 공식 Codex CLI는 Blabee와 별도로 설치·로그인되어 있어야 함
- 현재 소스에서 Plugin 연결을 검증한 버전은 `0.151.0`, `0.152.0`, `0.152.1`,
  `0.153.2`이다. `0.153.2` Apple Silicon 공식 배포본은 고정된 전체 파일 hash까지
  일치할 때만 허용하며, 다른 버전은 Codex를 실행하거나 바꾸지 않고 지원 필요 상태로 중단
- DMG와 같은 이름의 `.sha256` 파일을 함께 전달받아야 함
- 전체 설치 smoke test는 기존 Blabee 앱, 백그라운드 서비스, 개발용 dogfood,
  Blabee Plugin이 없는 깨끗한 환경에서 수행

2026-09-05 현재 검증된 내부 테스트 후보는 다음 두 파일이다.

```text
Blabee-0.1.0-internal-arm64-20260905-r8.dmg
Blabee-0.1.0-internal-arm64-20260905-r8.dmg.sha256
```

두 파일에서 확인해야 할 SHA-256은
`e0dbe4ff31713a76df9b38dd3e94f799d53f1bbfec86350cc28d35afd2bffa31`다.
앱 버전은 `0.1.0`, 내부 build number는 `8`, 아키텍처는 정확히 `arm64`다.
파일명이 다르거나 sidecar의 값이 다르면 사용하지 않는다. r8은 ad-hoc 서명 앱을 담은
미서명·미공증 DMG이며 `public_distribution_ready = false`다. r7과 그 이전 파일은
현재 후보로 대체된 로컬 산출물이므로 테스터에게 배포하지 않는다.

Intel Mac 또는 조직 정책상 미공증 앱을 실행할 수 없는 Mac에서는 테스트를
진행하지 않는다. 현재 빌드는 Universal Binary, Developer ID 서명, Apple 공증을
제공하지 않는다.

기존 개발용 dogfood 또는 다른 Blabee Plugin이 설치된 Mac에서는 **Codex 연결하기**가
충돌을 알리고 중단할 수 있다. 현재 빌드가 정확히 식별할 수 있는 단일 구형 Blabee
dogfood 연결이면 사용자가 별도 확인 화면에서 **이전 연결 정리 후 새로 연결**을 선택할
수 있다. 이 동작은 화면에 표시된 구형 Blabee Plugin과 그 marketplace만 제거한 뒤 현재
앱의 Plugin을 설치한다. 일반 Codex, 다른 Plugin, 프로젝트 파일은 변경하지 않는다.

이름·경로·활성 상태가 예상 계약과 다르거나 구형 연결이 둘 이상이면 자동 마이그레이션하지
않고 중단한다. 이 경우 해당 dogfood의 `dogfood-summary.json`에 기록된 guarded cleanup
절차를 개발 담당자와 확인하거나, 별도의 테스트 Mac 또는 사용자 계정에서 진행한다.

## 2. 받은 파일이 온전한지 확인하기

DMG를 열기 전에 두 파일을 같은 폴더에 둔다. 터미널에서 그 폴더로 이동한 뒤 다음
명령을 실행한다.

```sh
CHECKSUM_FILE='실제로 전달받은 .sha256 파일명'
shasum -a 256 -c "$CHECKSUM_FILE"
```

출력 끝에 `OK`가 표시될 때만 설치한다. 실패하면 DMG를 열지 말고 두 파일을 다시
받는다. DMG 파일명이나 `.sha256` 내용을 임의로 고치지 않는다.

## 3. Blabee 앱 설치하기

1. 검증을 통과한 전달받은 `.dmg` 파일을 연다.
2. DMG 창의 `Blabee.app`을 같은 창에 있는 `Applications`로 끌어 놓는다.
3. 복사가 끝나면 Finder의 **응용 프로그램**에서 `Blabee`를 찾는다.
4. 처음 한 번은 앱을 Control-클릭 또는 우클릭하고 **열기**를 선택한다.
5. macOS가 계속 차단하면 **시스템 설정 → 개인정보 보호 및 보안**에서 차단된
   Blabee의 **확인 없이 열기**를 선택한다.
6. 실행 후 DMG를 꺼낸다.

`xattr`로 quarantine을 지우거나 `spctl` 또는 Gatekeeper를 시스템 전체에서 끄지
않는다. 회사 정책으로 실행할 수 없다면 우회하지 말고 테스트를 중단한다.

Blabee는 Dock 아이콘 대신 macOS 메뉴바 아이콘으로 실행된다. 실행 직후 Dock에
일반 앱 창이 나타나지 않아도 메뉴바에 Blabee 아이콘이 보이면 정상이다.

## 4. 권장 초기 설정 순서

메뉴바의 Blabee 아이콘을 누른 뒤 우측 상단의 **상자 아이콘**을 눌러 Blabee 설정을
연다. 프로젝트, 후속 제안 모드, 백그라운드 서비스는 이 화면에서 설정한다. 아래
순서를 권장한다. **톱니바퀴 아이콘**은 단축키 설정을 여는 버튼이다.

### 4-1. 관찰할 프로젝트를 먼저 추가한다

1. **관찰할 프로젝트**에서 **폴더 추가**를 누른다.
2. Codex로 작업할 프로젝트의 최상위 폴더를 선택한다.
3. 목록에 프로젝트 이름과 절대 경로가 표시되는지 확인한다.

등록한 폴더와 그 하위 경로에서만 Blabee가 연결된다. 상위 작업 폴더 전체를
무심코 등록하지 말고 실제 테스트할 프로젝트만 선택한다.

프로젝트 설정은 실행 중 서비스에 즉시 반영되지 않는다. 서비스를 등록하기 전에
프로젝트를 추가하면 첫 시작부터 적용된다. 서비스가 이미 등록된 상태에서 프로젝트를
추가하거나 제거했다면 **등록 해제 → 서비스 등록** 순서로 다시 시작한다.

상태 문구의 의미는 다음과 같다.

- **현재 서비스에서 활성**: 현재 실행 중인 서비스가 관찰 중인 경로
- **설정됨 · 서비스 재시작 후 활성**: 저장은 됐지만 현재 서비스에는 아직 미적용
- **현재 서비스에서만 활성 · 재시작 후 비활성**: 설정에서는 제거됐지만 현재
  서비스가 재시작되기 전까지는 여전히 활성

### 4-2. 후속 제안 모드를 고른다

기본값인 **스마트**를 권장한다.

- **스마트**: 실행 작업에는 항상 제안하고, 설명·분석에는 유용한 후속 선택이
  2개 이상일 때만 제안
- **항상**: 단순 답변을 포함해 적격한 최종 응답마다 제안
- **작업만**: 파일 변경, 테스트, 조사처럼 실제 작업을 수행한 응답에만 제안

이 설정은 제안 빈도만 바꾸며 Codex의 명령 권한 승인 정책은 바꾸지 않는다. 변경한
모드는 백그라운드 서비스를 재시작한 뒤 Hook에 적용된다.

### 4-3. Codex Plugin을 연결한다

1. **Codex 연결**에서 **Codex 연결하기**를 누른다.
2. 작업이 끝날 때까지 앱을 종료하지 않는다.
3. 상태가 **Plugin 설치됨 · Hook 상태 확인**으로 바뀌는지 확인한다.
4. 이미 열려 있던 Codex 세션을 종료하고 새 세션을 시작한다.
5. 새 세션에서 `/hooks`를 실행한다.
6. 아래 네 Hook의 이름과 내용을 직접 확인한 뒤 신뢰한다.

- `SessionStart`
- `UserPromptSubmit`
- `Stop`
- `PermissionRequest`

정확히 식별된 구형 Blabee dogfood가 발견되면 일반 연결 버튼 대신
**이전 연결 정리 후 새로 연결**이 표시된다. 첫 클릭은 변경 대상을 설명하는 확인 단계만
열고, 두 번째 확인을 해야 실제 마이그레이션이 시작된다. 경고에 표시된 marketplace 이름이
예상한 구형 Blabee 연결인지 확인한다. 알 수 없는 이름이거나 다른 Plugin을 함께 바꾸겠다는
내용이면 진행하지 않는다.

Plugin 설치와 Hook 신뢰는 서로 다른 단계다. **Codex 연결하기**가 성공해도 Hook을
신뢰하기 전에는 Pet 카드가 나타나지 않을 수 있다. 반대로 Blabee는 `/hooks`의 신뢰
버튼을 대신 누르거나 신뢰 검사를 우회하지 않는다.

연결 과정에서 Blabee는 앱에 포함된 marketplace를 공식 Codex CLI에 등록하고
`blabee@blabee-app` Plugin을 설치한다. 셸을 경유하지 않으며, 명령이 끝난 뒤 실제
marketplace와 Plugin 상태를 다시 조회한다. 단순히 명령이 종료됐다는 이유만으로
설치 성공으로 표시하지 않는다.

실행 전에는 경로 소유권·쓰기 권한·파일 identity, OpenAI 서명과 지원 버전을
확인하고 각 명령을 시작하기 직전에 같은 파일인지 다시 검사한다. 안전하지 않거나
지원하지 않는 후보는 실행하지 않으며, 다른 안전한 공식 설치 후보가 있으면 그
후보를 확인한다.

다음 상황에서는 자동으로 정리하지 않고 중단한다.

- 정확히 한 개의 알려진 구형 local dogfood 계약에 맞지 않는 Blabee Plugin 또는
  marketplace가 발견됨
- 공식 Codex CLI를 찾지 못함
- 공식 서명 또는 지원 버전을 확인할 수 없음
- 앱이 `/Applications/Blabee.app`이 아닌 위치에서 실행됨
- 설치 후 다시 조회한 상태가 요청한 버전·경로와 일치하지 않음

이때 기존 Plugin을 임의로 지우지 말고 화면에 표시된 이유를 개발 담당자에게
전달한다.

Marketplace 등록 뒤 Plugin 설치가 끝나지 않은 경우에는 **Codex 연결 마무리 필요**가
표시된다. **연결 마무리**로 설치를 다시 시도하거나 **안전하게 정리**로 Blabee가
소유한 exact `blabee-app` Marketplace만 제거할 수 있다. 다른 Marketplace나 Plugin은
자동으로 지우지 않는다.

### 4-4. 백그라운드 서비스를 등록한다

1. **백그라운드 서비스**에서 **서비스 등록**을 누른다.
2. 상태가 **등록됨**으로 바뀌는지 확인한다.
3. **사용자 승인 필요**가 표시되면 **시스템 설정 열기**를 누른다.
4. macOS의 로그인 항목/백그라운드 항목 설정에서 Blabee를 허용한다.
5. Blabee로 돌아와 새로고침 버튼을 누른다.

**등록됨**은 서비스가 실행될 자격이 있다는 뜻이며 실제 daemon이 건강하다는 증거는
아니다. 프로젝트가 **현재 서비스에서 활성**로 바뀌는 것까지 별도로 확인한다.

ad-hoc 내부 앱을 업데이트한 직후 상태가 **실행 확인 필요**로 보이면 설정의 명시적
서비스 재시작을 한 번만 실행하고 상태 갱신을 기다린다. 이 동작은 기존 등록을 해제한
뒤 현재 앱으로 다시 등록한다. 버튼을 반복해서 누르거나 `launchctl`·BTM 초기화 명령을
섞지 않는다. 한 번의 재시작 뒤에도 활성 상태가 되지 않으면 화면과 시각을 기록하고
테스트를 중단한다.

현재 내부 빌드는 legacy login Keychain을 사용할 수 있어 macOS가 암호를 요구할 수
있다. 바로 입력하지 말고 표시된 항목이
`com.biadone.blabee.coordinator.freshness.v1`인지 먼저 확인한다. 테스트 담당자가
예상된 요청임을 확인한 경우에만 요청 앱도 Blabee인지 확인한 뒤 Mac 로그인 암호를
입력하고 **허용**을 사용한다. **항상 허용**은 선택하지 않는다. 예상하지 못한 이름,
다른 요청 앱 또는 반복되는 암호 요청이 나오면 취소하고 화면을 기록해 개발 담당자에게
전달한다.

### 4-5. 단축키를 확인한다

기본 단축키는 다음과 같다.

| 동작 | 기본 단축키 |
| --- | --- |
| Pet 열기/닫기 | `Option + Space` |
| 1번 선택 | `Option + 1` |
| 2번 선택 | `Option + 2` |
| 3번 선택 | `Option + 3` |
| 4번 선택 | `Option + 4` |

Pet 우측 상단의 **톱니바퀴 아이콘**을 눌러 단축키 설정을 연 뒤 조합을 바꿀 수 있다.
다른 macOS 앱과 충돌하면 Blabee가 충돌 또는 등록 실패를 표시하므로 중복되지 않는
조합으로 저장한다.

## 5. DMG 설치본으로 확인할 항목

다음 항목이 모두 맞으면 앱 설치·설정 smoke test는 통과다.

- 앱이 실행되고 메뉴바에 Blabee 아이콘이 나타난다.
- 아이콘을 누르면 Pet 패널이 열리고 바깥을 누르면 닫힌다.
- 메뉴바 아이콘을 우클릭하면 **Blabee 종료** 메뉴가 나타나고 앱이 정상 종료된다.
- 설정 화면에서 프로젝트를 추가·제거할 수 있다.
- 후속 제안 모드를 저장할 수 있다.
- **Codex 연결하기** 뒤 **Plugin 설치됨 · Hook 상태 확인**이 표시된다.
- 새 Codex 세션의 `/hooks`에서 Blabee Hook 네 개를 검토할 수 있다.
- 백그라운드 서비스의 등록 상태가 표시된다.
- 서비스 재시작 뒤 프로젝트가 **현재 서비스에서 활성**로 표시된다.
- 앱을 종료하고 다시 실행해도 설정 화면이 정상적으로 열린다.

다음은 Plugin 설치 확인과 별도로 검증한다.

- Codex 답변 뒤 Pet 결정 카드가 나타나는지
- Pet 선택이 같은 Codex 세션의 다음 턴으로 전달되는지
- 여러 세션의 카드가 먼저 들어온 순서대로 표시되는지
- 지원되는 경로에서 Codex 명령 권한 카드가 올바르게 전달되는지

Plugin이 설치됐다는 사실만으로 위 제품 왕복까지 성공했다고 판단하지 않는다.

### 5-1. 실제 Codex 왕복을 확인한다

1. 등록한 프로젝트 폴더에서 새 Codex 세션을 시작한다.
2. 실제 작업 요청 하나를 완료한다.
3. Codex의 원래 최종 답변이 먼저 정상적으로 끝나는지 확인한다.
4. Blabee Pet의 다음 작업 선택지 하나를 고른다.
5. 같은 Codex 세션에 새 사용자 턴이 만들어지고 선택한 작업이 실행되는지 확인한다.

Pet에 전달 완료가 표시된 것과 Codex 작업이 실제로 성공한 것은 서로 다른 결과다.
둘 다 확인한다. 두 Codex 세션에서 카드를 만들었다면 먼저 들어온 카드부터 표시되는지도
확인한다.

명령 권한 카드는 일반 다음 작업 제안과 별개다. 지원되는 관리형 경로가 아닌 경우에는
권한 결정을 기존 Codex 화면에서 직접 해야 할 수 있다.

### 5-2. 선택 사항: 읽기 전용 Doctor 확인

설치 상태를 바꾸지 않는 정적 진단은 다음과 같이 실행할 수 있다. 프로젝트 경로는
실제 테스트 폴더의 절대 경로로 바꾼다.

```sh
/Applications/Blabee.app/Contents/MacOS/blabee-coordinator doctor \
  --app /Applications/Blabee.app \
  --plugin /Applications/Blabee.app/Contents/Resources/Plugin/blabee \
  --project "/absolute/path/to/project"
```

결과는 `통과`, `사용자 조치 필요`, `실패`로 나뉜다. 이 명령의 Plugin 검사는 앱에
포함된 payload 구조를 확인할 뿐, Plugin이 Codex에 설치·활성화됐거나 Hook이 신뢰된
사실을 증명하지 않는다. 실제 설치 상태는 `codex plugin list --json`, Hook 신뢰는
새 Codex 세션의 `/hooks`에서 따로 확인한다.

현재 r8에서 일반 Codex `0.153.2` Plugin CLI 연결은 지원하지만 관리형 App Server
runtime과 일회 승인 경로는 별도 allowlist다. Doctor의 managed runtime identity,
version 또는 code-mode 항목이 실패해도 일반 Plugin 설치 실패와 같은 뜻이 아니다.
이 상태에서 관리형 권한 승인 지원을 성공으로 기록하지 않는다.

## 6. 선택 사항: 소스 기반 dogfood 검증(개발팀용)

일반 내부 테스터는 이 절차를 수행하지 않는다. 저장소의 최신 개발 변경을 DMG 제작
전에 검증해야 하는 개발팀만 사용한다. DMG 설치 절차와 섞지 않으며 Node.js 22
이상과 Xcode/Swift toolchain이 필요하다.

### 6-1. 개발용 산출물을 준비한다

저장소 루트에서 release coordinator를 빌드한다.

```sh
swift build -c release --package-path src/coordinator-swift
```

기존 경로를 덮어쓰지 않는 새 절대 경로를 정해 dogfood를 준비한다.

```sh
npm run prepare:dogfood -- \
  --binary "$PWD/src/coordinator-swift/.build/release/blabee-coordinator" \
  --output "/private/tmp/blabee-dogfood-20260904-01"
```

출력의 `dogfood-summary.json`에서 아래 값을 확인한다.

- `codex.marketplace_add.argv`
- `codex.plugin_add.argv`
- `runtime.project_enable.argv_prefix`
- `runtime.service.argv`
- `runtime.pet.argv`

JSON에 기록된 인자를 임의로 줄이거나 다른 dogfood 산출물의 값과 섞지 않는다.

### 6-2. Plugin과 프로젝트를 연결한다

`dogfood-summary.json`에 기록된 순서대로 다음 동작을 수행한다.

1. 기존 marketplace 목록을 `codex plugin marketplace list --json`으로 확인한다.
2. `codex.marketplace_add.argv`에 기록된 명령으로 해당 marketplace를 추가한다.
3. `codex.plugin_add.argv`에 기록된 selector로 Blabee Plugin을 설치한다.
4. `runtime.project_enable.argv_prefix` 뒤에 테스트할 프로젝트의 절대 경로 하나를
   붙여 실행한다.
5. 전용 터미널에서 `runtime.service.argv`를 실행하고 종료하지 않은 채 둔다.
6. 대상 프로젝트 폴더에서 평소처럼 `codex`를 새로 실행한다.
7. Codex에서 `/hooks`를 열고 Blabee의 현재 Hook 네 개를 직접 검토한 뒤 신뢰한다.
8. `runtime.pet.argv`로 개발용 Pet을 실행한다.

Codex의 공식 Hook 문서에 따라 새로 설치하거나 내용이 바뀐 비관리 Hook은 현재
정의의 hash를 사용자가 검토하고 신뢰하기 전에는 실행되지 않는다. 테스트에서
`--dangerously-bypass-hook-trust`를 사용하지 않는다.

Blabee Plugin의 Hook은 다음 네 개다.

- `SessionStart`
- `UserPromptSubmit`
- `Stop`
- `PermissionRequest`

Plugin 설치 뒤 이미 열려 있던 Codex 세션에는 새 Plugin이 소급 적용되지 않을 수
있으므로, 해당 세션을 종료하고 새 세션을 시작해 검증한다.

공식 참고:

- [Codex Plugins](https://learn.chatgpt.com/docs/plugins)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)

### 6-3. 전체 왕복을 확인한다

대상 Codex 세션에서 실제 작업 요청 하나를 수행한다.

1. Codex의 원래 최종 답변이 먼저 정상적으로 끝난다.
2. Blabee Pet에 2~4개의 다음 작업 선택지가 표시된다.
3. 1번을 선택하면 같은 Codex 세션에 새 사용자 턴이 생성된다.
4. 실제 작업 성공과 Pet의 전달 완료 표시를 서로 다른 증거로 확인한다.
5. 두 세션에서 요청을 만들었다면 먼저 들어온 카드부터 FIFO 순서로 표시되는지
   확인한다.

명령 권한 카드는 일반 다음 작업 제안과 별개다. Hook 경로는 **거절**과
**Codex에서 직접 결정**만 제공하고, 관리형 App Server 실험 경로에서만
**이번만 허용**을 제공한다. 관리형 실행은 현재 공개 설치 기능이 아니다.

## 7. 문제 해결

### 메뉴바 아이콘이 보이지 않는다

- 응용 프로그램 폴더의 `Blabee.app`을 다시 연다.
- Activity Monitor에서 Blabee가 실행 중인지 확인한다.
- 그래도 나타나지 않으면 macOS 버전, Mac 종류, 설치 위치와 함께 화면을 기록한다.

### 서비스가 사용자 승인 필요에서 바뀌지 않는다

- **시스템 설정 열기**로 이동해 Blabee 백그라운드 항목을 허용한다.
- Blabee 설정으로 돌아와 새로고침한다.
- 계속 같으면 등록 해제와 재등록을 반복하지 말고 상태 화면을 전달한다.

### 프로젝트가 ‘설정됨 · 서비스 재시작 후 활성’로 보인다

설정 파일에는 저장됐지만 현재 서비스가 이전 설정으로 실행 중이라는 뜻이다.
**등록 해제 → 서비스 등록**으로 서비스를 한 번 다시 시작한다.

### Codex 답변 뒤 카드가 나타나지 않는다

- Blabee 설정에서 Codex 상태가 **Plugin 설치됨 · Hook 상태 확인**인지 확인한다.
- 설치되지 않았다면 **Codex 연결하기**를 누른다.
- 새 Codex 세션에서 `/hooks`를 열어 네 Hook의 신뢰 상태를 확인한다.
- 대상 프로젝트가 현재 서비스에서 활성인지 확인한다.
- Plugin 연결 전에 열어 둔 세션이라면 종료하고 새 Codex 세션에서 다시 확인한다.

### Codex 연결하기가 실패한다

- 공식 Codex CLI가 별도로 설치되어 있고 터미널에서 `codex --version`이 동작하는지
  확인한다.
- 앱을 DMG 안에서 직접 실행하지 말고 `/Applications/Blabee.app`으로 복사했는지
  확인한다.
- 알려진 단일 구형 dogfood 안내라면 **이전 연결 정리 후 새로 연결**의 변경 대상을 먼저
  확인한다. 그 밖의 충돌은 기존 dogfood나 다른 Blabee Plugin을 자동 삭제하지 않는다.
- 같은 버튼을 반복해서 누르지 말고 표시된 상태와 오류 문구를 기록한다.

Blabee는 설치 실패를 해결하기 위해 `~/.codex`, `.zshrc`, `PATH` 또는 공식 Codex
실행 파일을 직접 고치지 않는다.

### Codex 자체가 실행되지 않거나 `/resume`이 달라졌다

Blabee 때문에 일반 `codex`, `codex resume` 또는 공식 Codex 파일을 교체해서는 안
된다. 셸 alias, `.zshrc` 수정, 별도 `codex-with-blabee` 강제 실행을 해결책으로
추가하지 말고 테스트를 중단해 재현 명령과 오류를 전달한다.

## 8. 내부 빌드 업데이트하기

현재 자동 업데이트는 없다. 새 DMG를 받으면 다음 순서로 수동 교체한다.

1. 새 DMG와 `.sha256`을 먼저 검증한다.
2. **구버전 Blabee.app이 아직 설치된 상태에서** Blabee 설정의 백그라운드 서비스를
   등록 해제한다. 화면이 `등록되지 않음`으로 바뀔 때까지 앱을 교체하지 않는다.
3. 패널의 X는 창만 닫으므로, 메뉴바 아이콘을 우클릭해 **Blabee 종료**를 선택한다.
4. 아래 명령으로 기존 앱과 새 DMG 앱의 `CFBundleVersion`을 각각 확인한다. 새 번호가
   더 크지 않으면 교체하지 않고 개발 담당자에게 알린다.

   ```sh
   /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
     /Applications/Blabee.app/Contents/Info.plist
   ```

5. 새 DMG의 `Blabee.app`을 Applications로 끌어 기존 **앱 번들 전체**를 교체한다.
   기존 앱 내부의 실행 파일만 덮어쓰지 않는다.
6. 새 앱을 처음 실행할 때와 같은 방식으로 연다. 같은 명령으로 설치된 build number가
   전달받은 파일명의 마지막 `rN`과 같은지 확인한다.
7. 프로젝트와 후속 제안 모드를 확인한다.
8. Codex 연결 상태를 새로고침하고, 앱이 Plugin 업데이트를 안내하면 설정 화면의
   연결 동작으로 새 내장 버전을 설치한다.
9. 새 Codex 세션의 `/hooks`에서 변경된 Hook을 다시 검토한다.
10. 백그라운드 서비스를 한 번 등록한다. `등록됨`만 보지 말고, 프로젝트가
    **현재 서비스에서 활성**로 바뀌어 실제 service 응답까지 확인한다.

ad-hoc 교체 뒤 **실행 확인 필요**가 나타나면 위 등록 버튼을 반복하지 말고 설정의
명시적 서비스 재시작을 정확히 한 번 사용한 뒤 상태 갱신을 기다린다. 이 내부 제약을
없앤 공개 업데이트 경험을 제공하려면 안정적인 Developer ID 서명과 공증된 빌드,
지원 macOS별 업데이트 자격 시험이 필요하다.

서비스 등록을 해제하지 않은 채 ad-hoc 앱을 교체하면 macOS가 이전 코드에 저장한
launch constraint와 새 앱을 다르게 판단해 `OS_REASON_CODESIGNING` 또는
`needs LWCR update`로 실행을 거부할 수 있다. build number 증가는 필요한 구분자이지만
이 등록 경계를 대신하지 않는다. 정상 업데이트에 `launchctl`이나 BTM 전체 초기화
명령을 사용하지 않는다.

현재 업데이트·다운그레이드와 설정 보존은 깨끗한 Mac에서 최종 자격을 통과하지
않았다. 이상이 있으면 이전 앱을 임의로 섞어 복구하지 말고 빌드 버전과 증상을
기록한다. 개발용 dogfood Plugin은 해당 산출물의 `dogfood-summary.json`에 기록된
guarded cleanup 절차를 먼저 완료한 뒤 새 산출물을 설치한다.

현재 r8은 개발 Mac의 `/Applications/Blabee.app`에 설치해 앱 `0.1.0` build `8`, 최소
macOS 13, exact `arm64`, deep/strict ad-hoc 서명과 실제 service 실행까지 확인했다.
교체 직후 첫 service 실행은 ad-hoc LWCR 갱신 문제로 실패했지만, 설정의 명시적 서비스
재시작이 unregister/re-register를 수행한 뒤 새 BTM 등록으로 정상 실행됐다. 설정에는
transport 오류가 사라지고 **Plugin 설치됨 · Hook 상태 확인** 안내가 표시됐다.

이는 한 개발 Mac의 복구 경로 증거다. 깨끗한 Mac 최초 설치, 다른 macOS 버전,
Hook 신뢰와 실제 Pet 선택 왕복, 관리형 Codex 승인은 아직 별도 확인 대상이다.

## 9. 제거하기

1. Blabee 설정의 Codex 연결 영역에서 **연결 해제**를 선택한다.
2. 연결 해제 뒤 Blabee Plugin과 `blabee-app` marketplace가 더 이상 등록되지 않은
   상태인지 확인한다.
3. Blabee 설정에서 백그라운드 서비스를 **등록 해제**한다.
4. 등록한 프로젝트를 목록에서 제거한다.
5. 패널의 X는 창만 닫으므로, **활성 상태 보기**에서 Blabee를 선택해 **종료**한다.
6. 응용 프로그램 폴더의 `Blabee.app`을 휴지통으로 이동한다.

연결 해제는 Blabee가 정확히 설치한 항목만 대상으로 한다. 다른 marketplace의
Blabee Plugin이나 개발용 dogfood가 발견되면 자동으로 삭제하지 않는다.

앱을 지워도 `~/Library/Application Support/Blabee`의 설정, DB, key 파일 또는
Keychain 항목이 남을 수 있다. 현재 내부 빌드는 완전한 제거 도구를 제공하지 않는다.
이 파일들을 Finder나 터미널에서 임의로 삭제하면 freshness 보호 때문에 남은 상태가
복구 불가능해질 수 있으므로, 완전 정리가 필요하면 개발 담당자와 함께 정확한 상태를
확인한 뒤 진행한다.

개발용 dogfood는 앱 삭제 대신 해당 `dogfood-summary.json`의 cleanup 순서와
guarded rotation 명령을 사용한다. 실행 중 Codex, Pet 또는 service가 있으면 정리를
강제로 진행하지 않는다.

## 10. 테스트 결과를 전달할 때

다음 항목을 함께 보낸다.

- 사용한 DMG의 실제 파일명
- 함께 받은 `.sha256` 파일의 검사 성공 여부와 확인된 SHA-256 값
- Mac 모델/아키텍처와 macOS 버전
- Codex 연동을 시험했다면 `codex --version`
- 앱 설치 위치
- 설정 화면의 Codex Plugin 상태 문구
- `/hooks`에서 확인한 `SessionStart`, `UserPromptSubmit`, `Stop`,
  `PermissionRequest` 각각의 상태
- 메뉴바 실행, 프로젝트 활성화, Plugin 설치, Hook 확인, Pet 카드 표시,
  같은 세션의 다음 턴 전달을 각각 `통과`, `실패`, `실행하지 않음`으로 구분한 결과
- 두 세션을 시험했다면 카드가 들어온 순서와 실제 표시 순서
- 명령 권한 카드를 시험했다면 일반 후속 제안 왕복과 구분한 결과
- 실패한 단계, 발생 시각, 재현 순서와 화면에 표시된 마지막 오류 문구
- 필요한 경우 민감 정보가 보이지 않는 화면 캡처

비밀번호, token, API key, 전체 Keychain 내용, 전체 journal 또는 다른 프로젝트의
대화 내용은 보내지 않는다.

DMG 생성·검증 방법과 공개 배포 전 남은 작업은
[`INTERNAL_DMG_PACKAGING.md`](./INTERNAL_DMG_PACKAGING.md)를 참고한다.
