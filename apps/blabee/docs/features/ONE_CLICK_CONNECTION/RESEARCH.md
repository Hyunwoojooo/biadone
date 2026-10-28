# 최초 연결과 일반 사용자 배포 조사

확인일: 2026-09-23. 범위: 공식 문서와 현재 소스 읽기, 설계 근거 정리. 실제 Claude 로그인·세션 시작·권한 승인·공증 제출은 실행하지 않았다. 이 문서는 구현 완료나 배포 자격을 의미하지 않는다.

## Summary

목표는 설치 후 한 번 연결하면 지원되는 환경에서 평소 `codex`·`claude` 명령을 그대로 쓰는 것이다. 공통 Swift 엔진과 Pet UI를 유지하고, 앱의 설정 조립과 각 브릿지의 설치·실행 연결을 보완한다. Claude에는 자동 연결 코드가 이미 있어 이를 재사용할 수 있지만, 일반 사용자용 Channels 자격은 별도로 확보해야 한다.

## Findings

### 공식 규격에서 확인한 사실

| 사실 | 제품 설계에 미치는 영향 |
| --- | --- |
| Channels는 research preview이며 `--channels`는 Anthropic 또는 조직의 유효 allowlist를 요구한다. | 지원 여부를 단순 설치 여부로 표시하지 않는다. [공식 조건](https://code.claude.com/docs/en/channels#research-preview) |
| Team/Enterprise는 조직 활성화와 관리자의 `allowedChannelPlugins` 경로가 있다. | 조직 배포를 개인 소비자 배포와 같은 조건으로 간주하지 않는다. [조직 제어](https://code.claude.com/docs/en/channels#enterprise-controls) |
| MCP 설정 저장만으로 Channel 메시지가 들어오지 않으며 세션 시작 시 opt-in이 필요하다. | 설정 완료, 새 세션 실행, 전달 확인을 구분한다. [세션 조건](https://code.claude.com/docs/en/channels#security) |
| 자체/커뮤니티 marketplace 등록은 Channels allowlist 등록이 아니다. 공식 문서는 기존 Anthropic partner contact를 통한 조율을 안내한다. | 승인 경로·가능 여부·소요 기간을 확정하지 않는다. [Plugin 배포](https://code.claude.com/docs/en/channels-reference#package-as-a-plugin) |
| 개발용 flag는 확인 창을 거치는 테스트 경로이며 조직의 Channels 비활성화를 해제하지 않는다. | 일반 연결 실패를 개발용 모드로 조용히 전환하지 않는다. [개발 테스트](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview) |
| 표준 MCP는 Claude가 호출하는 도구이며, Channels와 같은 세션 push 기능이 아니다. | Hook·MCP 조합이 현재 전달 경험을 대체한다고 아직 주장할 수 없다. [기능 비교](https://code.claude.com/docs/en/channels#how-channels-compare) |
| Hook에는 `PermissionRequest`의 allow/deny 반환 계약이 있다. | 승인을 Hook으로 연결할 가능성과, 임의 시점의 새 선택을 같은 세션에 전달하는 문제를 분리해 검증한다. [Hook 계약](https://code.claude.com/docs/en/hooks#permissionrequest-decision-control) |
| user-scope MCP는 프로젝트를 넘어 설정할 수 있다. | 사용자가 프로젝트마다 반복 등록하는 부담을 줄일 수 있으나 이것이 Channel 활성화 증거는 아니다. [MCP scope](https://code.claude.com/docs/en/mcp#user-scope) |

### 현재 소스에서 확인한 사실

| 소스 | 현재 동작 | 계획에 반영할 점 |
| --- | --- | --- |
| [ClaudeAutoConnectSetup.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift), 4–5·509–513·600행 부근 | 원본 Claude 실행 파일을 교체하지 않고 전용 PATH shim과 소유한 `.zshrc` 구간을 관리한다. zsh만 자동 설정하며 alias/function 충돌 시 생략한다. | 최초 연결에서 이 기능을 재사용한다. 모든 셸·alias·IDE에서 동작한다고 확대하지 않는다. |
| [ClaudeAutoConnectCommand.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectCommand.swift), 24–85·88–141행 | 대화형 실행을 launcher에 연결하고 도움말·인증·스크립트 등은 원본으로 전달한다. 명시적 사용자 설정은 보존한다. | 기존 CLI 기능을 훼손하지 않고 새 터미널의 평소 명령을 지원하는 기반이다. 설정 저장과 실제 연결 성공은 다르다. |
| [ClaudeInstalledLaunchConfiguration.swift](../../../bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift), 78–90행 | 현재 시작 인수에 `--dangerously-load-development-channels server:blabee-claude`를 넣는다. | 승인된 Plugin 배포를 채택하면 일반 plugin selector와 패키징으로 전환해야 한다. shim만으로 개발 확인 창을 없앨 수 없다. |
| [build-release-dmg.mjs](../../../scripts/build-release-dmg.mjs), 26–28행 | Claude runtime 또는 내부 Claude 서명이 전달되면 공개 빌드를 거부한다. | 공개 배포 자격을 확인한 뒤 모드별 검증으로 바꿀 대상이다. |
| [notarize-dmg.mjs](../../../scripts/notarize-dmg.mjs), 167–193행 | 앱 내부 `Resources/claude` 존재 시 제출 전에 거부한다. | 현재 제한은 Blabee의 정책 코드다. Apple이 Channels를 이유로 거절한 증거가 아니다. |

지원되는 새 zsh에서 평소 `claude` 명령을 launcher로 연결하는 목표는 기존 코드에 기반한다. 이미 실행 중인 일반 Claude 세션에 사후 Channel opt-in을 추가하는 기능은 공식 문서와 이번 검토에서 검증하지 않았다. 두 경우를 하나의 “자동 연결” 완료 상태로 취급하지 않는다.

### 자동화와 사용자 확인의 경계

| 단계 | Blabee가 맡을 부분 | 사용자의 동작이 남는 경우 |
| --- | --- | --- |
| 도구 탐색·진단 | 알려진 경로 탐색, 원본 실행 파일·버전·서명·권한 확인, 오류 세분화 | 미설치 도구 설치 선택 또는 탐색 결과가 모호할 때 경로 선택 |
| 최초 연결 | 한 번의 명시적 연결 선택 뒤 서비스 준비, 소유한 설정만 병합, 백업·복구, 검증 재실행 | 계정 로그인, 실제 약관 동의, 해당 도구의 신뢰 확인 |
| 새 터미널 실행 | 지원되는 shim으로 기존 명령에 연결 인수 적용 | 이미 열린 터미널에는 새 창에서 시작하도록 안내; 미지원 셸은 앱의 새 세션 실행을 제안 |
| OS 권한 | 필요 여부 확인, 설명과 설정 바로가기, 승인 후 재검사 | 접근성 제어가 필요한 기능은 사용자가 시스템 설정에서 허용해야 한다. [Apple 안내](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac) |
| 배포 | 개발자가 앱·DMG 서명, 공증, ticket 첨부와 검증 수행 | 사용자에게 개발용 보안 설정 해제 절차를 정상 설치 방법으로 요구하지 않는다. [Apple 공증 안내](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) |

접근성·Automation 등은 실제 기능이 필요로 하는 경우에만 요청한다. 모든 Blabee 사용자가 모든 권한을 미리 허용해야 한다고 가정하지 않는다. 최초 연결 동의는 이후의 명령 실행을 일괄 승인하는 권한이 아니다.

## Options considered

| 선택 | 장점 | 제약과 확인할 일 |
| --- | --- | --- |
| 승인된 Channels Plugin + 검증된 자동 연결 | 현재 선택→같은 세션 전달 경험과 평소 명령을 함께 유지할 목표 | 개인 배포 자격은 미확보. Plugin 설치 scope, 새 세션·resume, 정책 및 충돌 환경 검증 필요 |
| 조직에서 허용한 Channels | 관리자가 정책을 제공하는 조직 내 배포 경로 | 일반 개인 사용자용 해결책으로 확대할 수 없음 |
| 개발용 Channels | 기존 구현을 테스트에 재사용 가능 | 개발 확인 절차가 남아 일반 사용자 기본 경험으로 채택하지 않음 |
| Hook·MCP 중심 대안 | 특정 승인·도구 호출 흐름에 사용할 공식 계약 존재 | 대기 중 선택·타임아웃·같은 세션 재개·중복 처리·모든 승인 유형을 작은 실험으로 입증하기 전에는 대체 경로로 확정하지 않음 |

## Recommendation

1. 현재 자동 연결과 진단 구현을 한 온보딩 흐름으로 조립한다. 연결은 provider별로 독립 실행하며 한쪽 실패가 다른 쪽 준비를 되돌리지 않게 설계한다.
2. 개인 사용자용 Claude는 승인된 Channels Plugin을 목표로 삼되, 자격 확인과 대안 타당성 조사를 독립 과제로 둔다. 외부 승인 시기를 전제로 구현 일정을 약속하지 않는다.
3. 공개 배포 guard는 단순 삭제하지 않는다. 배포 모드·Plugin 출처·지원 조합을 검증하는 조건으로 교체하고 development-preview 유입을 계속 거부한다. Apple 공증 검증은 별도 단계로 유지한다.
4. “설정 저장됨”, “다음 새 세션부터 연결”, “현재 세션 전달 확인됨”을 내부 상태로 구분한다. 사용자 화면에는 현재 필요한 한 동작만 제시한다.

## Risks / unknowns

- Blabee의 개인 배포 Channels allowlist 자격, 정식 신청 경로·시점은 확보하지 않았다. 공식 문서 확인이 승인을 의미하지 않는다.
- 새 zsh용 shim이 존재해도 모든 터미널, 셸, alias, IDE, 로그인 방식에서 동작한다는 증거는 없다.
- 기존 세션 사후 연결, 설정 변경 뒤 무중단 전환, Hook·MCP만으로 동등한 선택 전달은 미검증이다.
- 설정 성공·MCP 연결·Channel 쓰기·모델 수신·선택 claim·실제 실행은 서로 다른 증거다. 첫 연결 검사는 위험 없는 요청의 같은 세션 왕복을 포함해야 한다.
- 외부 약관·배포 권리의 법률 판단은 이 조사 범위에 포함하지 않는다.

## References

공식 문서 링크와 현재 소스 근거는 위 표에 직접 기재했다. 기존 설계의 배경은 [Claude 제품 연결 조사](../../bridges/claude/product-connection/RESEARCH.md)이며, 오래된 관측을 현재 구현 완료로 간주하지 않았다. 이번 결과는 읽기·계획 검토이며 앱 코드·설정·서비스·세션은 변경하지 않았다.
