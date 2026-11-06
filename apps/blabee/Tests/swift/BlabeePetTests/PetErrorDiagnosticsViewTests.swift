import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet error diagnostics view")
struct PetErrorDiagnosticsViewTests {
    @Test("Independent diagnostics consent and retention text fit settings widths")
    @MainActor
    func rendersConsentDetails() throws {
        for enabled in [false, true] {
            let diagnostics = PetErrorDiagnostics(
                isEnabled: enabled, authorization: { nil },
                store: ErrorViewStore(), service: ErrorViewSender()
            )
            defer { diagnostics.stop() }
            for width in [260.0, 384.0] {
                for dark in [false, true] {
                    let view = PetErrorDiagnosticsView(diagnostics: diagnostics)
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
                    #expect(diagnostics.isEnabled == enabled)
                    if let path = ProcessInfo.processInfo.environment["BLABEE_ERROR_RENDER_DIRECTORY"] {
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: path, isDirectory: true)
                            .appendingPathComponent("errors-\(enabled)-\(Int(width))-\(dark).png"))
                    }
                }
            }
        }
    }
}

@MainActor
private final class ErrorViewStore: PetErrorEventStoring {
    func load() throws -> [PetErrorEvent] { [] }
    func save(_ events: [PetErrorEvent]) throws {}
    func clear() throws {}
}

@MainActor
private final class ErrorViewSender: PetErrorSending {
    func send(_ event: PetErrorEvent, authorization: PetUsageAuthorization) async throws -> PetErrorDelivery {
        Issue.record("Rendering diagnostic settings must not send telemetry")
        return .discard
    }
}
