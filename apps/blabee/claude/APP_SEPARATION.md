# blabee-claude 독립 프로그램 기준

결정일: 2026-09-12. 사용자 결정에 따라 기존 Codex용 Blabee와 새 Claude용 Blabee를 독립 프로그램으로 구분한다. 개발 앱과 연동 코드는 구현했다. 배포 설치와 실제 Claude 대화의 최종 검증은 아직 완료하지 않았다. 현재 증거는 [QA_REPORT.md](QA_REPORT.md)를 따른다.

## 제품과 작업 범위

- `blabee-codex`: 기존 Codex용 제품을 가리키는 구분명이다. 설치된 `Blabee.app`의 이름·실행 파일·설정·데이터·서비스는 현재 상태로 유지한다.
- `blabee-claude`: 이 `claude/` 폴더에서 새로 만들 Claude Code 전용 프로그램이다. Codex용 앱이 실행 중이어도 별도로 시작·종료할 수 있어야 한다.
- 한 앱 안에서 provider를 전환하는 방식으로 시작하지 않는다. 두 제품은 각각 자신의 Pet과 세션을 관리한다.
- 독립 앱이 늘면 패키징·업데이트·테스트를 각각 관리해야 한다. 현재는 기존 Codex용 개발과 운영을 분리하는 이점이 더 크므로 이 비용을 수용한다. 코드 공통화 여부는 별도 단계에서 판단한다.

## 이름과 실행 식별자

Claude 열은 새 제품의 식별자다. 현재 개발 빌드는 앱 자식으로 서비스를 실행하며 LaunchAgent·Keychain·플러그인 설치는 등록하지 않는다.

| 항목 | 기존 Codex용 | 새 Claude용 |
| --- | --- | --- |
| 제품 구분명 | `blabee-codex` | `blabee-claude` |
| 앱 번들 | `Blabee.app` 유지 | `blabee-claude.app` |
| 화면 표시 이름 | 기존 표시 유지 | `Blabee Claude` |
| 앱 실행 파일 | `blabee-coordinator` 유지 | `blabee-claude` |
| Bundle identifier | `com.biadone.blabee` 유지 | `com.biadone.blabee.claude` |
| Coordinator 서비스 label | `com.biadone.blabee.coordinator` 유지 | 향후 설치용 `com.biadone.blabee.claude.coordinator`; 현재는 Node 자식 프로세스 |
| MCP 서버 이름 | 기존 등록 유지 | `blabee-claude`; 세션별 stdio 설정 |
| 제품 전용 환경 변수 | 기존 값 유지 | `BLABEE_CLAUDE_*` |
| 설정·로그·키 저장소 식별자 | 기존 값 유지 | `com.biadone.blabee.claude` 하위 전용 식별자 |

Pet, 메뉴, 알림에는 Claude용임을 보여준다. 설치·업데이트·종료·제거 동작도 Claude용의 정확한 식별자와 경로만 대상으로 삼는다. `blabee` 같은 공통 이름으로 프로세스를 일괄 종료하거나 기존 앱을 교체하지 않는다.

## 데이터와 중복 실행 잠금

개발용 생성물·테스트용 상태는 `claude/build/` 안에 둔다. 개발 runtime의 기준 경로는 `claude/build/runtime/blabee-claude/`로 정한다.

실제 설치 단계의 사용자 데이터 기준 경로는 `~/Library/Application Support/BlabeeClaude/`로 정한다. 지금은 이 경로에 쓰지 않는다. 개발용 임시 경로와 설치된 제품의 경로를 구분하며, 실제 배포 전 경로 길이 등 운영 조건을 검증한다.

각 runtime 안에서 다음 항목을 Claude 전용으로 관리한다.

| 항목 | Claude runtime 내 경로·규칙 |
| --- | --- |
| IPC socket | `blabee-claude.sock`; 기존 `BLABEE_SOCKET`을 자동으로 물려받지 않는다. |
| Pet 중복 실행 잠금 | `pet/instance-v1.lock`; Codex Pet의 고정 잠금을 사용하지 않는다. |
| Coordinator 잠금 | `coordinator.lock`; 기존 socket이나 알 수 없는 잠금을 자동 삭제하지 않는다. |
| 선택·세션 기록 | `journal.json`; 인증 토큰은 제외한다. 재시작 시 활성 세션·선택을 복구 실행하지 않는다. 기존 DB의 자동 복사·이관은 하지 않는다. |
| 인증·현재 상태 | UI·세션·전달 token은 메모리에만 보관한다. 기존 Codex용 값이나 Keychain을 조회하지 않는다. 설치용 저장소는 별도 단계다. |

제품별로는 중복 실행을 제어한다. **Codex 한 개와 Claude 한 개는 함께 실행 가능해야 하고, 같은 Claude runtime의 Pet을 두 번 켜면 기존 Claude 인스턴스를 안내해야 한다.** 개발 빌드의 임시 격리와 설치 제품의 사용자별 단일 인스턴스 정책은 구분해 검증한다.

Claude 연결 실패 시 Codex socket이나 서비스로 fallback하지 않는다. 통신 상대도 Claude 제품 식별자로 검증한다. 같은 기기에 설치되었다는 이유로 두 제품의 요청이나 선택을 섞지 않는다.

## 프로그램 충돌과 소스 충돌

앱·runtime 분리는 서로의 잠금·데이터·프로세스에 영향을 주는 충돌을 방지하기 위한 것이다. 두 에이전트가 같은 소스 파일을 수정하는 충돌까지 자동으로 해결하지는 않는다.

이 세션의 소스 변경은 `apps/blabee/claude/`로 제한한다. 기존 Codex용 소스는 참고만 한다. 일반 하위 폴더는 Git 브랜치를 공유하므로, 독립 브랜치에서의 커밋이 필요하면 별도 worktree를 사용한다. 기존 checkout의 브랜치나 다른 세션의 미커밋 파일은 변경하지 않는다.

## 구현 순서와 완료 조건

1. 위 식별자·경로를 사용하는 독립 앱과 빌드 골격을 만든다. 산출물은 `claude/build/`에 둔다.
2. 기존 Codex용 앱을 유지한 상태에서 Claude용 시작·종료와 잠금 분리를 검증한다.
3. [연동 조사](RESEARCH.md)에 남긴 Claude Hook·MCP·선택 반환 경로를 연결한다.
4. 두 프로그램의 동시 실행 상태에서 선택이 원래 제품과 세션에만 전달되는지 확인한다.

실제 완료 판단에는 아래 동작 증거가 필요하다. 자동 테스트에서 잠금·세션 격리와 중복 선택 차단을 검증했고 개발 앱의 실행·서비스 연결을 확인했다. 아래 전체 항목을 실제 두 제품의 사용자 흐름으로 완료했다고 간주하지 않는다.

- 두 Pet이 함께 표시되고 각각의 세션만 보여준다.
- Claude용 종료·재시작이 Codex용 PID·서비스·잠금·데이터에 영향을 주지 않는다.
- 같은 Claude runtime을 다시 열어도 Pet이나 Coordinator가 중복 생성되지 않는다.
- 오래된 선택·중복 클릭·다른 제품 또는 세션의 요청은 실행되지 않는다.
- Claude용 설치·업데이트·제거가 기존 `Blabee.app`과 그 데이터를 변경하지 않는다.

## 기존 코드 근거

이번에 직접 확인한 값은 다음과 같다. 그래프 조회와 coverage 확인이 `Transport closed`로 실패해 지정된 소스를 읽었다.

- [PetApplication.swift](../src/coordinator-swift/Sources/BlabeeCoordinator/PetApplication.swift)의 `PetProcessLease`: 사용자별 `Library/Application Support/Blabee/runtime/pet/instance-v1.lock`을 고정 사용한다. 따라서 번들 이름만 바꿔서는 동시 실행이 되지 않는다.
- [build-macos-app.mjs](../scripts/build-macos-app.mjs): 기존 앱 번들·실행 파일·Bundle identifier·서비스 label이 고정되어 있다.
- [UnixDomainSocketTransport.swift](../src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift)의 `OperationalSocketPath`와 authority 잠금: 기존 socket 기본 경로 및 사용자별 Coordinator 잠금 경로를 사용한다.
