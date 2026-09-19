import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet usage analytics view")
struct PetUsageAnalyticsViewTests {
    @Test("Consent and collection details fit narrow and normal settings widths")
    @MainActor
    func rendersConsentDetails() throws {
        for enabled in [false, true] {
            let analytics = PetUsageAnalytics(
                isEnabled: enabled, authorization: { nil },
                store: UsageViewStore(), service: UsageViewSender()
            )
            defer { analytics.stop() }
            for width in [260.0, 384.0] {
                for dark in [false, true] {
                    let view = PetUsageAnalyticsView(analytics: analytics)
                        .padding(16)
                        .frame(width: width, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .environment(\.colorScheme, dark ? .dark : .light)
                        .background(dark ? Color.black : Color.white)
                    let host = NSHostingView(rootView: view)
                    host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    let size = host.fittingSize
                    #expect(abs(size.width - width) < 0.01)
                    #expect(size.height.isFinite && size.height > 100)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    #expect(analytics.isEnabled == enabled)
                    if let path = ProcessInfo.processInfo.environment["BLABEE_USAGE_RENDER_DIRECTORY"] {
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: path, isDirectory: true)
                            .appendingPathComponent("usage-\(enabled)-\(Int(width))-\(dark).png"))
                    }
                }
            }
        }
    }
}

@MainActor
private final class UsageViewStore: PetUsageEventStoring {
    func load() throws -> [PetUsageEvent] { [] }
    func save(_ events: [PetUsageEvent]) throws {}
    func clear() throws {}
}

@MainActor
private final class UsageViewSender: PetUsageSending {
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        Issue.record("Rendering usage settings must not send analytics")
        return .discard
    }
}
