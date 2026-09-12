import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet app update view")
struct PetAppUpdateViewTests {
    @Test("Update menu presents settings before checking and keeps an open panel visible")
    @MainActor
    func menuPresentationPrecedesCheck() async {
        var isShowingSettings = false
        var isPanelVisible = false
        var events: [String] = []

        for _ in 0..<2 {
            await PetAppUpdateMenuAction.perform(
                showSettings: {
                    isShowingSettings = true
                    events.append("settings")
                },
                showPanel: {
                    #expect(isShowingSettings)
                    isPanelVisible = true
                    events.append("panel")
                },
                checkForUpdates: {
                    #expect(isShowingSettings && isPanelVisible)
                    events.append("checking")
                    await Task.yield()
                    #expect(isShowingSettings && isPanelVisible)
                    events.append("result")
                }
            )
        }

        #expect(events == [
            "settings", "panel", "checking", "result",
            "settings", "panel", "checking", "result",
        ])
        #expect(isShowingSettings && isPanelVisible)
    }

    @Test("Update status and long failure details wrap in normal and narrow panels")
    @MainActor
    func rendersUpdateStates() throws {
        let update = try availableRelease()
        let longDetail = String(
            repeating: "새 버전 정보를 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요. ",
            count: 12
        )
        for width in [384.0, 260.0] {
            for dark in [false, true] {
                let compactHost = hosting(.notChecked, width: width, dark: dark)
                let longHost = hosting(.unavailable(longDetail), width: width, dark: dark)
                #expect(abs(longHost.fittingSize.width - width) < 0.01)
                #expect(longHost.fittingSize.height > compactHost.fittingSize.height + 100)

                for (name, state) in [
                    ("not-checked", PetAppUpdateState.notChecked),
                    ("checking", .checking),
                    ("up-to-date", .upToDate),
                    ("available", .available(update)),
                    ("no-published-release", .noPublishedRelease),
                    ("unavailable", .unavailable(longDetail)),
                ] {
                    let host = hosting(state, width: width, dark: dark)
                    let size = host.fittingSize
                    #expect(abs(size.width - width) < 0.01)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    if let directory = ProcessInfo.processInfo.environment["BLABEE_APP_UPDATE_RENDER_DIRECTORY"] {
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                            .appendingPathComponent("app-update-\(name)-\(Int(width))-\(dark ? "dark" : "light").png"))
                    }
                }
            }
        }
    }

    @Test("Available-update actions stack instead of truncating in narrow space")
    @MainActor
    func availableActionsAdaptToWidth() throws {
        let view = PetAppUpdateStatusView(
            state: .available(try availableRelease()),
            currentVersion: "0.1.0 (빌드 29)",
            checkForUpdates: {},
            openUpdateLocation: {}
        )
        let wide = NSHostingView(rootView: view.updateActions.frame(width: 360))
        let narrow = NSHostingView(rootView: view.updateActions.frame(width: 150))
        #expect(abs(narrow.fittingSize.width - 150) < 0.01)
        #expect(narrow.fittingSize.height > wide.fittingSize.height + 20)
    }

    private func availableRelease() throws -> PetAppUpdateRelease {
        PetAppUpdateRelease(
            version: try #require(PetAppUpdateVersion(version: "0.1.0", build: "30")),
            releaseURL: try #require(URL(string: "https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.30"))
        )
    }

    @MainActor
    private func hosting(
        _ state: PetAppUpdateState,
        width: CGFloat,
        dark: Bool
    ) -> NSHostingView<some View> {
        let view = PetAppUpdateStatusView(
            state: state,
            currentVersion: "0.1.0 (build 29)",
            checkForUpdates: {},
            openUpdateLocation: {}
        )
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
