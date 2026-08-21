# T-005 런타임 자격 검증 하네스

이 디렉터리는 운영 코디네이터 언어를 선택하기 위한 재현 가능한 로컬 측정 슬라이스다. 제품 코디네이터나 공개 배포물이 아니다.

## 비교 경계

- Node ESM과 Swift 헬퍼만 선택 후보다.
- 두 후보는 같은 NDJSON 요청/응답, 같은 최소 이벤트 Fixture, `fsync` 뒤 성공 응답을 주는 append-only journal, 시작 시 replay를 구현한다.
- C는 M0의 `health` 전용 프로그램을 다시 컴파일해 성능 기준선으로만 측정한다. 정식 JSON journal/replay가 없으므로 어떤 수치가 나오더라도 `selection_eligible = false`다.
- 새 production dependency는 사용하지 않는다. Node 표준 라이브러리, Swift Foundation/Dispatch, macOS 기본 도구만 사용한다.

## 측정 항목

1. 새 프로세스 시작부터 첫 `health` 응답까지의 지연
2. 한 프로세스에서 지속적인 `health` IPC와 durable journal append 지연
3. 지속 부하 뒤 세 후보를 같은 `ps` 방식으로 읽은 현재 RSS; 런타임 자체 RSS는 진단 관찰값으로만 분리
4. journal event를 승인한 뒤 `SIGKILL`하고 같은 파일로 재시작하는 replay
5. 충돌로 남을 수 있는 마지막 불완전 NDJSON tail 절단과 다음 append
6. 명목상 120초 대기를 scale divisor로 축약하고 런타임·하네스 양쪽 단조 시계로 교차 검증하는 결정론적 probe
7. 구조화 로그, build version, update strategy 관찰 가능성
8. 실제 Node 런타임을 포함한 payload와 독립 Swift 실행 파일의 크기
9. 임시 복사본에 대한 ad-hoc `codesign` 및 측정용 UDZO/HFS+ DMG 생성 가능성과 크기

Developer ID identity와 공증 자격증명은 읽거나 요구하거나 변경하지 않는다. 제공되지 않은 로컬 실행에서는 Developer ID를 `unavailable`, 공증을 `not_measured`로 기록한다. 실제 업데이터도 실행하지 않으며 현재 버전과 미구현 전략이 진단 응답에 드러나는지만 확인한다.

## 실행

빠른 계약 테스트:

```bash
node --test Tests/RuntimeQualification/runtime-qualification.test.mjs
```

기본 실측(콜드 스타트 12회, 지속 health 500회, durable append 24회):

```bash
node spikes/m1/runtime-qualification/scripts/qualify-runtimes.mjs
```

부하 크기를 바꾸거나 패키징을 생략할 수 있다.

```bash
node spikes/m1/runtime-qualification/scripts/qualify-runtimes.mjs \
  --cold-iterations 3 \
  --load-iterations 100 \
  --append-iterations 8 \
  --wait-scale-divisor 12000 \
  --skip-packaging
```

`BLABEE_SWIFTC`와 `BLABEE_CC`로 컴파일러 실행 파일을 바꿀 수 있다. 모든 빌드, 서명 복사본, journal, DMG는 운영체제 임시 디렉터리에 만들고 종료 시 제거한다. Swift 모듈 캐시는 반복 실행 시간을 줄이기 위해 `/tmp/blabee-t005-swift-module-cache`에 둘 수 있으나 제품 산출물이 아니며 측정 payload 크기에 포함하지 않는다.

## 결과 해석

- 두 선택 후보가 공통 journal/replay/wait/load 검증과 ad-hoc 서명·측정용 DMG 검증을 모두 통과해야 하네스가 언어 선택을 낸다.
- Developer ID와 공증은 자격증명이 없으면 선택을 위해 가장하지 않는다. 이는 T-012 공개 배포 게이트로 남는다.
- `update_info`는 현재 build version을 진단할 수 있다는 증거일 뿐 자동 업데이트 구현 증거가 아니다.
- 이 하네스의 Swift 선택은 T-007 구현 목표를 정하는 결정이다. 네이티브 Pet, 실제 사용자 저장소 롤백, 공증된 DMG의 공개 배포 승인이 아니다.
