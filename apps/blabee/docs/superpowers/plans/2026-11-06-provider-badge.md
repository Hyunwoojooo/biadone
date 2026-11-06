# Pet 헤더 출처 배지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blabee Pet 헤더의 출처 표시를 SF Symbol에서 "도구 이름 + 도구별 틴트 캡슐 배지"로 바꿔, 팝업이 떴을 때 Codex 카드인지 Claude 카드인지 한눈에 구분되게 한다.

**Architecture:** 표시는 한 곳(`PetProviderMark`)뿐이다. `PetProvider`에 색 스킴별 `badgeTint(for:)`를 추가하고 `PetProviderMark`를 `Text` 캡슐 배지로 교체한다. 헤더(`PetView`)는 이제 효과 없는 `foregroundStyle` 한 줄만 제거한다. 새 자원 파일·빌드 스크립트 변경 없음.

**Tech Stack:** SwiftUI (macOS), Swift Testing, 기존 `Font.blabee(size:weight:)`, 기존 렌더 테스트 헬퍼(`hosting(view:size:dark:)`, `settle`, `render`).

**Spec:** 2026-11-06 대화에서 승인한 설계(요약: 아래 Global Constraints). 설계 결정은 `docs/features/UNIFIED_PROVIDER_INBOX.md`에 반영한다(Task 2).

## Global Constraints

- 공식 브랜드 로고를 번들하지 않는다. `Packaging/macos/Resources/`·`scripts/build-macos-app.mjs`·`Tests/AppPackaging`은 건드리지 않는다.
- 접근성 라벨 `"Card from <name>"`/`"<name>에서 온 카드"`, 식별자 `"provider-source-mark"`, `.help` 문구는 그대로 유지한다.
- `PetProvider.displayName`은 `"Codex"`, `"Claude"` 그대로(한국어도 동일).
- 글꼴 `.blabee(size: 11, weight: .semibold)`, 패딩 가로 8·세로 2, 모양 `Capsule()`.
- 틴트 값(정확히): Claude 라이트 글자 `0xa04b2f`, 배경 `0xc96442` 불투명도 0.16; Claude 다크 글자 `0xf0b39d`, 배경 `0xe88c6a` 0.22; Codex 라이트 글자 `0x0d7a60`, 배경 `0x10a37f` 0.16; Codex 다크 글자 `0x9fe6cf`, 배경 `0x34c8a0` 0.22.
- `app/ui`는 공통 앱 셸이다. 이 작업은 사용자가 직접 요청해 범위가 확인됐다. 다른 세션의 미커밋 변경(`app/coordination/CoordinatorOperationalApplication.swift` 등)은 건드리지 않는다.
- **commit 금지.** 이 저장소는 명시적 승인 없이 commit하지 않는다. 각 Task의 마지막은 commit 대신 `git status --short app/ui Tests/swift/BlabeePetTests docs/features`로 변경 파일만 확인한다.
- Swift 테스트는 `npm run test:swift -- --filter <정규식>`으로 돌린다. `/tmp/blabee-coordinator-swift-tests.lock`을 공유하므로 다른 세션이 돌리는 중이면 기다린다.

## Review Focus

1. 다크 모드에서 배지 글자·배경 대비 — 라이트와 같은 수준으로 읽혀야 한다. → Task 1 테스트가 라이트·다크 둘 다 렌더해 틴트 픽셀을 확인한다.
2. 카드가 없는 대기 화면에는 도구 이름이 보이면 안 된다(`displayedProvider`가 nil) — 기존 `sharedWaitingWithoutSessionPicker` 테스트가 OCR로 "codex/claude" 부재를 단언한다. → Task 2에서 그 테스트를 함께 돌려 유지됨을 확인한다.
3. 배지 글자가 잘려 `Cla…`처럼 보이면 안 된다. → Task 1 구현에 `.lineLimit(1).fixedSize()`를 넣고, 테스트가 80×32 프레임에서 두 이름이 서로 다른 비트맵으로 렌더됨을 확인한다.
4. 제품 접근 차단 상태(`isProductAccessBlocked`)에서는 배지가 숨겨진 채여야 한다 — 기존 헤더 조건 그대로. → Task 2 전체 suite 실행으로 기존 접근 차단 테스트가 유지됨을 확인한다.
5. 헤더 폭 340~380에서 상태 문구(`presentationTitle`)가 잘리지 않아야 한다. 배지는 기존 심볼(18pt)보다 약 30pt 넓다. → Task 2에서 `PetUnifiedInboxViewTests`의 카드 렌더 테스트(폭 340·380에서 OCR로 문구 확인)가 통과하는지 본다.

---

### Task 1: `PetProviderMark`를 틴트 이름 배지로 교체

**Files:**
- Modify: `app/ui/PetProviderPresentation.swift:4-37` (`PetProvider`, `PetProviderMark`)
- Test: `Tests/swift/BlabeePetTests/PetUnifiedInboxViewTests.swift:90-118` (`distinctProviderMarks`)

**Interfaces:**
- Consumes: `Font.blabee(size:weight:)` (`app/ui/PetTypography.swift`), `PetL10n.text(_:korean:)`.
- Produces:
  - `struct PetProviderBadgeTint: Equatable { let text: Color; let background: Color }` (`PetProviderPresentation.swift`)
  - `extension PetProvider { func badgeTint(for scheme: ColorScheme) -> PetProviderBadgeTint }`
  - `PetProviderMark(provider:)`는 시그니처 유지. 내부에서 `@Environment(\.colorScheme)`를 읽는다.
  - `PetProvider.symbolName`은 **삭제**한다(참조는 이 테스트뿐).

- [ ] **Step 1: 기존 `distinctProviderMarks` 테스트를 새 동작 기준으로 교체**

`Tests/swift/BlabeePetTests/PetUnifiedInboxViewTests.swift:90-118`의 테스트 전체를 아래로 바꾼다.

```swift
@Test("Provider marks are name badges with distinct tints in light and dark")
func distinctProviderMarks() async throws {
    #expect(PetProvider.codex.badgeTint(for: .light) != PetProvider.claude.badgeTint(for: .light))
    #expect(PetProvider.codex.badgeTint(for: .dark) != PetProvider.claude.badgeTint(for: .dark))
    for dark in [false, true] {
        var renderedMarks: [Data] = []
        for provider in [PetProvider.codex, .claude] {
            let size = CGSize(width: 80, height: 32)
            let view = PetProviderMark(provider: provider)
                .frame(width: size.width, height: size.height)
                .background(dark ? Color.black : Color.white)
            let (host, window) = hosting(view: AnyView(view), size: size, dark: dark)
            defer { window.contentView = nil; window.close() }
            await settle(host)
            let bitmap = try render(host, name: "source-mark-\(provider.displayName.lowercased())-\(dark ? "dark" : "light")")
            var tintedPixels = 0
            for y in 0..<bitmap.pixelsHigh {
                for x in 0..<bitmap.pixelsWide {
                    guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                    // Neutral background/ink has r ≈ g ≈ b; the badge tint does not.
                    if abs(color.redComponent - color.greenComponent) > 0.05
                        || abs(color.greenComponent - color.blueComponent) > 0.05 { tintedPixels += 1 }
                }
            }
            #expect(tintedPixels > 40, "\(provider.displayName) \(dark ? "dark" : "light"): \(tintedPixels)")
            #expect(tintedPixels < bitmap.pixelsWide * bitmap.pixelsHigh / 2)
            renderedMarks.append(try #require(bitmap.representation(using: .png, properties: [:])))
        }
        #expect(renderedMarks[0] != renderedMarks[1])
    }
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:swift -- --filter 'PetUnifiedInboxViewTests'`
Expected: 컴파일 실패 — `badgeTint(for:)` 없음 (`value of type 'PetProvider' has no member 'badgeTint'`).

- [ ] **Step 3: `PetProviderBadgeTint`와 `PetProvider.badgeTint(for:)` 구현**

`app/ui/PetProviderPresentation.swift`에서 `symbolName`을 지우고 다음을 추가한다. 색은 Global Constraints의 hex를 쓴다. `PetAirPalette.color`는 `fileprivate`이므로 이 파일에 `private static func rgb(_ hex: UInt32, opacity: Double = 1) -> Color`를 둔다.

```swift
struct PetProviderBadgeTint: Equatable {
    let text: Color
    let background: Color
}

extension PetProvider {
    /// Tool-specific tint so the source is recognizable before the name is read.
    /// Product names only; no third-party brand assets are bundled.
    func badgeTint(for scheme: ColorScheme) -> PetProviderBadgeTint
}
```

- [ ] **Step 4: `PetProviderMark` body를 캡슐 배지로 교체**

같은 파일. `@Environment(\.colorScheme) private var colorScheme` 추가. body:
`Text(provider.displayName)` → `.font(.blabee(size: 11, weight: .semibold))` → `.lineLimit(1)` → `.fixedSize()` → `.foregroundStyle(tint.text)` → `.padding(.horizontal, 8)` → `.padding(.vertical, 2)` → `.background(tint.background, in: Capsule())` → 기존 `.accessibilityLabel`·`.accessibilityIdentifier("provider-source-mark")`·`.help` 그대로. 기존 `.frame(width: 18, height: 20)`은 제거한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:swift -- --filter 'PetUnifiedInboxViewTests'`
Expected: suite 전체 PASS. `distinctProviderMarks`가 라이트·다크 4개 비트맵을 렌더하고 통과. `tintedPixels`가 40 이하로 나오면 임계값 0.05를 0.03으로 낮추되, 이유를 테스트 주석에 적는다.

- [ ] **Step 6: 변경 파일 확인(commit 아님)**

Run: `git status --short app/ui Tests/swift/BlabeePetTests`
Expected: `M app/ui/PetProviderPresentation.swift`, `M Tests/swift/BlabeePetTests/PetUnifiedInboxViewTests.swift` 두 줄만 이 Task의 변경.

---

### Task 2: 헤더 정리, 기능 문서 갱신, 회귀 확인

**Files:**
- Modify: `app/ui/PetView.swift:305-308` (헤더의 `PetProviderMark` 호출)
- Modify: `docs/features/UNIFIED_PROVIDER_INBOX.md:12-13`
- Test: `Tests/swift/BlabeePetTests/` 전체(기존 테스트, 새 테스트 없음)

**Interfaces:**
- Consumes: Task 1의 `PetProviderMark(provider:)` (자체 색을 가지므로 외부 `foregroundStyle`은 무효).
- Produces: 없음.

- [ ] **Step 1: 헤더의 무효한 `foregroundStyle` 제거**

`app/ui/PetView.swift:306-307`을 `PetProviderMark(provider: source)` 한 줄로 만든다(`.foregroundStyle(PetAirPalette.secondary(for: colorScheme))` 삭제). `colorScheme`은 헤더의 다른 곳에서도 쓰므로 변수는 남긴다.

- [ ] **Step 2: 기능 문서의 출처 표시 문단 갱신**

`docs/features/UNIFIED_PROVIDER_INBOX.md:12-13`의 두 줄을 다음으로 바꾼다.

```
- 카드 출처는 상단 이름 배지로 구별한다. Codex는 청록, Claude는 주황 틴트의 캡슐에
  도구 이름을 넣으며 접근성 이름은 도구 이름이다. 공식 브랜드 로고는 포함하지 않는다.
```

- [ ] **Step 3: Pet UI 전체 suite로 회귀 확인**

Run: `npm run test:swift -- --filter 'BlabeePetTests'`
Expected: 전체 PASS. 특히 `sharedWaitingWithoutSessionPicker`(카드 없을 때 도구 이름 부재), 카드 렌더 폭 340·380 OCR 테스트, 접근 차단 관련 테스트, `ClaudePetPresentationTests`가 유지된다. 실패가 있으면 이번 변경이 원인인지(배지 폭·OCR 문구) 기존 실패인지 구분해 기록한다.

- [ ] **Step 4: 변경 파일 확인(commit 아님)**

Run: `git status --short app/ui Tests/swift/BlabeePetTests docs/features`
Expected: Task 1의 두 파일 + `M app/ui/PetView.swift`, `M docs/features/UNIFIED_PROVIDER_INBOX.md`. 그 외 이 경로의 변경은 없어야 한다(`app/coordination`의 다른 세션 변경은 범위 밖).

- [ ] **Step 5: 실사용 확인은 후속으로 표시**

설치 앱(`/Applications/Blabee.app`)은 이번 소스 변경과 무관하다. 사용자가 요청할 때만 `build:*`/`prepare:dogfood`로 반영해 Codex·Claude 카드 헤더를 눈으로 확인한다. `docs/github/public/CHANGELOG*.md` 항목은 공유 파일이라 작업 끝에 모아 고친다.
