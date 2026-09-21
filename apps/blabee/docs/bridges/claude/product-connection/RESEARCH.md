# 제품 연결 조사 근거

확인일: 2026-09-19 KST. 소스와 Anthropic 공식 문서를 읽었으며 이 조사에서 CLI 실행·로그인·설치·기존 세션/자격 증명 조사는 하지 않았다. 아래 `관측`은 저장소의 현재 구현/기존 QA 증거이고 `결정`은 아직 구현하지 않은 [제품 설계](TECH_SPEC.md)다.

## 공식 규격

| 주제 | 확인한 사실 | 적용 결정 |
| --- | --- | --- |
| Channels 상태 | research preview이며 점진 배포. 현재 두 channel flag는 `--help`에 표시되지 않음. [Channels](https://code.claude.com/docs/en/channels#research-preview) | help 문자열만으로 지원을 판정하지 않고 검증한 버전·실제 왕복으로 자격 부여 |
| 인증 | claude.ai와 Console API key 지원. Bedrock·Google Cloud Agent Platform·Microsoft Foundry 미지원. [Channels](https://code.claude.com/docs/en/channels) | 사용자의 로그인 방식을 가정하지 않으며 미지원 환경에 자동 fallback하지 않음 |
| 조직 | Team/Enterprise는 관리자 활성화 필요. Console은 기본 허용이나 managed settings 조직은 `channelsEnabled:true` 필요. Pro/Max 개인은 조직 검사 제외. [Enterprise controls](https://code.claude.com/docs/en/channels#enterprise-controls) | 앱 시작 버튼으로 정책을 바꾸거나 승인됐다고 추정하지 않음 |
| 일반 채널 | `--channels`의 plugin은 유효 allowlist에 있어야 함. Team/Enterprise는 `allowedChannelPlugins`로 내부 plugin 승인 가능. [Preview](https://code.claude.com/docs/en/channels#research-preview) | 개인 공개 배포와 조직 배포를 별도 gate로 검증 |
| 개발 채널 | `--dangerously-load-development-channels`는 지정한 `server:`/`plugin:`의 allowlist 검사만 확인 후 우회. 조직 정책은 계속 적용. [Testing](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview) | 명시적인 개발 preview에만 사용. 정상 승인 실패 때 조용히 대체하지 않음 |
| marketplace | 일반 제출은 community 등록이며 channel allowlist가 아님. 공식 등재는 Anthropic partner contact와 조율. [Packaging](https://code.claude.com/docs/en/channels-reference#package-as-a-plugin) | 배포 플러그인 작성과 일반 사용자용 Channels 승인을 별도 작업으로 둠 |
| MCP 영구 등록 | user 설정은 `~/.claude.json`, project는 `.mcp.json`; plugin의 MCP도 설치 scope에서 연결됨. [MCP scopes](https://code.claude.com/docs/en/mcp#mcp-installation-scopes), [Plugin MCP](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers) | 등록은 tools 가용성, 이벤트 수신은 별도 상태 |
| 세션별 동의 | `.mcp.json`만으로 이벤트를 밀어 넣을 수 없고 startup channel flag가 필요. [Security](https://code.claude.com/docs/en/channels#security) | 일반 `claude`/설치 완료만으로 자동 선택 연결 약속 금지 |
| 기존 세션 | `/reload-plugins`는 지원하지만 채널 opt-in을 사후 부여하는 계약으로 명시되지 않음. [Reload](https://code.claude.com/docs/en/discover-plugins#apply-plugin-changes-without-restarting) | unprepared live session 사후 부착은 첫 제품 미지원 |
| resume/compact | CLI는 resume/continue/fork 지원. SessionStart source는 startup/resume/clear/compact/fork, compact는 자동·수동 모두. [CLI](https://code.claude.com/docs/en/cli-reference), [Hooks](https://code.claude.com/docs/en/hooks#sessionstart) | Claude 자체 기능과 Blabee 복구 지원을 구분. compact는 필수, 대화 재개 권한 복구는 후속 |
| 런타임/전달 | stdio MCP로 Channels 구현 가능하며 특정 JS runtime에 고정되지 않음. Channel 전송은 모델 claim이 아님. [Reference](https://code.claude.com/docs/en/channels-reference) | 현재 JS/SDK를 번들하되 사용자 npm 실행 제거; 독립 nonce ACK 유지 |
| MCP 협상 | v2 client에서 `auto`로 `2026-07-28`을 협상한 서버는 channel로 등록되지 않음. stdio는 unset/legacy로 이전 handshake 유지. [MCP protocol](https://code.claude.com/docs/en/mcp#push-messages-with-channels) | 실제 protocol도 자격 조합에 포함. 현재 launcher의 child-only legacy를 후보로 유지하고 다른 MCP 영향 검증 |

관리형 Console의 조직 정책과 Team/Enterprise의 custom allowlist를 같은 것으로 확대 해석하지 않는다. Blabee 자체의 공개 allowlist 승인·일정, 특정 인증/조직/CLI 조합의 실제 사용 가능성은 이 문서 조사로 확인되지 않았다. 배포할 때 위 조건을 재확인한다.

## 현재 소스와 기존 실험

| 관측 | 근거 | 제품에서 해소할 차이 |
| --- | --- | --- |
| launcher 기본 authority 1시간, 갱신 없음 | `shared-launcher.mjs:startSharedRuntime`, `ClaudeNativeSession.handle`, `ClaudeBridgeIngress.handle` — [파일 지도](CODEMAP.md) | owner에 연결된 sliding lease와 두 인증 계층의 단일 판정 |
| readiness는 probe 생성부터 300초, heartbeat 5초 | `ClaudeNativeSession.readinessLifetime/heartbeatLifetime` | 연결 수명과 구분하고 만료 이유·다시 확인 UI 제공 |
| 카드 TTL은 별도 기본 10분 | `CoordinatorRoutingApplication.expiryAfterNanoseconds` | ACK가 오래된 카드를 되살리지 않음 |
| lifetime quota 존재 | NativeSession prompt 256/selection·proposal·probe 128/poll 65,536/bridge 64, JS Channel seen 256, Pet attempted selection 128 | 시간 갱신뿐 아니라 state/중복 방지 기록 수명도 개선 |
| 설치 서비스는 static ingress만 감쌈 | `main.swift`, `ClaudeBridgeCoordinator`; native는 별도 `ClaudeNativeHost` | socket만 바꾸는 방식 불가. 동적 registry와 native lifecycle 조립 필요 |
| 공통 엔진·Pet의 실제 모델 A 왕복 성공 후 authority 만료 | [QA](../../../../dev/claude-standalone/docs/QA_REPORT.md): 2026-09-18 A claim·파일·완료 `recorded:true`, 뒤의 `claude_session_unauthorized` | 실제 성공은 새 세션 격리 실행 증거. 설치 한 앱·장시간 복구의 증거 아님 |
| Codex는 Plugin이 내부 launcher를 호출해 앱 서비스에 붙음 | `Plugin/blabee`, `OperationalCLI`, `PetAppService`, `CoordinatorOperationalApplication` — [파일 지도](CODEMAP.md) | Claude도 사용자 명령을 제품 내부 진입점으로 감출 수 있으나 provider별 Channels opt-in은 유지 |

Codex에도 카드·승인 요청 등의 기한이 있다. Codex가 모든 timeout에서 자유롭다는 뜻이 아니며 Claude 검증용의 고정 1시간 grant를 사용하는 것도 아니다.

## 결정과 대안

| 결정 | 이유 / 미채택 대안 |
| --- | --- |
| 앱 소유 공통 서비스 + per-session bridge | 한 엔진/UI 유지. 두 제품·중복 Coordinator 코드를 장기 유지하지 않음 |
| 60분 lease + 5분 owner renewal | 기존 시간 경계는 유지하면서 정상 사용 수명 연장. 단순히 TTL을 24시간/무기한으로 바꾸면 만료·종료 정리 문제를 남김 |
| 시작 1회·UI 요청 probe | 모델 수신 증거 유지. 주기적 5분 probe는 사용자 대화/모델 호출을 계속 만들기 때문에 첫 제품에서 제외 |
| 메모리 권한 + 인증된 durable metadata | 재시작 이력 확인과 실행 권한을 분리. unauthenticated JSON과 기존 v1 DB 확장은 제외 |
| 불변 session payload + 사용 중 업데이트 보류 | Node 자식에 native 앱 lease가 자동 상속된다고 가정하지 않음. wrapper kill 뒤 모듈 읽기도 보호 |
| 첫 제품은 새 세션·compact | resume/continue는 공식 기능이지만 기존 selection/claim/authority의 안전한 복구는 추가 계약·실측 필요 |

조사는 제품 구현·실제 모델 재시험·설치 앱 검증을 대신하지 않는다. 수용 검증의 단계는 [구현 계획](IMPLEMENTATION_PLAN.md)에 별도로 정의했다.


## 2026-09-21 CP-07 패키징 재확인

Node 22.23.2는 기존 22 계열을 유지하는 보안 릴리스로 선택했다. 새 주요 버전으로 변경하지 않았으며 버전·architecture·archive SHA256·전체 LICENSE를 명시한다. Node 22의 예정 지원 종료는 2027-04-30이다. [공식 릴리스](https://nodejs.org/en/blog/release/v22.23.2), [지원 일정](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json), [전체 LICENSE](https://raw.githubusercontent.com/nodejs/node/v22.23.2/LICENSE).

Channels는 여전히 research preview다. 개발용 server selector와 일반 승인된 plugin selector를 구분하며, Blabee의 공식 Channels 승인 증거는 확보하지 못했다. 관리 정책의 금지를 development flag로 우회할 수 있다고 가정하지 않는다. 현재 preview 패키지는 일반 Developer ID release 대상으로 허용하지 않는다. [Channels](https://code.claude.com/docs/en/channels), [Reference](https://code.claude.com/docs/en/channels-reference).

공식 plugin 루트의 package.json과 지원 lockfile 조합은 사용자 PATH의 npm install 경로를 유발할 수 있다. 현재 소스는 승인된 plugin을 흉내 내지 않고 앱 내부 standalone payload로 명시적으로 패키징한다. payload metadata를 plugin 루트 자동 설치 입력으로 옮기지 않는다. [Plugins reference](https://code.claude.com/docs/en/plugins-reference).

패키징 재현 명령과 실제 검증 범위는 [RUNTIME_PAYLOAD](RUNTIME_PAYLOAD.md), 통과 여부는 [TASK_STATUS](TASK_STATUS.md)를 따른다. 공식 문서 조사는 실제 Claude 모델·설치·장시간 gate의 증거가 아니다.
