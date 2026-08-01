# Human Review — remote-dev-ghostty-codex-003

상태: `pending`

## 원문 대조

- [ ] 네 머신의 역할 분담과 Tailscale 등 연결 구성은 초기 제안안이며, 실제 구축 완료로 표현되지 않았다.
- [ ] 맥미니 원격 로그인 명령은 권한 문제로 실패했고 당시 `Remote Login: Off`였으며, 최종 활성화 여부는 미확인으로 남아 있다.
- [ ] 원격 Codex CLI와 GitHub를 사용하는 구조가 사용자가 확인한 기본 방향으로 표현되어 있다.
- [ ] D2Coding Nerd만 사용하려는 요구가 사용자의 명시적 선택으로 기록되어 있다.
- [ ] `ssh msispark`, `TERM=xterm-ghostty`, 256색 확인 결과가 정확하다.
- [ ] SSH 키 passphrase 설정과 공개키 인증 완료 여부가 구분되어 있다.
- [ ] DGX의 `.zshrc` 중복·구문 오류 수정 과정이 정확하다.
- [ ] 로컬·원격 Codex의 박스형 UI 차이 원인을 어느 하나로 단정하지 않았다.
- [ ] tmux 자동 attach를 폐기하고 SSH 후 직접 연결하는 방향 전환이 반영되어 있다.
- [ ] 머신별 Ghostty 프로필, 실행 함수, 맥미니 `.zshrc` 등은 실제 적용이 확인되지 않은 제안으로 구분되어 있다.
- [ ] 잠자기 방지와 Docker·OrbStack 등 맥미니 서버 구성의 완료 여부를 과장하지 않았다.

## 노트 품질

- [ ] 확정된 선택, 제안만 된 구성, 미해결 문제가 명확히 구분된다.
- [ ] 네 머신의 역할에서 Ghostty·SSH·Codex 설정으로 좁혀지는 흐름을 다시 따라가기 쉽다.
- [ ] 명령, 머신명, 로컬·원격 환경이 혼동되지 않는다.
- [ ] `현재 도달한 상태`가 정확하고 간결하다.

## Reviewer notes

- 미작성

## 승인

- Reviewer:
- Reviewed at:
- Decision: `pending`
- Human reference path: 미생성

## 수집 시 확인된 기술 메모

- 현재 ChatGPT share adapter가 대화 제목을 `create_time`으로 잘못 추출했다.
- 평가 입력은 1-based message index 170까지만 사용한다.
- message 171의 Teacher 프롬프트와 message 172의 Teacher 답변은 candidate 입력에서 반드시 제외한다.
