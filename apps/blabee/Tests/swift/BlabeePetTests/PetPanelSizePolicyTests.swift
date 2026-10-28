import CoreGraphics
import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("BlabeePet Air panel height follows the ready artwork and two-column choice rows")
func blabeePetPanelHeightFollowsContent() {
    #expect(preferredPanelSize(actionCount: nil) == CGSize(width: 460, height: 480))
    #expect(preferredPanelSize(actionCount: 1) == CGSize(width: 460, height: 500))
    #expect(preferredPanelSize(actionCount: 2) == CGSize(width: 460, height: 500))
    #expect(preferredPanelSize(actionCount: 3) == CGSize(width: 460, height: 650))
    #expect(preferredPanelSize(actionCount: 4) == CGSize(width: 460, height: 650))
    #expect(preferredPanelSize(actionCount: 20) == preferredPanelSize(actionCount: 4))
}

@Test("BlabeePet panel uses a fixed permission screen and bounded supplementary rows")
func blabeePetPanelHeightIncludesSupplementaryRows() {
    #expect(preferredPanelSize(actionCount: nil, hasPermissionNotice: true).height == 520)
    #expect(preferredPanelSize(actionCount: 3, fifoQueueCount: 2).height == 680)
    #expect(preferredPanelSize(
        actionCount: 3,
        fifoQueueCount: 2,
        hasPermissionNotice: true
    ).height == 564)
    #expect(preferredPanelSize(
        actionCount: 20,
        fifoQueueCount: 2,
        hasPermissionNotice: true
    ).height == 564)
    #expect(preferredPanelSize(
        actionCount: nil,
        isEditingShortcuts: true,
        hasPermissionNotice: true
    ).height == 520)
    #expect(preferredPanelSize(
        actionCount: nil,
        isShowingOnboarding: true,
        hasPermissionNotice: true
    ).height == 520)
    #expect(preferredPanelSize(actionCount: nil, hasStatusMessage: true).height == 528)
    #expect(preferredPanelSize(actionCount: 3, hasStatusMessage: true).height == 680)
    #expect(preferredPanelSize(
        actionCount: 4,
        fifoQueueCount: 2,
        hasStatusMessage: true
    ).height == 680)
    #expect(preferredPanelSize(
        actionCount: 4,
        fifoQueueCount: 2,
        hasPermissionNotice: true,
        hasStatusMessage: true
    ) == CGSize(width: 460, height: 612))
    #expect(
        PetPanelSizePolicy.permissionRequestHeight
            + PetPanelSizePolicy.fifoQueueHeight
            + PetPanelSizePolicy.statusMessageHeight
            < PetPanelSizePolicy.expandedHeight
    )
}

@Test("BlabeePet reserves full height only for visible expanded content")
func blabeePetPanelHeightHonorsExpandedModes() {
    #expect(preferredPanelSize(actionCount: 3, isExpanded: true).height == 680)
    #expect(preferredPanelSize(actionCount: nil, isExpanded: true).height == 480)
    #expect(preferredPanelSize(actionCount: nil, isEditingShortcuts: true).height == 680)
    #expect(preferredPanelSize(actionCount: nil, isShowingOnboarding: true).height == 680)
}

@Test("BlabeePet keeps fixed screens static and scrolls inspectable variable content")
func blabeePetScrollPolicyIsBoundedToVariableContent() {
    #expect(!PetPanelContentPolicy.allowsScrolling(in: .ready))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .permission))
    for actionCount in 1 ... 4 {
        #expect(PetPanelContentPolicy.allowsScrolling(
            in: .decision(actionCount: actionCount)
        ))
    }
    #expect(PetPanelContentPolicy.allowsScrolling(in: .shortcutSettings))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .details))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .choicePreview))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .projectSettings))
    #expect(preferredPanelSize(
        actionCount: nil,
        hasPermissionNotice: true
    ) == CGSize(width: 460, height: 520))
}

@Test("BlabeePet Air choices wrap full titles while supporting text stays bounded")
func blabeePetCompactTextPolicyIsFixed() {
    #expect(PetPanelContentPolicy.projectNameLineLimit == 1)
    #expect(PetPanelContentPolicy.summaryLineLimit == 2)
    #expect(PetPanelContentPolicy.actionTitleLineLimit == nil)
    #expect(PetPanelContentPolicy.disabledReasonLineLimit == 1)
    #expect(PetPanelContentPolicy.statusMessageLineLimit == 2)
}

@Test("BlabeePet choice previews keep the decision width and restore its previous height", arguments: 1 ... 4)
func blabeePetChoicePreviewPanelSize(actionCount: Int) {
    let ordinarySize = preferredPanelSize(actionCount: actionCount, fifoQueueCount: 2)
    let previewSize = preferredPanelSize(
        actionCount: actionCount,
        fifoQueueCount: 2,
        isShowingChoicePreview: true
    )
    #expect(previewSize.width == ordinarySize.width)
    #expect(previewSize.height == 640)
    #expect(preferredPanelSize(
        actionCount: actionCount,
        fifoQueueCount: 2,
        isShowingChoicePreview: false
    ) == ordinarySize)
    #expect(preferredPanelSize(
        actionCount: nil,
        isShowingChoicePreview: true
    ) == PetPanelSizePolicy.compactSize)
    #expect(preferredPanelSize(
        actionCount: 0,
        isShowingChoicePreview: true
    ).width == PetPanelSizePolicy.width)
}

@Test("BlabeePet choice previews preserve permission and settings screen priority")
func blabeePetChoicePreviewPreservesScreenPriority() {
    #expect(preferredPanelSize(
        actionCount: 4,
        hasPermissionNotice: true,
        isShowingChoicePreview: true
    ) == CGSize(width: 460, height: 520))
    #expect(preferredPanelSize(
        actionCount: 4,
        isEditingShortcuts: true,
        isShowingChoicePreview: true
    ) == PetPanelSizePolicy.expandedSize)
    #expect(preferredPanelSize(
        actionCount: 4,
        isShowingOnboarding: true,
        isShowingChoicePreview: true
    ) == PetPanelSizePolicy.expandedSize)
}

@Test("BlabeePet preview transitions preserve horizontal bounds on small and offset displays", arguments: [
    CGRect(x: -900, y: 80, width: 520, height: 460),
    CGRect(x: -900, y: 80, width: 340, height: 460),
    CGRect(x: 0, y: 24, width: 1440, height: 876),
])
func blabeePetChoicePreviewFitsSmallerDisplay(visibleFrame: CGRect) {
    let statusItemFrame = CGRect(x: visibleFrame.maxX - 42, y: visibleFrame.maxY, width: 28, height: 24)
    let ordinarySize = preferredPanelSize(actionCount: 4)
    let ordinaryFrame = PetFrameClamp.belowStatusItemFrame(
        size: ordinarySize,
        statusItemFrame: statusItemFrame,
        in: visibleFrame
    )
    let previewFrame = PetFrameClamp.belowStatusItemFrame(
        size: preferredPanelSize(actionCount: 4, isShowingChoicePreview: true),
        statusItemFrame: statusItemFrame,
        in: visibleFrame
    )
    #expect(previewFrame.minX == ordinaryFrame.minX)
    #expect(previewFrame.maxX == ordinaryFrame.maxX)
    #expect(previewFrame.width == ordinaryFrame.width)
    #expect(visibleFrame.contains(previewFrame))
    #expect(previewFrame.height == min(640, visibleFrame.height))
    let restoredFrame = PetFrameClamp.belowStatusItemFrame(
        size: preferredPanelSize(actionCount: 4, isShowingChoicePreview: false),
        statusItemFrame: statusItemFrame,
        in: visibleFrame
    )
    #expect(restoredFrame == ordinaryFrame)
    #expect(PetPanelContentPolicy.allowsScrolling(in: .choicePreview))
}

@Test("Measured decisions have no arbitrary height floor and respect display bounds")
@MainActor
func blabeePetMeasuredDecisionSize() throws {
    let model = try measuredDecisionModel()
    defer { model.stopPolling() }
    let identity = try #require(PetDecisionLayoutIdentity.current(for: model, language: .english))
    let measurement = PetDecisionContentMeasurement(identity: identity, size: CGSize(width: 460, height: 382.2))
    var state = PetPanelLayoutState(
        isExpanded: false, isEditingShortcuts: false, isShowingOnboarding: false,
        actionCount: 2, fifoQueueCount: 1, hasPermissionNotice: false, hasStatusMessage: false
    )
    func size(_ state: PetPanelLayoutState, available: CGSize = CGSize(width: 1440, height: 900)) -> CGSize {
        PetPanelSizePolicy.preferredSize(for: state, decisionMeasurement: measurement,
                                        decisionIdentity: identity, availableSize: available)
    }
    #expect(size(state) == CGSize(width: 460, height: 383))
    #expect(size(state, available: CGSize(width: 460, height: 300)) == CGSize(width: 460, height: 300))
    // A narrower display must not reuse the old wrapping measurement.
    #expect(measurement.accepted(for: identity, width: 340) == nil)
    let narrower = size(state, available: CGSize(width: 340, height: 900))
    #expect(narrower.width == 340)
    #expect(narrower.height != 383)
    state = PetPanelLayoutState(
        isExpanded: true, isEditingShortcuts: false, isShowingOnboarding: false,
        actionCount: 2, fifoQueueCount: 1, hasPermissionNotice: false, hasStatusMessage: false
    )
    #expect(size(state).height == PetPanelSizePolicy.expandedHeight)
    state = PetPanelLayoutState(
        isExpanded: false, isEditingShortcuts: false, isShowingOnboarding: false,
        actionCount: 2, fifoQueueCount: 1, hasPermissionNotice: true, hasStatusMessage: false
    )
    #expect(size(state).height == PetPanelSizePolicy.permissionRequestHeight)
}

@Test("Decision measurements reject stale sessions, modes, language and invalid geometry")
@MainActor
func blabeePetMeasuredDecisionIdentity() throws {
    let model = try measuredDecisionModel()
    defer { model.stopPolling() }
    let identity = try #require(PetDecisionLayoutIdentity.current(for: model, language: .english))
    let measurement = PetDecisionContentMeasurement(identity: identity, size: CGSize(width: 460, height: 380))
    #expect(measurement.accepted(for: identity, width: 460) != nil)
    for invalidSize in [CGSize(width: 460, height: CGFloat.infinity), CGSize(width: 460, height: CGFloat.nan),
                        CGSize(width: 460, height: -1), CGSize(width: 0, height: 380)] {
        #expect(PetDecisionContentMeasurement(identity: identity, size: invalidSize)
            .accepted(for: identity, width: 460) == nil)
    }
    let sameCard = PetTestCard(suffix: "measured", millisecondsUntilExpiry: 80_000, rankedActionCount: 2)
    try model.receiveSnapshotDataForTesting(petTestData(petTestSnapshotObject(cards: [sameCard], foregroundSuffix: "measured")))
    #expect(PetDecisionLayoutIdentity.current(for: model, language: .english) == identity)
    #expect(measurement.accepted(for: PetDecisionLayoutIdentity.current(for: model, language: .korean), width: 460) == nil)
    let otherCard = PetTestCard(suffix: "other-session", rankedActionCount: 2)
    try model.receiveSnapshotDataForTesting(petTestData(petTestSnapshotObject(cards: [otherCard], foregroundSuffix: "other-session")))
    #expect(measurement.accepted(for: PetDecisionLayoutIdentity.current(for: model, language: .english), width: 460) == nil)
    model.setExpanded(true)
    #expect(PetDecisionLayoutIdentity.current(for: model, language: .english) == nil)
    #expect(measurement.accepted(for: nil, width: 460) == nil)
    model.setExpanded(false)
    model.beginShortcutSettings()
    #expect(PetDecisionLayoutIdentity.current(for: model, language: .english) == nil)
}

@MainActor
private func measuredDecisionModel() throws -> PetViewModel {
    let model = PetViewModel(
        transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
        automaticAppUpdate: AppUpdateTransactionController(store: .init(
            rootURL: FileManager.default.temporaryDirectory.appendingPathComponent("blabee-measured-panel-\(UUID().uuidString)")
        ))
    )
    let card = PetTestCard(suffix: "measured", rankedActionCount: 2)
    try model.receiveSnapshotDataForTesting(petTestData(petTestSnapshotObject(cards: [card], foregroundSuffix: "measured")))
    return model
}

private func preferredPanelSize(
    actionCount: Int?,
    isExpanded: Bool = false,
    isEditingShortcuts: Bool = false,
    isShowingOnboarding: Bool = false,
    fifoQueueCount: Int = 0,
    hasPermissionNotice: Bool = false,
    hasStatusMessage: Bool = false,
    isShowingChoicePreview: Bool = false
) -> CGSize {
    PetPanelSizePolicy.preferredSize(for: PetPanelLayoutState(
        isExpanded: isExpanded,
        isEditingShortcuts: isEditingShortcuts,
        isShowingOnboarding: isShowingOnboarding,
        actionCount: actionCount,
        fifoQueueCount: fifoQueueCount,
        hasPermissionNotice: hasPermissionNotice,
        hasStatusMessage: hasStatusMessage,
        isShowingChoicePreview: isShowingChoicePreview
    ))
}
