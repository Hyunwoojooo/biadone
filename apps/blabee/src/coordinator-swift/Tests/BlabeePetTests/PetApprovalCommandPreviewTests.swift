import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Hook approval command preview")
struct PetApprovalCommandPreviewTests {
    @Test("A maximum-length multiline command exposes its tail through the bounded viewport")
    @MainActor
    func longCommandViewport() async throws {
        let command = maximumLengthCommand()
        #expect(command.unicodeScalars.count == 16_384)
        for width in [396.0, 260.0] {
            for dark in [false, true] {
                let view = PetApprovalCommandPreview(command: command)
                    .frame(width: width)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .background(dark ? Color.black : Color.white)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let size = host.fittingSize
                #expect(abs(size.width - width) < 0.01)
                #expect(abs(size.height - 140) < 0.01)
                host.frame = NSRect(origin: .zero, size: size)
                let window = attachOffscreen(host, size: size)
                defer { window.close() }
                await settleLayout(host)
                let scroll = try #require(scrollViews(in: host).first)
                let document = try #require(scroll.documentView)
                #expect(document.bounds.height > scroll.contentView.bounds.height * 2)
                let name = "approval-command-\(Int(width))-\(dark ? "dark" : "light")"
                let start = try render(host, name: name + "-start")
                scrollToEnd(scroll)
                await settleLayout(host)
                #expect(scroll.documentVisibleRect.height > 0)
                expectEndVisible(scroll)
                let end = try render(host, name: name + "-end")
                #expect(start != end)
            }
        }
        #expect(PetPanelSizePolicy.width == 460)
    }

    @Test("The full approval card keeps its command scroll separate from reachable action rows")
    @MainActor
    func fullApprovalCard() async throws {
        let registry = try PetHotKeyRegistry(
            backend: PetFakeHotKeyBackend(), configuration: .defaults, approvalKeyIsPressed: { _ in false }
        ) { _ in }
        let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener())
        vm.attachHotKeyRegistry(registry)
        defer { vm.stopPolling() }
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(
            cards: [], permissionRequests: [PetTestPermissionRequest(
                suffix: "long_command_render", commandPreview: maximumLengthCommand(), allowOnceAvailable: true
            )]
        ))
        vm.setPanelVisible(true)
        for dark in [false, true] {
            let view = PetRootView(viewModel: vm, usesSystemGlassSurface: false)
                .frame(width: 460, height: 520)
                .environment(\.colorScheme, dark ? .dark : .light)
                .background(dark ? Color.black : Color.white)
            let host = NSHostingView(rootView: view)
            host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            host.frame = NSRect(x: 0, y: 0, width: 460, height: 520)
            let window = attachOffscreen(host, size: host.frame.size)
            defer { window.close() }
            await settleLayout(host)
            let scrolls = scrollViews(in: host)
            #expect(scrolls.count >= 2)
            let outer = try #require(scrolls.first)
            let command = try #require(scrolls.max {
                ($0.documentView?.bounds.height ?? 0) < ($1.documentView?.bounds.height ?? 0)
            })
            #expect(command !== outer)
            #expect(command.contentView.bounds.height <= 140)
            let name = "approval-card-\(dark ? "dark" : "light")"
            _ = try render(host, name: name + "-start")
            scrollToEnd(command)
            scrollToEnd(outer)
            await settleLayout(host)
            expectEndVisible(command)
            expectEndVisible(outer)
            _ = try render(host, name: name + "-actions")
        }
    }

    private func maximumLengthCommand() -> String {
        let tail = "\nprintf '%s\\n' 'BLABEE_APPROVAL_END_MARKER_16384'\n"
        let lines = String(repeating: "printf '%s\\n' 'inspect this command before approving'\n", count: 400)
        return String(lines.prefix(16_384 - tail.unicodeScalars.count)) + tail
    }

    @MainActor
    private func attachOffscreen(_ host: NSView, size: CGSize) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
            styleMask: [.borderless], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.displayIfNeeded()
        return window
    }

    @MainActor
    private func settleLayout(_ host: NSView) async {
        for _ in 0..<5 {
            host.layoutSubtreeIfNeeded()
            host.window?.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    @MainActor
    private func scrollViews(in view: NSView) -> [NSScrollView] {
        let current = (view as? NSScrollView).map { [$0] } ?? []
        return current + view.subviews.flatMap { scrollViews(in: $0) }
    }

    @MainActor
    private func scrollToEnd(_ scroll: NSScrollView) {
        guard let document = scroll.documentView else { return }
        let y = document.isFlipped
            ? max(document.bounds.minY, document.bounds.maxY - scroll.contentView.bounds.height)
            : document.bounds.minY
        scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
        scroll.reflectScrolledClipView(scroll.contentView)
    }

    @MainActor
    private func expectEndVisible(_ scroll: NSScrollView) {
        guard let document = scroll.documentView else {
            Issue.record("The command scroll has no document view")
            return
        }
        if document.isFlipped {
            #expect(abs(scroll.documentVisibleRect.maxY - document.bounds.maxY) < 1)
        } else {
            #expect(abs(scroll.documentVisibleRect.minY - document.bounds.minY) < 1)
        }
    }

    @MainActor
    private func render(_ host: NSView, name: String) throws -> Data {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.effectiveAppearance.performAsCurrentDrawingAppearance {
            host.cacheDisplay(in: host.bounds, to: bitmap)
        }
        let data = try #require(bitmap.representation(using: .png, properties: [:]))
        if let directory = ProcessInfo.processInfo.environment["BLABEE_APPROVAL_RENDER_DIRECTORY"] {
            let folder = URL(fileURLWithPath: directory, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: folder.appendingPathComponent(name + ".png"))
        }
        return data
    }
}
