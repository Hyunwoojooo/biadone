import CoreGraphics
import Testing
@testable import BlabeeCoordinator

@Test("BlabeePet panel height follows ready state and action count")
func blabeePetPanelHeightFollowsContent() {
    #expect(preferredPanelSize(actionCount: nil) == CGSize(width: 460, height: 240))
    #expect(preferredPanelSize(actionCount: 1) == CGSize(width: 460, height: 300))
    #expect(preferredPanelSize(actionCount: 2) == CGSize(width: 460, height: 354))
    #expect(preferredPanelSize(actionCount: 3) == CGSize(width: 460, height: 424))
    #expect(preferredPanelSize(actionCount: 4) == CGSize(width: 460, height: 494))
}

@Test("BlabeePet panel uses a fixed permission screen and bounded supplementary rows")
func blabeePetPanelHeightIncludesSupplementaryRows() {
    #expect(preferredPanelSize(actionCount: nil, hasPermissionNotice: true).height == 520)
    #expect(preferredPanelSize(actionCount: 3, fifoQueueCount: 2).height == 468)
    #expect(preferredPanelSize(
        actionCount: 3,
        fifoQueueCount: 2,
        hasPermissionNotice: true
    ).height == 520)
    #expect(preferredPanelSize(
        actionCount: 20,
        fifoQueueCount: 2,
        hasPermissionNotice: true
    ).height == 520)
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
    #expect(preferredPanelSize(actionCount: nil, hasStatusMessage: true).height == 288)
    #expect(preferredPanelSize(actionCount: 3, hasStatusMessage: true).height == 472)
    #expect(preferredPanelSize(
        actionCount: 4,
        fifoQueueCount: 2,
        hasPermissionNotice: true,
        hasStatusMessage: true
    ).height == 568)
    #expect(
        PetPanelSizePolicy.permissionRequestHeight
            + PetPanelSizePolicy.statusMessageHeight
            < PetPanelSizePolicy.expandedHeight
    )
}

@Test("BlabeePet reserves full height only for visible expanded content")
func blabeePetPanelHeightHonorsExpandedModes() {
    #expect(preferredPanelSize(actionCount: 3, isExpanded: true).height == 680)
    #expect(preferredPanelSize(actionCount: nil, isExpanded: true).height == 240)
    #expect(preferredPanelSize(actionCount: nil, isEditingShortcuts: true).height == 680)
    #expect(preferredPanelSize(actionCount: nil, isShowingOnboarding: true).height == 680)
}

@Test("BlabeePet keeps fixed screens static and scrolls inspectable variable content")
func blabeePetScrollPolicyIsBoundedToVariableContent() {
    #expect(!PetPanelContentPolicy.allowsScrolling(in: .ready))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .permission))
    for actionCount in 1 ... 4 {
        #expect(!PetPanelContentPolicy.allowsScrolling(
            in: .decision(actionCount: actionCount)
        ))
    }
    #expect(!PetPanelContentPolicy.allowsScrolling(in: .shortcutSettings))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .details))
    #expect(PetPanelContentPolicy.allowsScrolling(in: .projectSettings))
    #expect(preferredPanelSize(
        actionCount: nil,
        hasPermissionNotice: true
    ) == CGSize(width: 460, height: 520))
}

@Test("BlabeePet compact screens use fixed text truncation limits")
func blabeePetCompactTextPolicyIsFixed() {
    #expect(PetPanelContentPolicy.projectNameLineLimit == 1)
    #expect(PetPanelContentPolicy.summaryLineLimit == 2)
    #expect(PetPanelContentPolicy.actionTitleLineLimit == 1)
    #expect(PetPanelContentPolicy.disabledReasonLineLimit == 1)
    #expect(PetPanelContentPolicy.statusMessageLineLimit == 2)
}

private func preferredPanelSize(
    actionCount: Int?,
    isExpanded: Bool = false,
    isEditingShortcuts: Bool = false,
    isShowingOnboarding: Bool = false,
    fifoQueueCount: Int = 0,
    hasPermissionNotice: Bool = false,
    hasStatusMessage: Bool = false
) -> CGSize {
    PetPanelSizePolicy.preferredSize(for: PetPanelLayoutState(
        isExpanded: isExpanded,
        isEditingShortcuts: isEditingShortcuts,
        isShowingOnboarding: isShowingOnboarding,
        actionCount: actionCount,
        fifoQueueCount: fifoQueueCount,
        hasPermissionNotice: hasPermissionNotice,
        hasStatusMessage: hasStatusMessage
    ))
}
