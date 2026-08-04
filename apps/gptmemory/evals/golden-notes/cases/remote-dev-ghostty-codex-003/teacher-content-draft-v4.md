> 상태: v4 의미 정답지 초안
> 근거 상태: `sourceMessageIds` 미부여
> 승인 상태: 사람 검수 전
> 평가 사용: 자동 점수화 금지

# Ghostty·SSH·Codex CLI 기반 원격 개발 환경 정리

## 한눈에 보기

- 맥북을 조작기로 삼아 맥미니와 DGX Spark에서 Codex CLI 작업을 이어가기 위한 원격 개발 구성을 다뤘다.
- 기본 작업 방식은 SSH로 원격 머신에 접속해 Codex CLI를 실행하고 GitHub로 프로젝트 상태를 관리하며, tmux는 필요할 때 직접 붙는 구조다.
- Ghostty와 원격 zsh의 일부 설정은 확인됐지만 원격 Codex UI 차이, 공개키 인증과 마지막 실행 함수·맥미니 설정은 미해결이다.

## 핵심 정리

- 초기 역할안은 맥북=조작기, 맥미니=상시 서버, DGX=AI 실험 서버, Windows=보조 머신이었다. Tailscale 등 전체 구축 완료는 확인되지 않았다.
- Codex 작업의 기준은 원격 Codex CLI와 GitHub이며, GUI handoff나 세션 복사를 기본 방식으로 채택한 것은 아니다.
- 사용자는 Ghostty에서 JetBrains Mono를 빼고 D2Coding Nerd만 사용하기로 했다.
- `ssh msispark` 별명과 원격 `TERM=xterm-ghostty`, 256색 지원은 확인됐으나 비밀번호 없는 공개키 인증은 미확인이다.
- `g-dgx`의 tmux 자동 attach는 폐기됐고, 새 Ghostty 창에서 SSH만 실행한 뒤 tmux는 사용자가 직접 연결하는 방향으로 바뀌었다.

## 주제별 정리

### 1. 원격 작업 구조

초기 역할안은 맥북 에어를 조작기, 맥미니를 상시 홈 서버, DGX Spark를 AI 실험 서버, Windows·RTX 3070 데스크톱을 보조 GPU와 Windows 전용 작업 머신으로 나누는 것이었다. Tailscale, VS Code Remote, GitHub와 선택적 Syncthing이 연결 수단으로 제안됐지만 네 장비 전체 설치가 확인된 것은 아니다.

맥미니를 서버로 쓰기 위해 `systemsetup -setremotelogin on`을 실행했으나 Terminal의 전체 디스크 접근 권한 문제로 실패했고 당시 출력은 `Remote Login: Off`였다. 시스템 설정에서 원격 로그인을 켜거나 권한을 준 뒤 재시도하는 방법이 안내됐다. 맥북은 잠들어도 되지만 서버 역할의 맥미니 본체는 잠들지 않아야 한다는 구분과 `pmset` 설정도 제안됐으나 최종 적용은 확인되지 않았다.

Codex 작업 이전에는 Git으로 프로젝트 상태를 전달하고 CLI 세션을 복사하거나 Desktop App을 사용하는 여러 안이 검토됐다. 최종 기본 구조는 프로젝트 파일과 실행 환경을 맥미니 또는 DGX에 두고, 맥북의 Ghostty에서 SSH로 접속해 원격 Codex CLI를 실행하며 GitHub를 버전 관리와 작업 상태 전달의 기준으로 쓰는 방향이었다. tmux는 세션 유지 도구이지만 Ghostty 실행 명령에서 자동으로 붙이지 않고 사용자가 필요할 때 직접 연결한다.

### 2. Ghostty와 원격 셸

Ghostty와 Kitty를 비교한 뒤 macOS 네이티브 경험과 단순한 구성을 이유로 Ghostty가 추천됐다. 초기 Ghostty는 밝은 Rose Pine Dawn과 한글 fallback 폰트 때문에 한글이 궁서체처럼 보였고, 중복된 테마·폰트 설정도 있었다. 설정 재로딩과 앱 재시작의 차이를 확인하는 과정 뒤 사용자는 JetBrains Mono를 제거하고 `D2CodingLigature Nerd Font`만 쓰고 싶다고 명시했다.

DGX 접속을 `ssh mimiclab@IP` 대신 `ssh msispark`로 줄이기 위해 `~/.ssh/config`의 `Host`, `HostName`, `User`, `Port` 역할이 설명됐다. keepalive, `IdentityFile`, ssh-agent와 macOS Keychain 설정도 안내됐고 passphrase가 있는 ed25519 키를 만들었지만, 이후에도 계정 비밀번호가 표시돼 공개키 인증 완료 여부는 확인되지 않았다.

원격 터미널에서 `TERM=xterm-ghostty`, `tput colors=256`이 확인돼 Ghostty terminfo와 색상 전달은 정상으로 판명됐다. DGX의 zsh 초기 설정에서는 빈 `.zshrc`를 만든 뒤 중복 블록과 닫히지 않은 구문으로 발생한 parse error를 정리하고 autosuggestions·syntax highlighting을 로드하는 안이 제시됐다. 맥미니에는 `ls -G`, Homebrew PATH 등 macOS에 맞춘 별도 `.zshrc`가 제안됐지만 적용 확인은 없다.

### 3. 원격 Codex UI 문제

맥북 로컬에서 Codex CLI를 실행하면 사용자 입력 영역이 박스나 배경으로 구분되지만, Ghostty에서 DGX에 SSH 접속해 실행하면 같은 표현이 나타나지 않았다. 처음에는 Ghostty 테마, ANSI 팔레트, Codex `/theme`와 tmux truecolor 설정이 원인 후보로 제시됐지만 사용자가 적용해도 차이가 없었다.

원격 `TERM`과 256색이 정상이라는 확인 뒤, zsh syntax highlighting은 일반 셸 입력에만 적용되고 Codex TUI 내부에는 영향을 주지 않는다는 점이 분리됐다. 비교해야 할 범위는 로컬·원격 Codex 버전, 각 머신의 `~/.codex/config.toml`, raw output·alternate-screen 모드와 SSH TTY 감지 차이로 좁혀졌다. 정확한 원인은 이 대화에서 해결되지 않았다.

### 4. Quick Terminal과 머신별 실행 명령

Ghostty의 Quick Terminal은 하나의 singleton 창을 열고 숨기는 기능으로 설명됐다. 짧은 SSH 접속과 상태 확인의 입구로 사용하고, 여러 지속 작업 공간은 일반 Ghostty 창이나 원격 tmux의 session·window·pane으로 관리하는 역할 분리가 제안됐다.

로컬·DGX·맥미니를 색으로 구분하기 위해 공통 설정 위에 DGX 파란색, 맥미니 초록색 프로필을 두고 `g-local`, `g-dgx`, `g-mini`로 새 Ghostty 인스턴스를 여는 구조가 제시됐다. 처음의 `g-dgx`는 동일한 tmux `saber` 세션에 자동 attach했기 때문에 두 창이 같은 화면으로 동기화됐다.

사용자는 tmux에는 직접 붙겠다고 명시해 자동 attach 구조를 폐기했다. 최종 의도는 새 Ghostty 창에서 각각 `ssh msispark`, `ssh macmini`만 실행하는 것이다. 마지막에 보인 alias는 `-e ssh $`, `-e$`처럼 잘려 있었고 alias 대신 함수로 바꾸는 수정안이 제시됐지만 실제 교체와 테스트는 확인되지 않았다.

## 결론과 확정된 결정

- **확정 방향:** 원격 Codex CLI와 GitHub를 기본 작업 구조로 사용한다.
- **확정 선택:** Ghostty 글꼴은 D2Coding Nerd만 사용한다.
- **확정 변경:** Ghostty 실행 명령에서 tmux 자동 attach를 제거하고 tmux는 직접 연결한다.

## 다음에 할 일

- 명시된 후속 작업 없음.

## 남은 질문

- DGX와 맥미니의 SSH 공개키 인증이 완성됐는가?
- 원격 Codex 입력 UI가 다른 정확한 원인은 무엇인가?
- 맥미니 원격 로그인·상시 가동과 마지막 Ghostty·zsh 설정이 실제 적용됐는가?

## 보조 정보

- **검토 중인 제안:** 머신별 색상 프로필, 함수형 Ghostty 실행 명령, macOS 전용 `.zshrc`.
- **중요한 제약:** 서버·절전·SSH 설정은 제안된 값과 실제 적용 상태를 구분해야 한다.
