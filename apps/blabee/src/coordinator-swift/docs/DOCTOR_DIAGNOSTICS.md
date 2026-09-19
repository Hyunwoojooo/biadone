# Doctor 진단 기준과 출력

일반 Blabee Plugin 연결은 전체 관리형 Codex 패키지를 요구하지 않는다. Doctor는
검사 기준을 `plugin`과 `managed`로 나누며, 기본값은 `plugin`이다.

```sh
# 일반 Plugin 연결의 정적 진단
/Applications/Blabee.app/Contents/MacOS/blabee-coordinator doctor \
  --plugin /absolute/path/to/blabee/plugin --project /absolute/project --json

# 특정 CLI를 검사할 때
/Applications/Blabee.app/Contents/MacOS/blabee-coordinator doctor \
  --profile plugin --codex /absolute/path/to/codex --json

# 관리형 App Server 실행에 사용할 전체 공식 패키지의 정적 진단
/Applications/Blabee.app/Contents/MacOS/blabee-coordinator doctor \
  --profile managed --codex /absolute/package/bin/codex --json
```

기존 `--app`, `--plugin`, `--socket`, `--project`, `--codex`, `--json` 옵션은
그대로 사용할 수 있다. `--profile`에는 `plugin` 또는 `managed`를 한 번만 지정한다.
경로 옵션은 절대 경로만 받는다.

## Profile별 의미

| 항목 | `plugin` 기본값 | `managed` 명시 선택 |
| --- | --- | --- |
| Codex 후보 | 실제 Plugin 연결과 같은 PATH·표준 설치·사용자 설치 후보 순서 | PATH의 첫 실행 가능한 `codex` |
| 경로 신뢰 | 해석 전 source와 해석 후 파일의 소유권·권한·링크 등을 검사 | 기존 전체 패키지 검사 기준 유지 |
| 서명·해시 | 실제 Plugin 연결의 공식 서명과 기존 pinned-hash 예외를 공유 | 기존 번들 서명·아키텍처·정확한 fingerprint 기준 유지 |
| 전체 패키지 구조 | 검사하지 않음 | manifest, 본체, code-mode host, `rg`, 리소스를 검사 |
| 버전 지원 | Plugin CLI 지원 목록 사용. 등록된 해시로 버전을 알 수 없는 경우 미확인 | 관리형 버전 지원 목록과 전체 번들 catalog 사용 |
| code-mode | 진단 항목에 포함하지 않음 | 정적 조건과 별도로 실제 실행 시험 필요 |

`--codex`를 지정하면 해당 source 하나만 검사한다. 다른 설치본으로 조용히 대체하지
않는다. 자동 Plugin 탐색에서는 정적 신뢰 검사를 통과하지 못한 후보 다음의 설치본을
확인한다. 어느 후보도 통과하지 못하면 첫 검사 실패와 그 경로를 보고한다.
정적 검사 후보가 실제 live 검사에서 최종 선택될 실행 파일이라고 보장하지는 않는다.
실제 버전과 공증 등 live 단계의 결과에 따라 선택이 달라질 수 있다.

두 profile 모두 Codex, `codex --version`, Plugin 목록 명령, Hook App Server를
실행하지 않는다. Codex 설정이나 런타임 복사본을 만들거나 변경하지 않으며, 기존
Blabee 서비스에는 읽기 전용 상태 요청만 보낸다. 정적 검사는 실행 허가나 live 신뢰
자격을 만들지 않는다.

## 결과 읽기

- `fail`: 해당 검사에서 거부 조건을 확인했다. CLI 전체가 고장 났다는 의미로 확대하지 않는다.
- `action_required`: 정적 검사만으로 확인할 수 없거나 선행 항목을 먼저 해결해야 한다.
- `pass`: 해당 항목이 명시한 정적 조건을 확인했다. 실제 Plugin 활성이나 왕복 동작의 증거는 아니다.

관리형 package 구조가 실패하면 layout 항목이 최초 실패이며, identity·버전·code-mode는
`action_required`와 `blocked_by`로 해당 layout 항목을 가리킨다. 반대로 manifest를 이미
확인한 상태라면 버전 미지원과 미등록/불일치 fingerprint는 서로 독립된 결과로 남는다.
검사 자체를 끝내지 못한 경우에는 `unverified`/`unavailable`과 `action_required`를 사용한다.

예를 들어 code-mode host가 없으면 다음과 같은 결과가 나온다.

```json
{
  "id": "codex_runtime_layout",
  "status": "fail",
  "code": "codex_runtime_layout_invalid",
  "summary": "관리형 Codex package 구조가 올바르지 않습니다. 전체 공식 패키지의 bin/codex를 --codex로 지정하세요.",
  "detail": "Codex runtime bundle layout is invalid: bin must contain only codex and codex-code-mode-host"
}
```

해당 실패 때문에 identity를 확인하지 못한 항목에는
`"blocked_by": "codex_runtime_layout"`이 붙는다. 상태를 집계할 때는 오류 코드의
문구만 보지 말고 `status`와 `blocked_by`를 함께 읽는다.

JSON은 기존 schema `1.0`과 `checks[].id/status/code/summary`를 유지하고 다음 필드를
추가한다.

- `profile`: `plugin` 또는 `managed`.
- `codex_selection.source_path`: 검사한 원래 경로. 찾지 못했으면 `null`.
- `codex_selection.resolved_path`: 검사한 파일의 심볼릭 링크 해석 경로. 확인하지 못했으면 `null`.
- `codex_selection.origin`: `explicit` 또는 `discovery`.
- `codex_selection.evidence`: `static_only`.
- `checks[].detail`: 최초 거부 사유 또는 정적 버전 증거가 있을 때만 포함.
- `checks[].blocked_by`: 선행 확인 때문에 미확인인 항목에만 포함.

경로는 진단 대상으로 선택한 로컬 설치 경로이며, 사람용 출력에서는 줄바꿈·터미널
제어문자를 이스케이프한다. JSON에는 원래 값이 JSON 문자열로 보존된다.
종료 코드는 `fail`이 하나라도 있으면 `1`, 그렇지 않고 `action_required`가 있으면 `2`,
모두 통과하면 `0`이다. 기본 정적 Doctor는 실제 Plugin/Hook 활성 상태를 확정하지 않으므로
정상 설치에서도 `action_required`가 남을 수 있다.
