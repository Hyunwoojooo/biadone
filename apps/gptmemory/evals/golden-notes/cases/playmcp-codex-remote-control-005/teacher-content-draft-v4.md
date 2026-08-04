> 상태: v4 의미 정답지 초안
> 근거 상태: `sourceMessageIds` 미부여
> 승인 상태: 사람 검수 전
> 평가 사용: 자동 점수화 금지

# 카카오톡으로 로컬 Codex CLI 세션을 제어하는 브릿지 설계

## 한눈에 보기

- PlayMCP 공모전 아이디어를 특정 로컬 Codex CLI 세션의 입력·출력과 승인을 카카오톡에서 중계하는 제품으로 구체화했다.
- 코어는 Relay Server와 사용자 머신의 Local Agent이며, MCP는 PlayMCP·Kakao Tools에 기능을 노출하는 어댑터로 정리됐다.
- 아키텍처와 MVP 계획 문서는 만들어졌지만 실제 구현·배포는 확인되지 않았고, 후반에는 별도 TIV audit을 66/100으로 평가했다.

## 핵심 정리

- 카카오톡의 모든 데이터를 자유롭게 읽는 구조가 아니라 사용자가 허용한 카카오 기능을 도구 단위로 연결하는 것이 PlayMCP의 전제다.
- 사용자는 Codex API 서비스를 원한 것이 아니라 이미 실행 중인 특정 CLI 세션에 카카오톡 메시지와 승인·거절을 연결하려 했다.
- Local Agent는 AI가 아니라 CLI 입출력, 화면·로그와 승인 프롬프트를 중계하는 로컬 프로그램이다.
- tmux·PTY, WebSocket Relay와 이벤트 중심 출력이 구현 구조로 제안됐지만 카카오 UI와 output 전달의 실제 허용 범위는 미확인이다.
- TIV audit 결과는 내부 검토용 초안 수준이며 분류 규칙 보정이 필요하다고 평가됐다.

## 주제별 정리

### 1. 제품 핵심의 정정

대화는 PlayMCP가 카카오톡·톡캘린더·카카오맵·멜론 같은 허용된 기능을 MCP 도구로 연결하는 구조를 이해하는 데서 시작했다. 카카오톡의 모든 대화를 AI가 자유롭게 읽는 것이 아니라, 사용자가 허용한 데이터와 기능을 도구 단위로 조합한다는 경계가 먼저 정리됐다.

사용자는 Telegram 채팅으로 Codex CLI를 조작하는 사례를 카카오톡에 적용해 PlayMCP 공모전에 출품하려 했다. 초기에는 카카오톡에서 코딩 에이전트의 작업 시작·진행·테스트·승인을 관리하는 일반 관제 도구로 설명됐지만, 사용자는 Codex API를 호출하는 별도 서비스가 아니라고 수정했다.

정확한 목표는 로컬에서 계속 실행되는 특정 Codex CLI 세션의 입출력을 중계하는 것이다. 하나의 세션 ID에는 하나의 카카오 대화 맥락이 대응하고, 그곳의 프롬프트는 해당 세션에만 입력돼야 한다. CLI의 출력뿐 아니라 `yes/no`, 명령 실행 허용 같은 승인·거절도 카카오 쪽 선택지로 처리해야 한다. 따라서 카카오톡은 새로운 AI 모델이 아니라 특정 터미널 세션을 위한 원격 인터페이스다.

### 2. Local Agent와 세션 연결

Local Agent는 사용자의 맥북·맥미니·서버에서 실행되는 비-AI 중계 프로그램으로 정의됐다. 카카오에서 들어온 메시지를 CLI 입력으로 전달하고, 터미널 출력을 읽고, 승인 프롬프트를 감지해 서버로 올리며, 승인 응답을 다시 키 입력으로 변환한다. 실제 파일 수정·명령·테스트는 기존 Codex CLI와 그 permission 체계 안에서 일어난다.

세션 연결에는 두 방식이 비교됐다. Agent가 Codex CLI를 처음부터 PTY로 실행해 입출력을 소유하는 방식과, Codex를 tmux 안에 두고 `capture-pane`, `pipe-pane`, `send-keys`로 연결하는 방식이다. 이미 돌아가는 특정 세션을 제어하려는 요구에는 tmux가 더 가깝지만, 임의의 일반 터미널 프로세스에 나중에 붙는 것은 어렵기 때문에 MVP에서는 Codex가 tmux 안에서 실행된다는 조건을 두는 안이 제시됐다.

터미널의 모든 raw output을 한 줄씩 카카오톡으로 보내기보다 전체 로그는 내부에 유지하고 작업 시작, 명령 실행, 승인 요청, 테스트 실패·성공, 완료 같은 중요 이벤트를 보내는 방식이 제안됐다. 사용자가 요청할 때 최근 로그나 현재 화면 snapshot을 조회하게 하면 메시지 폭주와 플랫폼 제한을 줄일 수 있다는 이유다. 이 전달 방식과 주기는 확정 사양이 아니다.

### 3. Relay·MCP 아키텍처와 MVP

제안된 계층은 Kakao Tools, Relay/MCP Server, Local Agent와 Codex CLI로 나뉜다. 카카오 쪽은 세션 선택, 프롬프트, 승인·거절, 상태·로그 조회를 담당한다. Relay는 카카오 사용자와 Host·Session을 매핑하고 메시지를 올바른 Agent로 라우팅하며 이벤트·승인 요청·감사 로그를 관리한다. Agent는 outbound WebSocket으로 연결하고 로컬 tmux·PTY를 조작한다.

MCP의 위치도 구분됐다. `카카오톡 ↔ Relay ↔ Local Agent ↔ Codex CLI`라는 핵심 브릿지는 일반 API와 WebSocket만으로 구현할 수 있다. 다만 PlayMCP 공모전에서 기능을 Kakao Tools의 `list_sessions`, `send_prompt`, `get_status`, `get_updates`, `respond_approval`, `interrupt_session` 같은 도구로 노출하려면 MCP Server가 표준 어댑터로 필요하다는 설명이다.

MVP 성공 흐름은 tmux 안의 Codex 실행, Agent attach·pairing, WebSocket 연결, 세션 조회, 프롬프트 전달, 출력 조회, 승인 감지, 카카오 승인·거절과 실제 CLI 반영까지의 종단 시나리오로 정의됐다. Protocol·Agent·Server 역할, 재연결, secret redaction, event store와 approval manager를 포함한 계획이 제안됐고 `talkcode_architecture.md`, `talkcode_mvp_execution_plan.md`가 제공됐다. TypeScript 모노레포, PostgreSQL, Zod, `fake-codex`와 일정은 채택되지 않은 구현 후보다.

### 4. 별도 TIV 구조화 audit

후반의 별도 요청은 TIV가 ChatGPT 공유 대화를 구조화한 GPT audit 결과의 품질 검수였다. Clean Conversation과 Context/Internal 1차 분리는 비교적 괜찮았지만, 제품에서 자동 결과로 쓰기에는 사람 검토가 필요한 draft extraction 수준이라는 판단으로 66/100이 제시됐다.

같은 PDF 보류 문장이 `deferred`와 `excluded`로 중복된 점, 중요한 기능 제외 결정의 누락, Markdown 선호·파일 생성 action·기술 질문의 혼합, 링크 검토를 preference로 오분류한 점, overview와 satisfaction·topic shift 판정 문제가 지적됐다. decision 병합, scope exclusion, preference/action/content constraint 재분류와 meta request 처리를 먼저 고치고, 미묘한 만족도와 복합 문장 분해는 향후 LLMExtractor 단계로 넘기는 우선순위가 제안됐다.

## 결론과 확정된 결정

- **확정 요구:** Codex API가 아닌 특정 로컬 Codex CLI 세션을 원격 제어한다.
- **확정 요구:** 세션별 대화 맥락에서 프롬프트, 출력, 승인과 거절을 처리한다.
- **확정 구분:** MCP는 로컬 브릿지의 필수 엔진이 아니라 PlayMCP 노출 인터페이스다.

## 다음에 할 일

- 명시된 후속 작업 없음.

## 남은 질문

- Kakao Tools가 세션별 UI와 자동 출력 전달을 어떤 형태로 허용하는가?
- Codex CLI 버전별 승인 입력을 어떻게 안정적으로 감지·전달할 것인가?
- 최종 서비스명과 실제 구현·배포 범위는 무엇인가?

## 보조 정보

- **실제 산출물:** 대화 중 아키텍처 문서와 Server·Agent·Protocol MVP 실행계획 Markdown이 제공됐다.
- **검토 중인 제안:** TalkCode 명칭, TypeScript 모노레포, PostgreSQL, WebSocket, `fake-codex`와 구체 일정.
- **중요한 제약:** 세션별 독립 채팅방이나 무제한 실시간 raw output 가능성을 사실로 단정하면 안 된다.
