# Blabee 내부 DMG r14 릴리스 기록

작성일: 2026-09-08
상태: fresh 빌드·패키지 무결성·자동 회귀 통과. 내부 테스트 전용, 공개 배포 미승인.

## 전달 파일

- `build/internal-dmg-20260908-r14/Blabee-0.1.0-internal-arm64-20260908-r14.dmg`
- 같은 이름의 `.dmg.sha256`
- [최신 한국어 설치 가이드](INTERNAL_TEST_INSTALL_GUIDE.md)

DMG SHA-256: `1318370593222d207435c55544260d08bf808cfb43d9155b0d772215ab48db51`

앱 버전 `0.1.0`, 내부 build `14`, exact `arm64`, 선언된 최소 macOS `13.0`.
앱은 ad-hoc 서명, DMG는 미서명·미공증이며 `public_distribution_ready=false`다.
기존 r8 DMG/PDF 대신 위 파일과 최신 `.md` 가이드를 전달한다. PDF는 이번에 갱신하지 않았다.

## 포함한 변경

- 내부 테스트용 앱 실행형 서비스: 명시적 opt-in, 앱 재실행 연결, 소유 자식 종료,
  시작·연결 실패 진단 및 수동 재시작. 기존 macOS 등록을 자동 변경하지 않는다.
- 네이티브 Codex 검증·실패 기억·명시적 재검사와 Plugin/queue 경로 연결.
  공식 Codex 실행 파일, 일반 `codex` 명령, 셸/PATH 또는 `/resume`은 교체하지 않는다.
- 선택 전달 완료·닫힘·claim의 묶음 저장 및 관련 회귀.
  전달 완료와 선택 작업의 실제 성공은 계속 다른 증거로 취급한다.
- Codex 0.153.4 Plugin CLI 호환성 및 별도 새 버전 검사 도구.
  검사 도구 성공이 운영 허용 목록 자동 확대나 관리형 승인 자격을 뜻하지 않는다.
- DMG 안의 `INTERNAL_TESTING.txt`에 한국어 설정 순서와 알려진 제한을 포함했다.

## 제작과 검증

기존 바이너리를 재사용하지 않고 `npm run build:internal-dmg`로 새 private source snapshot과
scratch에서 release 빌드했다. 다음은 기본 재현 형식이며 기존 출력은 덮어쓰지 않는다.

```sh
npm run build:internal-dmg -- \
  --build-number 14 \
  --output "$PWD/build/internal-dmg-20260908-r14/Blabee-0.1.0-internal-arm64-20260908-r14.dmg" \
  --compatible-previous-app /absolute/path/to/verified-build-13/Blabee.app \
  --compatible-previous-app /absolute/path/to/verified-build-12/Blabee.app
```

실제 제작에는 설치된 build 13과 보존한 build 12 번들을 사용했다. 새 coordinator로 서명·identity를
검사한 두 이전 런타임의 제한된 호환 정책만 포함하며, 이전 실행 파일을 DMG에 혼합하지 않는다.
재현 명령의 이전 앱 경로는 해당 검증 번들이 있는 실제 절대 경로로 바꿔야 한다.
다른 번들 또는 호환 정책을 사용하면 동일 DMG hash를 기대하지 않는다.

fresh release 입력 바이너리 SHA-256:
`76afcc2bb2d9981d4b09affa7e61f41ab9df04c773f549a7ca6144fbf4c047a1`.
이 값은 앱 ad-hoc 서명 전 입력이며, 서명된 내장 바이너리의 hash와 혼동하지 않는다.

| 검사 | 결과 | 근거 범위 |
|---|---|---|
| `npm test` | 360 통과, 실패·건너뜀 0 | 계약·Hook·영속성·패키징 fixture·검사기 회귀 |
| `npm run test:swift` | Swift Testing 668 + XCTest 5 통과 | 선택 실행하는 성능 benchmark는 별도 |
| fresh release | 통과 | 정확히 arm64, source snapshot 일치, 로컬 `/Users/` 경로 유출 검사 |
| 앱/DMG 검증 | 통과 | deep/strict 서명, build 14, readonly mount 후 앱·리소스 검증 및 정상 detach |
| DMG 루트 | 통과 | `Blabee.app`, `Applications -> /Applications`, `INTERNAL_TESTING.txt` 세 항목 |
| SHA-256 sidecar | 통과 | 게시 후 `shasum -a 256 -c`의 `OK` 재확인 |

## 실사용과 구분할 것

이번 제작 중 `/Applications/Blabee.app`을 교체하거나 재시작하지 않았다. 설치된 build 13의
실제 연결·정상 종료·재실행·단일 Codex 선택 왕복은
[별도 설치본 기록](APP_OWNED_SERVICE_PLAN_KO.md)을 따른다.
r14 DMG의 설치·업데이트·다른 Mac 왕복은 아직 검증하지 않았다.

계속 남은 사항:

- `BLB-APP-SERVICE-001`: 첫 Keychain 승인 대기와 12초 시작 기한 충돌.
- `BLB-APP-SERVICE-002`: 서비스 메모리 증가 관찰, 장시간 안정성 조사.
- `BLB-MACOS-SERVICE-001`: 기존 SMAppService 서명·자동 시작 장애.
- 새 DMG 실제 설치, 다른 Mac 최초 설치/업데이트, FIFO·권한 카드·중단 복구의 실사용 검증.

DMG는 로컬 전달 산출물이며 Git에 바이너리를 강제 추가하거나 공개 Release로 업로드하지 않는다.
기존 CI 초안, 다른 프로젝트, demo/site, 구 PDF는 이번 커밋 대상에서 제외한다.
