# Claude 공통 엔진 연결 작업 현황

기준일: 2026-09-19. 사용자가 공통 본체 연결을 우선하도록 선택했고, 다른 세션의 본체 작업 완료와 현재 코드 기준 통합을 확인했다. CP-02 private 등록·registry·metadata에 이어 CP-03 같은 권한의 native/inner 연결·owner 자동 갱신을 구현하고 관련 격리 테스트를 통과했다.

| 범위 | 상태 | 근거·다음 작업 |
| --- | --- | --- |
| 공통 소스·계약 기준 사본 | 확보 | 최초 연결 기준 `build/shared-core-baseline-q6lsr39x/`, 이번 UI 연결 직전 `build/pet-integration-baseline-l3vfnr9g/`. 기존 dirty checkout의 변경을 포함한 사본이며 배포 기준점과 구분. 고정 v1 계약 12개 해시 동일 |
| 첫 공통 Swift 연결 계층 | 구현·자동 검증 완료 | 직접 local dependency, 기존 routing/SQLite 호출. [구조](SHARED_ENGINE_INTEGRATION.md) |
| 공통 엔진·브릿지 통합 검증 | 통과 | Swift core 31개, Node 공통 core 12개, native host/Hook/MCP/launcher 28개, 기존 ingress 10개. [QA](QA_REPORT.md) |
| 제품용 bridge ingress | 선택 작업 구현·자동 검증 완료 | 실제 Coordinator UDS 6개 + client 4개, Swift 인증 7개, 기존 Codex 회귀 4개 통과. [규격](PRODUCT_INGRESS.md). 자동 launcher 등록·native Hook 출처 검증과 구분 |
| 새 세션 launcher·실제 Hook/MCP | 구현·자동 검증 완료 | 전용 grant/lifetime pipe, 역할별 자격, 버전 도구·독립 ACK, 실제 공통 host 경로. [규격](NATIVE_SESSION.md). 실제 모델 통과와 구분 |
| 공통 Pet의 Claude 표시·선택 | 구현·격리 검증 완료 | 기존 UI에 provider adapter 연결. 새 Swift 13개 테스트 통과. 사용자가 실제 A 버튼 클릭 → harness claim·파일·완료·새 카드 유지 통과. 기존 화면 OCR 실패 2건은 수정 전에도 재현. [규격·실제 모델 테스트](COMMON_PET.md) |
| 실제 Claude 모델의 A 실행 | 통과 | 20:37 ACK·제안, 20:38 A claim·완료 `recorded:true`. 실제 `pet-a.txt` 내용 일치, B 없음. 완료 UI 실물의 추가 관측과 설치 앱 배포 검증은 별도. [QA](QA_REPORT.md) |
| 장시간 세션 수명 | 제품 보완 필요 | 현재 검증용 grant는 시작 후 1시간 만료. 21:24 `claude_session_unauthorized` 확인. 새 boundary로 복구되지 않으며 fresh launcher 필요. 5분 readiness와 구분 |
| Claude 제품 연결 설계 | 설계 완료·단계별 구현 중 | [설계](docs/product-connection/TECH_SPEC.md): 60분 sliding lease/5분 owner renewal, 별도 readiness, 앱 시작·공통 UI·재시작 정책. [구현 계획](docs/product-connection/IMPLEMENTATION_PLAN.md), [상태](docs/product-connection/TASK_STATUS.md) |
| CP-01A 세션 권한 상태 | 구현·관련 자동 검증 완료 | [독립 권한 API](docs/product-connection/SESSION_AUTHORITY.md). 당시 신규 14개 테스트(27개 사례), 전체 공통 Swift 45개·Node 12개, 기존 core 회귀 12개 통과. CP-02 registry가 소유하고 CP-03에서 같은 authority를 주입. 개발 launcher의 1시간 grant는 그대로 |
| CP-01B 제품 wire 계약 | 구현·관련 자동 검증 완료 | [계약과 codec](docs/product-connection/PRODUCT_WIRE.md). 새 Swift 15개, 공유 fixture 136개, 전체 공통 Swift 60개·Node 154개, 기존 v1 계약 129개 통과. 실제 인증·서비스 dispatch·전체 inner DTO 검증은 후속 |
| CP-02 공통 서비스 세션 등록 | 구현·격리 자동 검증 완료 | [private 등록·registry·metadata](docs/product-connection/SESSION_REGISTRATION.md). 신규 Swift 48개·기존 연결 Node 16개 통과. 서명/peer 검증, private FD 자격 전달, 복수 scope·Codex 유지, 오류·재시작 격리. 실제 서명된 launcher·설치 실행은 후속 |
| CP-03 세션 권한 연결·owner 갱신 | 구현·관련 격리 검증 완료 | [연결 구현](docs/product-connection/SESSION_LIFETIME.md). 등록/owner Swift 71개·Node 16개, 공통 Swift 76개·Node 154개 통과. 실제 COMMIT fence, 24시간 가짜 시계, 만료·회수·중복·복수 scope 검증. 추가 core 회귀의 제한은 [상세 상태](docs/product-connection/TASK_STATUS.md)에 기록 |
| CP-04 수명 관측·장기 상태 | 구현·관련 격리 검증 완료 | [구현 문서](docs/product-connection/SESSION_LIFECYCLE.md). compact/StopFailure, metadata v2 replay tombstone, 시간 처리·조회 cache, v2 Channel cursor와 Pet 제한 상태. 설치 client·UI 연결은 CP-05/06 |
| 설치 앱의 Claude 시작·공통 UI·패키징 | 미구현 | 서비스 등록 기반은 CP-02에 연결. 설치 launcher와 한 Pet의 Codex·복수 Claude 실제 왕복은 후속이며 설치 앱에 적용하지 않음 |
| C-L02 / C-L03 | 후속 범위 | 사용자가 공통 엔진 연결을 먼저 선택함 |

현재 `npm run app`/`npm run claude`는 기존 독립 개발 버전을 실행한다. `claude:shared`는 공통 엔진의 새 세션 전용 경로이며 `--pet`이 공통 화면을 연다. 준비된 `claude:live`는 새 `build/shared-pet-live/` 제품 빌드와 `--pet`을 사용한다. 기존 `build/shared-live/` 실행 파일과 설치 앱은 교체하지 않았다. UI는 `test:common-pet`, 연결 계층은 `test:shared-engine`, 사전 등록 ingress는 `test:product-ingress`, Hook/MCP·launcher는 `test:native-session`, private 등록·metadata·owner는 `test:product-registration`, CP-03 통합은 `test:product-lifetime`, CP-04는 `test:product-lifecycle`로 검증한다. 실제 설치 launcher의 v2 Hook/MCP·자식 관측 연결은 CP-05다.
