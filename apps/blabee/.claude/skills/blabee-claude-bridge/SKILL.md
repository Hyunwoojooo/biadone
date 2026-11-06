---
name: blabee-claude-bridge
description: 이 세션을 Blabee Claude Bridge 영역 세션으로 선언한다. 세션 첫 메시지에서 /blabee-claude-bridge 로 호출한다.
disable-model-invocation: true
---

이 세션은 **Blabee Claude Bridge** 영역이다. 이전 Codex 세션 "Blabee-Claude Bridge"에 해당한다.

소유 경로: `bridges/claude/`, `Contracts/bridge/`, `Tests/bridges/claude/`, `scripts/prepare-claude-runtime.mjs`, `scripts/sign-claude-runtime.mjs`,
`dev/claude-standalone/`, `docs/bridges/claude/`.

지금 할 일:
1. `bridges/claude/CLAUDE.md`를 읽는다.
2. `git status --short`로 미커밋 변경을 확인하고, 소유 경로 안의 파일과 밖의 파일(다른 세션의 것)을 구분해 기억한다.
3. 영역, 소유 경로, 미커밋 파일 수(안/밖)를 두세 줄로 보고한다. 아직 아무것도 수정하지 않는다.
4. 사용자가 인수를 함께 줬다면(`$ARGUMENTS`) 그 작업을 시작한다. 없으면 지시를 기다린다.

이 세션 자체가 Blabee 자동 연결 shim을 거쳐 실행 중일 수 있다. 설치된 shim·앱·`.zshrc` 블록을 고치지 않는다.
영역 밖 파일을 고쳐야 하면 고치기 전에 사용자에게 파일과 이유를 말한다. 루트 `CLAUDE.md`의 공통 규칙이 우선한다.
