[REFERENCE_NOTE]

# 카카오톡으로 로컬 Codex CLI 세션을 원격 제어하는 PlayMCP 공모전 아이디어와 MVP 설계

## 개요

대화는 카카오의 PlayMCP가 무엇이며 카카오 서비스 데이터를 AI가 어떻게 활용하는지 이해하는 것에서 시작되었다. 이후 사용자는 Telegram으로 Codex CLI를 원격 조작하는 사례를 카카오톡에 적용해 공모전에 출품하려는 아이디어를 제시했고, 논의를 거치며 목표를 “Codex API 서비스”가 아니라 “특정 로컬 Codex CLI 세션의 입출력과 승인을 카카오톡에서 원격 제어하는 브릿지”로 구체화했다. 이 방향을 바탕으로 전체 아키텍처와 Server·Agent·Protocol 단위의 MVP 실행계획을 문서화했으며, 마지막에는 별도로 업로드된 TIV GPT audit 결과의 구조화 품질을 검수했다.

## 01. PlayMCP와 카카오 데이터 연결 방식 이해

사용자는 먼저 카카오의 PlayMCP를 자세히 설명해 달라고 요청했다. assistant는 PlayMCP를 AI가 카카오톡, 톡캘린더, 카카오맵, 멜론 등의 외부 기능을 MCP 도구로 호출할 수 있게 하는 플랫폼으로 설명하고, PlayMCP·도구함·Kakao Tools·공모전의 관계를 정리했다.

사용자는 이를 “카카오톡에 있는 데이터들을 AI가 엮어주는 것인가”라고 다시 확인했다. assistant는 큰 방향에서는 맞지만, 카카오톡의 모든 대화를 AI가 자유롭게 읽는 구조는 아니며 사용자가 허용한 카카오 서비스의 데이터와 기능을 도구 단위로 조합하는 것이라고 구분했다.

## 02. Telegram식 Codex CLI 원격 조작 아이디어 제안

사용자는 PlayMCP 공모전에 참가할 예정이라고 밝히고, Telegram 채팅으로 Codex CLI를 원격 제어하는 사례를 카카오톡에서도 구현하고 싶다고 제안했다. 처음 제시한 아이디어는 컴퓨터 앞에서 Codex CLI에 직접 지시하는 대신 카카오톡에서 작업을 요청하고 진행 상황을 확인하는 방식이었다.

assistant는 처음에는 이를 카카오톡 안에서 코딩 에이전트의 작업 시작, 진행 상태, 테스트 결과, 승인 요청 등을 관리하는 “개발 에이전트 원격 관제 도구”로 확장해 제안했다. 서비스명으로 TalkCode·톡코드 등의 후보를 제시하고, Local Agent, Relay Server, MCP Server, Kakao Tools를 결합한 구조와 공모전용 기획안, 보안 설계, 데모 시나리오를 함께 제안했다. 다만 이 단계의 서비스명과 세부 기능은 assistant의 제안이었고, 사용자가 최종 명칭으로 확정한 것은 아니다.

## 03. Codex API 방식에서 특정 CLI 세션 중계 방식으로 명확화

사용자는 assistant의 초기 제안이 자신의 의도와 정확히 같은지 확인하면서, Codex API를 호출하려는 것이 아니라 이미 실행 중인 Codex CLI 세션을 계속 모니터링하고 그 출력을 카카오톡에 전달하려는 것이라고 수정했다. 카카오톡에서 보낸 프롬프트는 실제 터미널의 Codex CLI 입력으로 들어가고, Codex가 출력하는 로그와 상태는 카카오톡에서 확인해야 한다고 명확히 했다.

이어 사용자는 하나의 Codex CLI 세션, 예를 들어 `019eeda0-…-fdc3364f` 같은 세션에 대응하는 전용 카카오톡 대화 공간이 생기고, 그 대화에서 입력한 내용은 오직 해당 세션으로만 전달되어야 한다고 설명했다. Codex CLI에서 나타나는 `yes/no`, 승인·거절, 명령 실행 허용 요청도 카카오톡 채팅방의 버튼이나 선택지로 처리되어야 한다고 덧붙였다.

assistant는 이에 맞춰 앞선 설명을 수정했다. 최종적으로 이해한 제품의 핵심은 “카카오톡 기반 Codex CLI 세션 원격 제어 브릿지”이며, 카카오톡은 별도의 AI 모델을 호출하는 곳이 아니라 로컬 머신에서 계속 실행되는 특정 Codex CLI 세션의 원격 입력·출력 인터페이스라고 정리했다.

## 04. Local Agent의 역할과 세션 연결 구조

사용자는 아키텍처에 등장한 Local Agent가 무엇인지 질문했다. assistant는 Local Agent를 사용자의 맥북·맥미니·서버 안에서 실행되며 카카오톡과 Codex CLI 사이를 중계하는 작은 프로그램으로 설명했다. Local Agent 자체는 AI가 아니며, 카카오톡에서 들어온 메시지를 Codex CLI에 입력하고, 터미널 출력을 읽고, 승인 프롬프트를 감지해 다시 카카오톡으로 전달하는 역할을 맡는다.

assistant는 Codex 세션 연결 방식으로 두 가지를 구분했다. 하나는 Local Agent가 처음부터 Codex CLI를 PTY로 실행해 입출력을 직접 관리하는 방식이고, 다른 하나는 이미 실행 중인 Codex CLI를 `tmux` 세션에 두고 `capture-pane`, `pipe-pane`, `send-keys` 등으로 붙는 방식이었다. 사용자가 원하는 “이미 돌아가는 특정 세션에 연결”에는 tmux 방식이 더 가깝다고 설명했으며, 일반 터미널에서 이미 실행 중인 임의 프로세스에 나중에 붙는 기능은 더 어려우므로 MVP에서는 Codex를 tmux 안에서 실행하는 조건을 두는 방안을 제안했다.

또한 assistant는 카카오톡에 터미널의 모든 raw output을 한 줄씩 무제한 전송하기보다, 전체 로그는 내부에 유지하고 작업 시작, 명령 실행, 승인 요청, 테스트 실패·성공, 완료 등 중요 이벤트를 전달하며 필요할 때 최근 로그나 현재 화면을 조회하는 방식이 현실적이라고 제안했다.

## 05. 전체 아키텍처와 MCP의 정확한 위치 정리

사용자는 확정한 핵심 로직을 바탕으로 프로그램 아키텍처를 제안해 달라고 요청했다. assistant는 다음과 같은 계층 구조를 제시했다.

카카오톡 또는 Kakao Tools는 세션 선택, 프롬프트 입력, 승인·거절, 상태 및 로그 조회를 담당한다. TalkCode Relay/MCP Server는 카카오 사용자와 Host·Codex Session을 매핑하고, 메시지를 올바른 Local Agent로 라우팅하며, 이벤트·승인 요청·감사 로그를 저장한다. Local Agent는 사용자 머신에서 outbound WebSocket으로 서버와 연결되고, tmux 또는 PTY를 통해 Codex CLI 화면을 캡처하고 입력과 제어 키를 전달한다. 실제 파일 수정, 명령 실행, 테스트 등은 기존 Codex CLI와 그 permission 체계 안에서 이루어진다.

사용자는 이 아키텍처 설명을 Markdown 파일로 요청했고, `talkcode_architecture.md`가 생성되었다.

이후 사용자는 자신이 만들려는 서비스에 MCP가 정말 필요한지 질문했다. assistant는 핵심 브릿지인 `카카오톡 ↔ Relay Server ↔ Local Agent ↔ Codex CLI`는 MCP 없이도 구현할 수 있지만, PlayMCP 공모전에 출품하고 Kakao Tools에서 호출 가능한 도구로 노출하려면 MCP Server가 필요하다고 구분했다. 즉 MCP는 Codex CLI를 조작하는 엔진이 아니라, Relay/Local Agent 기능을 PlayMCP에 공개하는 표준 인터페이스라는 설명이었다.

## 06. Server·Agent·Protocol 단위의 MVP 실행계획

사용자는 앞서 만든 아키텍처 문서를 바탕으로 MVP 구현 범위를 Server, Agent, Protocol 단위로 나누고 상세 실행계획까지 만들어 달라고 요청했다. assistant는 MVP 성공 시나리오를 로컬 tmux의 Codex CLI 실행, Local Agent attach, WebSocket 연결, 세션 조회, 프롬프트 전달, 출력 조회, 승인 감지, 카카오톡에서 승인·거절, 실제 CLI 입력 반영까지의 종단 흐름으로 정의했다.

Protocol에는 Server와 Agent가 공유하는 WebSocket envelope, 세션 상태, 터미널 이벤트, 승인 요청·응답, MCP Tool 입력·출력 스키마를 두고 런타임 validation을 적용하는 방안이 제안되었다. Agent에는 pairing, outbound WebSocket, tmux 화면 캡처, 프롬프트 입력, snapshot polling, 승인 감지, secret redaction, 재연결 기능을 포함했다. Server에는 Pairing API, Agent WebSocket Gateway, 사용자·Host·Session 매핑, Event Store, Approval Manager, MCP Endpoint와 `list_sessions`, `send_prompt`, `get_status`, `get_updates`, `get_screen_snapshot`, `respond_approval`, `interrupt_session` 등의 Tool을 포함했다.

assistant는 TypeScript 모노레포, `fake-codex` 테스트 도구, PostgreSQL, WebSocket, tmux 기반 MVP, 단계별 개발 일정도 함께 제안했다. 이 세부 기술 선택과 기간은 assistant의 구현 제안이며, 사용자가 개별 항목을 최종 확정한 것은 아니다. 사용자는 전체 실행계획을 다시 Markdown 파일로 요청했고, `talkcode_mvp_execution_plan.md`가 생성되었다.

## 07. TIV GPT audit 결과의 구조화 품질 검수

마지막 substantive 요청에서 사용자는 ChatGPT 공유 대화를 TIV 앱이 파싱·구조화한 GPT audit 파일을 첨부하고, Clean Conversation, Preference·Content Constraint·Action 분리, Decision, Open Question, Satisfaction, Topic Flow, Overview, Evidence·Trigger Phrase 품질을 실제 메시지 근거와 대조해 냉정하게 평가해 달라고 요청했다.

assistant는 전체 품질을 **66/100점**으로 평가했다. Clean Conversation과 Context/Internal 1차 분리는 비교적 잘 되었지만, 제품의 자동 구조화 결과로 바로 쓰기에는 위험하며 사람의 검토가 필요한 draft extraction 수준이라고 판단했다. 치명적 문제로는 같은 PDF 보류 문장이 `deferred`와 `excluded` 결정으로 중복 추출된 점, 중요한 기능 제외 결정이 누락된 점, Markdown 형식 선호와 실제 파일 생성 action 및 기술 질문이 하나의 preference에 섞인 점, 링크 입력 검토가 preference로 잘못 분류된 점, overview가 전체 대화보다 특정 결정과 마지막 meta request에 과도하게 끌린 점, 예시가 포함된 실제 rule-spec 요청의 confidence가 지나치게 낮아진 점, 새로운 주제 요청이 불만족·수정 요청으로 오판된 점을 지적했다.

또한 Sprint 4.5에서는 decision 중복 병합, scope exclusion 누락, preference/action/content constraint 재분류, meta request와 topic shift 처리 등을 우선 보정하고, trigger phrase 정규화와 context signal 세분화는 Sprint 5로 넘길 수 있으며, 미묘한 만족도 판정과 복합 문장 분해, overview·topic 최적화는 향후 LLMExtractor 도입 후 해결하는 것이 낫다고 분류했다.

## 현재 도달한 상태

사용자가 만들려는 제품의 핵심 방향은 특정 로컬 Codex CLI 세션을 Local Agent가 감시·조작하고, 카카오톡 또는 Kakao Tools에서 프롬프트 입력, 출력 확인, 승인·거절을 수행하는 원격 세션 브릿지로 정리되어 있다. 전체 아키텍처와 Server·Agent·Protocol 단위의 MVP 실행계획은 각각 Markdown 파일로 작성되었지만, 대화에서는 실제 구현이나 PlayMCP 등록·작동 결과까지 확인되지는 않았다. 마지막으로 진행된 작업은 TIV GPT audit 결과의 품질 검수였으며, 현재 구조화 결과는 내부 검토용으로는 사용할 수 있지만 자동 제품 결과로 쓰려면 주요 분류 규칙을 보정해야 한다는 평가에 도달했다.

[/REFERENCE_NOTE]

[EVALUATION_GUIDE]

## 반드시 포함해야 할 맥락

* 대화는 카카오 PlayMCP와 카카오 서비스 데이터를 AI가 도구로 연결하는 방식에 대한 설명에서 시작되었다.
* 사용자는 PlayMCP 공모전에 참가하며 Telegram처럼 카카오톡으로 Codex CLI를 원격 제어하는 아이디어를 제시했다.
* 사용자는 Codex API를 호출하는 서비스가 아니라, 로컬에서 실행 중인 특정 Codex CLI 세션의 입출력을 중계하는 방식이라고 명확히 수정했다.
* 하나의 Codex CLI 세션에 대응하는 전용 카카오톡 대화 맥락이 필요하며, 프롬프트 입력과 출력 확인뿐 아니라 승인·거절도 카카오톡에서 처리해야 한다고 했다.
* Local Agent는 사용자 머신에서 Codex CLI와 카카오톡 사이를 연결하는 비-AI 중계 프로그램으로 설명되었다.
* assistant는 tmux 또는 PTY 기반 Local Agent, Relay Server, MCP Server, Kakao Tools로 구성된 아키텍처와 이벤트 중심 출력 방식을 제안했다.
* 핵심 브릿지는 MCP 없이도 가능하지만 PlayMCP 공모전과 Kakao Tools 연동을 위해 MCP 인터페이스가 필요하다고 정리되었다.
* 아키텍처와 MVP 실행계획이 각각 Markdown 파일로 작성되었고, 이후 TIV GPT audit 결과는 66/100점으로 평가되며 주요 분류 오류와 Sprint별 수정 우선순위가 제시되었다.

## 주요 수정 및 방향 전환

* 카카오 생태계 데이터를 조합하는 일반 PlayMCP 이해 → 카카오톡으로 AI 코딩 에이전트를 원격 감독하는 공모전 아이디어
* 별도의 Codex API·에이전트 서비스를 호출하는 구상 → 로컬에서 이미 실행 중인 특정 Codex CLI 세션의 터미널 입출력을 중계하는 구상
* Local Agent가 새 Codex 작업을 시작하는 일반적 구조 → 세션 ID별로 기존 Codex CLI 세션에 attach하고 해당 세션만 원격 제어하는 구조
* 터미널 출력을 카카오톡에 계속 그대로 전송하는 구상 → 전체 로그는 유지하되 중요 이벤트, 화면 snapshot, 승인 요청을 중심으로 전달하는 방안
* MCP가 전체 서비스의 중심인 구조 → Relay Server와 Local Agent가 코어이고 MCP는 PlayMCP/Kakao Tools에 노출하기 위한 표준 어댑터인 구조
* 제품 아키텍처 및 MVP 설계 논의 → 마지막에는 TIV 구조화 audit 결과의 품질 검수와 parser·extractor 보정 우선순위 논의로 주제가 전환됨

## 구분해서 표현해야 할 내용

* assistant가 제안했지만 사용자가 확정하지 않은 내용: TalkCode·톡코드 등의 서비스명, TypeScript 모노레포, PostgreSQL, Zod, WebSocket, `fake-codex`, 2~3주 개발 일정, tmux polling 주기와 구체적인 데이터베이스 스키마.
* 사용자가 명시적으로 선택하거나 확정한 내용: PlayMCP 공모전에 참가한다는 점, Codex API가 아니라 로컬 Codex CLI 세션을 원격 제어한다는 점, 세션별 카카오톡 대화 맥락이 필요하다는 점, 프롬프트·출력·승인·거절을 카카오톡에서 처리한다는 점, 아키텍처와 MVP 계획을 Markdown 파일로 만들도록 요청한 점.
* 아직 해결되지 않은 내용: 실제 카카오톡/Kakao Tools에서 세션별 UI와 자동 출력 전달이 어떤 형태로 허용되는지, 실제 Codex CLI 버전별 승인 UI의 키 입력 방식, Local Agent와 PlayMCP 서버의 실제 구현·배포·테스트 결과, 최종 서비스명.
* TIV audit에 관한 확정 상태: 현재 결과가 66/100점이며 내부 검토용 draft로는 가능하지만 제품 메인 결과로 자동 사용하기에는 주요 분류 보정이 필요하다는 평가가 제시됨.

## 요약에서 주장하면 안 되는 내용

* 카카오톡이 외부 서비스에 실제 독립 채팅방을 세션마다 자동 생성해 준다고 단정해서는 안 된다.
* 카카오톡에서 Codex CLI의 raw terminal output을 제한 없이 실시간 push할 수 있다고 단정해서는 안 된다.
* TalkCode 또는 톡코드가 최종 서비스명으로 확정되었다고 표현해서는 안 된다.
* MCP가 공모전과 무관한 핵심 로컬 브릿지 구현에도 기술적으로 반드시 필요하다고 표현해서는 안 된다.
* 제안된 아키텍처와 MVP가 이미 구현·배포·검증되었다고 표현해서는 안 된다.

[/EVALUATION_GUIDE]
