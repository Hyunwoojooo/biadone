import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet access presentation", .petLanguage(.korean))
struct PetAccessViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Every access state wraps at normal and narrow widths in both appearances")
    @MainActor
    func rendersAccessStates() throws {
        for state in PetAccessState.allCases {
            for width in [384.0, 260.0] {
                for dark in [false, true] {
                    let view = PetAccessStatusView(state: state)
                        .padding(16)
                        .frame(width: width, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .environment(\.colorScheme, dark ? .dark : .light)
                    let host = NSHostingView(rootView: view)
                    host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    let size = host.fittingSize
                    #expect(abs(size.width - width) < 0.01)
                    #expect(size.height > 0 && size.height.isFinite)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                }
            }
        }
    }

    @Test("A blocked access screen keeps room for login and settings over queued approvals")
    func accessLayoutPrecedesApprovalAndPreview() {
        let blocked = PetPanelLayoutState(isExpanded: false, isEditingShortcuts: false,
            isShowingOnboarding: false, actionCount: 4, fifoQueueCount: 4,
            hasPermissionNotice: true, hasStatusMessage: true,
            isShowingChoicePreview: true, isProductAccessBlocked: true)
        #expect(PetPanelSizePolicy.preferredSize(for: blocked) == PetPanelSizePolicy.expandedSize)
    }

    @Test("Access denial messages distinguish account suspension, global pause, and social login")
    func distinguishesDenialReasons() {
        #expect(PetAccessState.suspended.detail.contains("이 계정"))
        #expect(PetAccessState.servicePaused.detail.contains("전체 서비스"))
        #expect(PetAccessState.socialLoginRequired.detail.contains("Google 또는 GitHub"))
        #expect(PetAccessState.expired.title != PetAccessState.signedOut.title)
    }
}
