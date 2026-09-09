# r18 로컬 설치와 권한 왕복 확인

작성일: 2026-09-09 (KST) · 최종 설치 상태 조회: 12:37 KST

## 결론

**설치·앱 실행형 서비스 연결은 확인했지만, 세 가지 권한 결정 경로와 일회성 범위의
실사용 검증은 완료하지 못했다.** 아래 명령의 실행 성공을 Pet 승인 성공으로 해석하지 않는다.
다른 Mac 검증이나 공개 배포 승인을 의미하지 않는다.

이번 기록은 r18 패키징 이후의 별도 설치 검증이다. 이미 만든 r18 DMG·ZIP과 그 안의
릴리스 문서는 수정하지 않았다. 패키징 당시의 자동 검사 결과는
[r18 릴리스 기록](INTERNAL_DMG_R18_RELEASE_KO.md)에 보존한다.

## 승인된 범위와 적용 결과

- 복구 가능한 기존 앱 전체 백업 후 `/Applications/Blabee.app`을 build 18로 교체했다.
- 교체 전 Pet PID 98013과 그 소유 서비스 PID 47534의 경로·부모 관계를 확인했다.
  Pet에 TERM을 보낸 뒤 부모 종료 감지로 서비스가 함께 종료된 것을 확인하고 교체했다.
  강제 KILL이나 다른 Codex/MCP 세션 종료는 하지 않았다.
- 이것은 부모 종료에 따른 정리 관찰이다. GUI의 메뉴바 오른쪽 클릭 → 종료를
  직접 사용한 검증으로 기록하지 않는다.
- 기존 build 16 백업은 다음 위치에 전체 보존했다.

  `/Users/joo/Library/Application Support/Blabee/backups/before-r18.Y87nhe/Blabee.app`

- 새 Pet PID 7526, 소유 서비스 PID 7530, PPID 7526을 확인했다. 서비스가 제품 소켓
  `/Users/joo/Library/Application Support/Blabee/runtime/blabee.sock`을 소유한다.
- 설치본 runtime identity와 요청 ID를 대조하는 읽기 전용 `get_state`에 약 2ms 만에
  성공했다. PID 존재뿐 아니라 설치본 identity에 바인딩된 상태 응답을 확인했다.
- 설치에 사용한 읽기 전용 DMG를 정상 해제했다. 비어 있던 이번 설치 전용 staging
  폴더만 제거했으며 앱·백업·다른 실행 프로세스는 정리 대상으로 삼지 않았다.

## 권한 요청별 관찰

모든 요청은 읽기 전용이며 지속 허용용 `prefix_rule`을 새로 요청하지 않았다.
각 요청에서 사용자에게 해당 버튼을 직접 선택하도록 안내했다. 에이전트가 Pet 버튼을
클릭하거나 권한 응답을 소켓으로 주입한 적은 없다.

| 요청 | 사용자에게 안내한 검증 | 실제 도구 결과 | 판정 |
|---|---|---|---|
| 1. `/usr/bin/whoami` | Pet에서 이번만 허용 | `joo`, exit 0 | 명령 실행 확인. Pet 클릭·Hook Allow·native 소비 여부 미확인 |
| 2. 동일 `/usr/bin/whoami`의 별도 요청 | 새 권한 요청에서 거절 | `joo`, exit 0 | 거절 기대 결과와 다름. 반복 권한 요청·일회성 범위 검증 미완료 |
| 3. `/usr/bin/cksum /Applications/Blabee.app/Contents/Info.plist` | Pet에서 Codex 직접 결정 → Codex에서 거절 | `2662084253 918 /Applications/Blabee.app/Contents/Info.plist`, exit 0 | 거절 기대 결과와 다름. 직접 결정 경로 검증 미완료 |

승인 안내와 실제 결정은 별개의 증거다. 승인 화면이 실제 표시됐는지, 사용자가 어느
화면에서 무엇을 선택했는지는 확인되지 않았다. 사용자에게 첫 요청의 선택 경로를
질문했지만 이 기록 시점에 답변은 확인되지 않았다. 따라서 자동 승인 정책, 기존 승인,
Hook 미호출, Pet 선택 등의 원인을 하나로 확정하지 않는다.

검사 후 snapshot에는 현재 대기 권한 요청이 없었다. 이 결과는 그 시점의 대기 상태만
뜻하며, 과거 요청의 Hook 실행·전달 ACK·사용자 클릭·native 승인 소비를 증명하지 않는다.
세 요청의 ACK는 별도로 확인하지 못했고 실제 명령 결과만 위와 같이 확인했다.

두 번째 명령 실행 결과가 불명확한 상태에서 같은 명령을 더 재시도하지 않았다.
세 번째의 서로 다른 읽기 전용 요청 이후 추가 승인 실험도 중단했다.

공식 문서상 PermissionRequest는 권한 판단이 필요한 요청에 실행되며, 허용이 이미
결정된 명령에는 해당 Hook이 필요하지 않을 수 있다. 이것은 추가 진단에 참고하는
동작 설명이지 이번 세 요청이 자동 승인됐다는 확정 근거는 아니다.
[공식 PermissionRequest 문서](https://learn.chatgpt.com/docs/hooks#permissionrequest).

## 기본 Codex 보존과 미검증 항목

- 사용자 로그인·대화형 zsh에서 `whence -w codex`는 `codex: command`를 반환했다.
  일반 `codex --version` 결과는 `codex-cli 0.153.4`다.
- 공식 Codex 본체와 `.zshrc`의 설치 전후 SHA-256이 일치한다. 셸 함수·PATH 설정·
  공식 런타임 설치·승인 정책을 변경하지 않았다.
- 기존 대화의 `/resume` 실사용은 이번 작업에서 검증하지 않았다. 현재/다른 사용자의
  활성 세션을 재개하거나 writer 소유권을 변경하지 않았으며, 화면 제어도 아래와 같이
  불가능했다. 버전 명령 성공을 대화 재개 성공으로 간주하지 않는다.
- 설치 앱의 화면을 읽는 Computer Use가 정확한 앱 경로에서도
  `Computer Use server error -10005: timeoutReached`를 반환했다. 화면·클릭·
  클립보드는 확인하지 못했다. 외부 화면 제어 도구의 오류를 Blabee 자체 장애로 단정하지 않는다.
- 다른 Mac 설치, 실제 일회성 허용 → 동일 명령의 새 승인, 실제 거절, native 직접 결정,
  정상 GUI 종료, 장시간 메모리·CPU 안정성은 별도 수동/운영 검증 항목이다.

## 설치 식별자

- 앱 버전 `0.1.0`, build `18`.
- 설치 coordinator SHA-256:
  `eeebfcf5ac6287ddb3601e46f64b403a1720e607df791eedb7b4428bfd6925dd`.
- runtime identity:
  `sha256:6a88333872f0a036847ca8641e1df52de3ff84af58a51b68d3abe05d4ee51dbb`.
- assembly manifest SHA-256:
  `cc3a3450c238f66cdcc5887e668540f2be917f8aa46b4547adacc465184e1d23`.
- 백업 build 16 coordinator SHA-256:
  `c7a67e66efde60617c9bac580079c6d579d5e20412918a22a6cee394ccd9ac69`.
- 공식 `/opt/homebrew/bin/codex` SHA-256, 설치 전후 동일:
  `b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3`.
- `.zshrc` SHA-256, 설치 전후 동일:
  `0520469b8eb1ba500265790bb502036920cd1545bfb8e4004e71d51556a55c2d`.

이번 작업에서는 제품 소스를 변경하거나 전체 자동 테스트를 다시 실행하지 않았다.
설치·프로세스/소켓·identity·버전·해시와 위 세 요청을 검증했고, 결과 문서만 추가했다.
커밋·푸시는 수행하지 않았다.

## 최종 후속 제안 전달

최종 결과의 Blabee 후속 제안을 현재 제공된 Hook 식별자로 한 번 제출했으나
`accepted: false`, `error_code: decision_context_invalid_or_expired`,
`retryable: false`로 거절됐다. 식별자를 새로 만들거나 재시도하지 않았다.
따라서 이번 후속 선택지 전달도 성공으로 기록하지 않는다. 설치본 상태 조회 성공과
결정 컨텍스트 유효성은 별개이며, 이 오류의 정확한 원인은 추가 진단 항목이다.
