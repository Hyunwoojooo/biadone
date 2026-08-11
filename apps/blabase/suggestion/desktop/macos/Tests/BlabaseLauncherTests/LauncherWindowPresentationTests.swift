import AppKit
import XCTest
@testable import BlabaseLauncher

@MainActor
final class LauncherWindowPresentationTests: XCTestCase {
    func testFirstShowUsesFixedContentSizeInsteadOfZeroPreLayoutFrame() {
        let contentSize = NSSize(
            width: LauncherVisualTokens.panelWidth,
            height: LauncherVisualTokens.panelHeight
        )
        let visibleFrame = NSRect(x: 0, y: 0, width: 1_470, height: 956)
        let frame = LauncherPanelPositioning.positionedFrame(
            currentFrame: .zero,
            contentSize: contentSize,
            visibleFrame: visibleFrame
        )
        let expectedOrigin = NSPoint(
            x: visibleFrame.midX - contentSize.width / 2,
            y: visibleFrame.midY - contentSize.height / 2 + 60
        )

        XCTAssertEqual(frame.origin, expectedOrigin)
        XCTAssertEqual(frame.size, contentSize)
    }

    func testPanelPositionClampsToOffsetScreenVisibleBoundary() {
        let visibleFrame = NSRect(
            x: -1_400,
            y: 25,
            width: 900,
            height: 500
        )
        let contentSize = NSSize(
            width: LauncherVisualTokens.panelWidth,
            height: LauncherVisualTokens.panelHeight
        )
        let frame = LauncherPanelPositioning.positionedFrame(
            currentFrame: NSRect(x: 999, y: 999, width: 0, height: 0),
            contentSize: contentSize,
            visibleFrame: visibleFrame
        )

        XCTAssertEqual(
            frame.origin.y,
            visibleFrame.maxY - contentSize.height
        )
        XCTAssertGreaterThanOrEqual(frame.minX, visibleFrame.minX)
        XCTAssertGreaterThanOrEqual(frame.minY, visibleFrame.minY)
        XCTAssertLessThanOrEqual(frame.maxX, visibleFrame.maxX)
        XCTAssertLessThanOrEqual(frame.maxY, visibleFrame.maxY)
    }

    func testInactivePresentationWaitsForActivationBeforeKeying() {
        var isActive = false
        var events: [String] = []
        let identity = NSObject()
        let presenter = LauncherWindowPresenter(
            applicationIsActive: { isActive },
            activateApplication: { events.append("activate") }
        )

        presenter.present(
            id: ObjectIdentifier(identity),
            orderFrontRegardless: { events.append("order-front-regardless") },
            makeKey: { events.append("make-key") }
        )

        XCTAssertEqual(events, ["order-front-regardless", "activate"])

        isActive = true
        presenter.applicationDidBecomeActive()
        presenter.applicationDidBecomeActive()

        XCTAssertEqual(
            events,
            ["order-front-regardless", "activate", "make-key"]
        )
    }

    func testDeniedActivationLeavesWindowVisibleWithoutMakingItKey() {
        var events: [String] = []
        let identity = NSObject()
        let presenter = LauncherWindowPresenter(
            applicationIsActive: { false },
            activateApplication: { events.append("activate") }
        )

        presenter.present(
            id: ObjectIdentifier(identity),
            orderFrontRegardless: { events.append("order-front-regardless") },
            makeKey: { events.append("make-key") }
        )
        presenter.applicationDidBecomeActive()

        XCTAssertEqual(events, ["order-front-regardless", "activate"])
    }

    func testCancellationPreventsStaleActivationFromKeyingWindow() {
        var isActive = false
        var keyCount = 0
        let identity = NSObject()
        let id = ObjectIdentifier(identity)
        let presenter = LauncherWindowPresenter(
            applicationIsActive: { isActive },
            activateApplication: {}
        )

        presenter.present(
            id: id,
            orderFrontRegardless: {},
            makeKey: { keyCount += 1 }
        )
        presenter.cancel(id: id)
        isActive = true
        presenter.applicationDidBecomeActive()

        XCTAssertEqual(keyCount, 0)
    }

    func testRepeatedPresentationCoalescesPendingKeyRequest() {
        var isActive = false
        var firstKeyCount = 0
        var secondKeyCount = 0
        let identity = NSObject()
        let id = ObjectIdentifier(identity)
        let presenter = LauncherWindowPresenter(
            applicationIsActive: { isActive },
            activateApplication: {}
        )

        presenter.present(
            id: id,
            orderFrontRegardless: {},
            makeKey: { firstKeyCount += 1 }
        )
        presenter.present(
            id: id,
            orderFrontRegardless: {},
            makeKey: { secondKeyCount += 1 }
        )
        isActive = true
        presenter.applicationDidBecomeActive()

        XCTAssertEqual(firstKeyCount, 0)
        XCTAssertEqual(secondKeyCount, 1)
    }

    func testStatusItemImageFallsBackToValidTemplateSymbol() throws {
        let fallback = NSImage(size: NSSize(width: 16, height: 16))
        var requestedSymbols: [String] = []

        let image = try XCTUnwrap(
            StatusItemController.makeStatusItemImage { name, _ in
                requestedSymbols.append(name)
                return name == "circle.fill" ? fallback : nil
            }
        )

        XCTAssertEqual(requestedSymbols, ["sparkles", "circle.fill"])
        XCTAssertTrue(image === fallback)
        XCTAssertTrue(image.isTemplate)
    }
}
