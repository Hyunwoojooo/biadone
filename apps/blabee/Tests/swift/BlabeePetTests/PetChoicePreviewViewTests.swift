import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet choice preview view")
struct PetChoicePreviewViewTests {
    @Test("Preview preferences render in compact light and dark panels", arguments: [
        PetChoicePreviewShortcutPreset.controlOption, .control,
    ])
    @MainActor
    func rendersPreviewPreferences(_ preset: PetChoicePreviewShortcutPreset) throws {
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in }
        let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener())
        vm.attachHotKeyRegistry(registry)
        defer { vm.stopPolling() }
        vm.beginShortcutSettings()
        vm.updatePreviewShortcutDraft(preset)
        for (width, height) in [(460.0, 680.0), (340.0, 500.0)] {
            for dark in [false, true] {
                let view = PetRootView(viewModel: vm, usesSystemGlassSurface: false)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .frame(width: width, height: height)
                    .background(dark ? Color.black : Color.white)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                host.frame = NSRect(x: 0, y: 0, width: width, height: height)
                host.layoutSubtreeIfNeeded()
                let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.effectiveAppearance.performAsCurrentDrawingAppearance {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                }
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                if let directory = ProcessInfo.processInfo.environment["BLABEE_CHOICE_PREVIEW_RENDER_DIRECTORY"] {
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    try data.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                        .appendingPathComponent("preview-settings-\(preset.rawValue)-\(Int(width))-\(dark ? "dark" : "light").png"))
                }
            }
        }
    }

    @Test("Long choice text wraps and remains readable at normal and narrow widths")
    @MainActor
    func rendersLongContent() throws {
        let shortPreview = try preview(longContent: false)
        let longPreview = try preview(longContent: true)
        for width in [396.0, 260.0] {
            for dark in [false, true] {
                let compactHost = hosting(shortPreview, width: width, dark: dark)
                let expandedHost = hosting(longPreview, width: width, dark: dark)
                let shortSize = compactHost.fittingSize
                let longSize = expandedHost.fittingSize
                #expect(abs(longSize.width - width) < 0.01)
                #expect(longSize.height > shortSize.height + 200)
                // Long content is allowed to exceed the panel's viewport height;
                // the surrounding choice-preview viewport scrolls it in full.
                #expect(longSize.height > PetPanelSizePolicy.choicePreviewSize.height)
                expandedHost.frame = NSRect(origin: .zero, size: longSize)
                expandedHost.layoutSubtreeIfNeeded()
                let bitmap = try #require(
                    expandedHost.bitmapImageRepForCachingDisplay(in: expandedHost.bounds)
                )
                expandedHost.effectiveAppearance.performAsCurrentDrawingAppearance {
                    expandedHost.cacheDisplay(in: expandedHost.bounds, to: bitmap)
                }
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)

                if let directory = ProcessInfo.processInfo.environment["BLABEE_CHOICE_PREVIEW_RENDER_DIRECTORY"] {
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    let url = URL(fileURLWithPath: directory, isDirectory: true)
                        .appendingPathComponent("choice-preview-\(Int(width))-\(dark ? "dark" : "light").png")
                    try data.write(to: url)
                }
            }
        }
    }

    private func preview(longContent: Bool) throws -> PetChoicePreview {
        let title = longContent
            ? "[자세한 내용](https://example.invalid)\n" + String(repeating: "선택하기 전에 전체 내용을 확인할 수 있는 긴 제목입니다. ", count: 4)
            : "테스트 결과 확인"
        let objective = longContent
            ? String(repeating: "변경한 동작과 검증 결과를 살펴보고 필요한 후속 작업의 범위를 확인합니다. ", count: 9)
                + "\n\n**표시된 문장 그대로** 읽을 수 있어야 합니다."
            : "변경한 동작을 확인합니다."
        let constraints = longContent
            ? [String(repeating: "기존 사용자 작업과 설정을 보존합니다. ", count: 8), "사용자가 선택하기 전에는 어떤 작업도 실행하지 않습니다."]
            : []
        let doneWhen = longContent
            ? [String(repeating: "전체 설명이 잘리지 않고 줄바꿈되어 표시됩니다. ", count: 8), "완료 기준의 마지막 문장도 읽을 수 있습니다."]
            : ["확인이 끝납니다."]
        let choice = try PetChoice(jsonObject: [
            "slot": 1,
            "kind": "recommended_action",
            "enabled": true,
            "disabled_reason": NSNull(),
            "option_id": "option_preview",
            "action_id": "action_preview",
            "action": [
                "title": title,
                "objective": objective,
                "constraints": constraints,
                "done_when": doneWhen,
            ],
        ], expectedSlot: 1)
        return PetChoicePreview(
            identity: try PetInteractionIdentity(
                jsonObject: petTestIdentityObject(PetTestCard(suffix: "preview_view"))
            ),
            choice: choice,
            shortcutPreset: .controlOption
        )
    }

    @MainActor
    private func hosting(
        _ preview: PetChoicePreview,
        width: CGFloat,
        dark: Bool
    ) -> NSHostingView<some View> {
        let view = PetChoicePreviewView(preview: preview)
            .padding(16)
            .frame(width: width, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.colorScheme, dark ? .dark : .light)
            .background(dark ? Color.black : Color.white)
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        return host
    }

}
