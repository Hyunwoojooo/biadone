import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("BlabeePet strictly parses operational state and packet detail")
func blabeePetStrictModelParsing() throws {
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: [PetTestCard(suffix: "strict", rollbackEnabled: true)],
        foregroundSuffix: "strict",
        permissionRequests: [PetTestPermissionRequest(suffix: "strict")],
        permissionNoticeCount: 2
    ))
    #expect(snapshot.projects.count == 1)
    #expect(snapshot.sessions.count == 1)
    #expect(snapshot.interactions.count == 1)
    #expect(snapshot.routing.foreground == snapshot.interactions[0].identity)
    #expect(snapshot.interactions[0].outcome?.status == "completed")
    #expect(snapshot.interactions[0].reportedSideEffects.count == 1)
    #expect(snapshot.interactions[0].evidence.first?.source == "local_verified")
    #expect(snapshot.interactions[0].checkpoint.isRecoveryCapable)
    #expect(snapshot.permissionRequests.count == 1)
    #expect(snapshot.permissionRequests[0].toolName == "Bash")
    #expect(snapshot.permissionRequests[0].commandPreview == "npm test")
    #expect(PetPermissionRequest.maximumCommandScalars == 120)

    var unknownTopLevel = petTestSnapshotObject(cards: [PetTestCard(suffix: "unknown")])
    unknownTopLevel["unexpected"] = true
    var rejectedUnknown = false
    do {
        _ = try PetSnapshot.parse(petTestData(unknownTopLevel))
    } catch {
        rejectedUnknown = true
    }
    #expect(rejectedUnknown)

    var unknownRisk = petTestSnapshotObject(cards: [PetTestCard(suffix: "risk")])
    var interactions = try #require(unknownRisk["interactions"] as? [[String: Any]])
    interactions[0]["risk"] = ["level": "surprise", "reasons": []]
    unknownRisk["interactions"] = interactions
    var rejectedRisk = false
    do {
        _ = try PetSnapshot.parse(petTestData(unknownRisk))
    } catch {
        rejectedRisk = true
    }
    #expect(rejectedRisk)
}

@Test("BlabeePet strictly joins and orders permission requests")
func blabeePetPermissionRequestParsing() throws {
    let first = PetTestPermissionRequest(suffix: "permission_a")
    let second = PetTestPermissionRequest(
        suffix: "permission_b",
        toolName: "mcp__server__tool",
        requestDescription: nil,
        commandPreview: "safe command"
    )
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: [],
        permissionRequests: [first, second],
        permissionNoticeCount: 2
    ))
    #expect(snapshot.permissionRequests.map(\.requestID) == [
        "permission_permission_a", "permission_permission_b",
    ])
    #expect(snapshot.permissionRequests[1].displaySummary == "safe command")
    #expect(PetPermissionDecision.allCases.map(\.displayTitle) == [
        "거절", "Codex에서 직접 결정",
    ])

    var mismatched = petTestSnapshotObject(
        cards: [],
        permissionRequests: [first]
    )
    var requests = try #require(
        mismatched["permission_requests"] as? [[String: Any]]
    )
    requests[0]["turn_id"] = "turn_other"
    mismatched["permission_requests"] = requests
    #expect(throws: (any Error).self) {
        _ = try PetSnapshot.parse(petTestData(mismatched))
    }

    var missingCommand = petTestSnapshotObject(
        cards: [],
        permissionRequests: [first]
    )
    var commandlessRequests = try #require(
        missingCommand["permission_requests"] as? [[String: Any]]
    )
    commandlessRequests[0]["command_preview"] = NSNull()
    missingCommand["permission_requests"] = commandlessRequests
    #expect(throws: (any Error).self) {
        _ = try PetSnapshot.parse(petTestData(missingCommand))
    }

    for unsafeCommand in [
        "printf first\nsecond",
        "echo safe\u{202e}txt",
        String(repeating: "x", count: 121),
    ] {
        var unsafe = petTestSnapshotObject(
            cards: [],
            permissionRequests: [first]
        )
        var unsafeRequests = try #require(
            unsafe["permission_requests"] as? [[String: Any]]
        )
        unsafeRequests[0]["command_preview"] = unsafeCommand
        unsafe["permission_requests"] = unsafeRequests
        #expect(throws: (any Error).self) {
            _ = try PetSnapshot.parse(petTestData(unsafe))
        }
    }
}

@Test("BlabeePet parses managed approvals independently from Hook sessions")
func blabeePetManagedCommandApprovalParsing() throws {
    let first = PetTestManagedCommandApproval(
        suffix: "managed_first",
        jsonRPCRequestID: .string("rpc-managed-first")
    )
    let second = PetTestManagedCommandApproval(
        suffix: "managed_second",
        jsonRPCRequestID: .integer(Int64.max),
        approvalID: nil,
        allowOnceAvailable: false
    )
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [first, second],
        managedCommandApprovalNoticeCount: 2
    ))
    #expect(snapshot.projects.isEmpty)
    #expect(snapshot.sessions.isEmpty)
    #expect(snapshot.managedCommandApprovals.map(\.managedRequestID) == [
        "managed_request_managed_first", "managed_request_managed_second",
    ])
    #expect(snapshot.managedCommandApprovals[0].jsonRPCRequestID
        == .string("rpc-managed-first"))
    #expect(snapshot.managedCommandApprovals[1].jsonRPCRequestID
        == .integer(Int64.max))
    #expect(snapshot.managedCommandApprovals[1].approvalID == nil)
    #expect(snapshot.managedCommandApprovals[0].environmentID == "local")
    #expect(!snapshot.managedCommandApprovals[1].allowOnceAvailable)
    #expect(PetManagedCommandApprovalDecision.allCases.map(\.displayTitle) == [
        "이번만 허용", "거절", "Codex에서 직접 결정",
    ])
    #expect(!PetManagedCommandApprovalDecision.allCases.map(\.rawValue)
        .contains("acceptForSession"))

    var unsafe = petTestSnapshotObject(
        cards: [],
        managedCommandApprovals: [first]
    )
    var approvals = try #require(
        unsafe["managed_command_approvals"] as? [[String: Any]]
    )
    approvals[0]["command_preview"] = "echo safe\u{202e}txt"
    unsafe["managed_command_approvals"] = approvals
    #expect(throws: (any Error).self) {
        _ = try PetSnapshot.parse(petTestData(unsafe))
    }
}

@Test("BlabeePet preserves private tmp cwd through managed approval resolution")
func blabeePetManagedCommandApprovalPreservesPrivateTmpCWD() throws {
    let request = PetTestManagedCommandApproval(suffix: "private_tmp")
    let directoryName = "blabee-pet-private-tmp-\(UUID().uuidString.lowercased())"
    let canonicalCWD = "/tmp/\(directoryName)"
    let privateCWD = "/private\(canonicalCWD)"
    try FileManager.default.createDirectory(
        atPath: canonicalCWD,
        withIntermediateDirectories: false
    )
    defer { try? FileManager.default.removeItem(atPath: canonicalCWD) }
    #expect(
        URL(fileURLWithPath: privateCWD).standardizedFileURL.path
            == canonicalCWD
    )

    var object = petTestSnapshotObject(
        cards: [],
        managedCommandApprovals: [request],
        managedCommandApprovalNoticeCount: 1
    )
    var approvals = try #require(
        object["managed_command_approvals"] as? [[String: Any]]
    )
    approvals[0]["cwd"] = privateCWD
    object["managed_command_approvals"] = approvals

    let snapshot = try PetSnapshot.parse(petTestData(object))
    let parsedRequest = try #require(snapshot.managedCommandApprovals.first)
    #expect(parsedRequest.cwd == privateCWD)
    let resolution = try PetManagedCommandApprovalResolutionRequest(
        request: parsedRequest,
        responseID: "response_private_tmp",
        decision: .acceptOnce
    )
    #expect(resolution.jsonObject["cwd"] as? String == privateCWD)

    approvals[0]["cwd"] = "/"
    object["managed_command_approvals"] = approvals
    #expect(
        try PetSnapshot.parse(petTestData(object))
            .managedCommandApprovals.first?.cwd == "/"
    )
}

@Test("BlabeePet rejects unsafe managed approval cwd values")
func blabeePetManagedCommandApprovalRejectsUnsafeCWD() throws {
    let request = PetTestManagedCommandApproval(suffix: "unsafe_cwd")
    let unsafePaths = [
        "/tmp/blabee-managed/./cwd",
        "/tmp/blabee-managed/../cwd",
        "tmp/blabee-managed-relative",
        "/tmp/blabee-managed//cwd",
        "/tmp/blabee-managed/cwd/",
        "/tmp/blabee-managed\nspoofed",
        "/tmp/cafe\u{301}",
        "/tmp/blabee\u{200b}hidden",
    ]
    for cwd in unsafePaths {
        var object = petTestSnapshotObject(
            cards: [],
            managedCommandApprovals: [request],
            managedCommandApprovalNoticeCount: 1
        )
        var approvals = try #require(
            object["managed_command_approvals"] as? [[String: Any]]
        )
        approvals[0]["cwd"] = cwd
        object["managed_command_approvals"] = approvals
        #expect(throws: (any Error).self) {
            _ = try PetSnapshot.parse(petTestData(object))
        }
    }
}

@Test("BlabeePet distinguishes ranked actions from the legacy fixed choices")
func blabeePetRankedAndLegacyChoiceShapes() throws {
    for count in 2...4 {
        let snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: [PetTestCard(
            suffix: "ranked_\(count)",
            rankedActionCount: count
        )]))
        let interaction = try #require(snapshot.interactions.first)
        #expect(interaction.usesRankedNextActions)
        #expect(interaction.actionChoices.count == count)
        #expect(interaction.legacyPauseChoice == nil)
    }

    let legacy = try PetSnapshot.parse(petTestSnapshotData(cards: [PetTestCard(
        suffix: "legacy_choices"
    )]))
    let legacyInteraction = try #require(legacy.interactions.first)
    #expect(!legacyInteraction.usesRankedNextActions)
    #expect(legacyInteraction.legacyPauseChoice?.slot == 3)
    #expect(legacyInteraction.legacyRollbackChoice?.slot == 4)

    var hybrid = petTestSnapshotObject(cards: [PetTestCard(suffix: "hybrid")])
    var interactions = try #require(hybrid["interactions"] as? [[String: Any]])
    var choices = try #require(interactions[0]["choices"] as? [[String: Any]])
    choices.removeLast()
    interactions[0]["choices"] = choices
    hybrid["interactions"] = interactions
    var rejectedHybrid = false
    do {
        _ = try PetSnapshot.parse(petTestData(hybrid))
    } catch {
        rejectedHybrid = true
    }
    #expect(rejectedHybrid)

    var disabledRanked = petTestSnapshotObject(cards: [PetTestCard(
        suffix: "disabled_ranked",
        alternativeEnabled: false
    )])
    var disabledInteractions = try #require(
        disabledRanked["interactions"] as? [[String: Any]]
    )
    var disabledChoices = try #require(
        disabledInteractions[0]["choices"] as? [[String: Any]]
    )
    disabledChoices.removeLast(2)
    disabledInteractions[0]["choices"] = disabledChoices
    disabledRanked["interactions"] = disabledInteractions
    var rejectedDisabledRanked = false
    do {
        _ = try PetSnapshot.parse(petTestData(disabledRanked))
    } catch {
        rejectedDisabledRanked = true
    }
    #expect(rejectedDisabledRanked)
}

@Test("BlabeePet rejects routing joins that differ by any immutable identity field")
func blabeePetExactRoutingJoin() throws {
    var object = petTestSnapshotObject(
        cards: [PetTestCard(suffix: "join")],
        foregroundSuffix: "join"
    )
    var routing = try #require(object["routing"] as? [String: Any])
    var pending = try #require(routing["pending"] as? [[String: Any]])
    pending[0]["revision"] = 2
    routing["pending"] = pending
    object["routing"] = routing

    var rejected = false
    do {
        _ = try PetSnapshot.parse(petTestData(object))
    } catch {
        rejected = true
    }
    #expect(rejected)
}

@Test("BlabeePet uses routing order and requires a bijective pending join")
func blabeePetRoutingOrderAndReverseJoin() throws {
    let cardA = PetTestCard(suffix: "order_a")
    let cardB = PetTestCard(suffix: "order_b")
    var object = petTestSnapshotObject(cards: [cardA, cardB])
    var interactions = try #require(object["interactions"] as? [[String: Any]])
    interactions.reverse()
    object["interactions"] = interactions

    let snapshot = try PetSnapshot.parse(petTestData(object))
    #expect(snapshot.interactions.map(\.identity.interactionID) == [
        "interaction_order_a", "interaction_order_b",
    ])

    object["interactions"] = [interactions[0]]
    var rejectedMissingInteraction = false
    do {
        _ = try PetSnapshot.parse(petTestData(object))
    } catch {
        rejectedMissingInteraction = true
    }
    #expect(rejectedMissingInteraction)
}

@Test("BlabeePet rejects numeric booleans at snapshot and response boundaries")
func blabeePetRejectsNumericBooleans() throws {
    let numericBooleans: [NSNumber] = [
        NSNumber(value: 0), NSNumber(value: 1),
        NSNumber(value: 0.0), NSNumber(value: 1.0),
    ]
    for numericBoolean in numericBooleans {
        var snapshotObject = petTestSnapshotObject(cards: [PetTestCard(suffix: "bool")])
        var projects = try #require(snapshotObject["projects"] as? [[String: Any]])
        projects[0]["enabled"] = numericBoolean
        snapshotObject["projects"] = projects
        var rejectedSnapshot = false
        do {
            _ = try PetSnapshot.parse(petTestData(snapshotObject))
        } catch {
            rejectedSnapshot = true
        }
        #expect(rejectedSnapshot)

        var rejectedFocus = false
        do {
            try PetTransportResponse.requireFocused(petTestData(["focused": numericBoolean]))
        } catch {
            rejectedFocus = true
        }
        #expect(rejectedFocus)

        var rejectedSelection = false
        do {
            _ = try PetTransportResponse.requireAcceptedSelection(petTestData([
                "accepted": numericBoolean,
                "outcome": ["kind": "pause"],
            ]))
        } catch {
            rejectedSelection = true
        }
        #expect(rejectedSelection)

        var rejectedPermission = false
        do {
            try PetTransportResponse.requireResolvedPermission(
                petTestData([
                    "resolved": numericBoolean,
                    "request_id": "permission_numeric",
                    "response_id": "permission_response_numeric",
                    "decision": "deny",
                ]),
                requestID: "permission_numeric",
                responseID: "permission_response_numeric",
                expectedDecision: .deny
            )
        } catch {
            rejectedPermission = true
        }
        #expect(rejectedPermission)
    }
}

@Test("BlabeePet accepts only pause or an acknowledged next-turn queue receipt")
func blabeePetSelectionResponseContract() throws {
    let nextTurn = try PetTransportResponse.requireAcceptedSelection(petTestData([
        "accepted": true,
        "outcome": [
            "kind": "next_turn",
            "continuation_id": "continuation_test",
            "queued_submission_id": "queued_submission_test",
        ],
    ]))
    #expect(nextTurn == "next_turn")

    let pause = try PetTransportResponse.requireAcceptedSelection(petTestData([
        "accepted": true,
        "outcome": ["kind": "pause"],
    ]))
    #expect(pause == "pause")

    let rejectedOutcomes: [[String: Any]] = [
        ["kind": "continuation", "continuation_id": "legacy"],
        ["kind": "next_turn", "continuation_id": "missing_queue_receipt"],
        [
            "kind": "next_turn",
            "continuation_id": "",
            "queued_submission_id": "queued_submission_test",
        ],
        [
            "kind": "next_turn",
            "continuation_id": "continuation_test",
            "queued_submission_id": "",
        ],
    ]
    for outcome in rejectedOutcomes {
        var rejected = false
        do {
            _ = try PetTransportResponse.requireAcceptedSelection(petTestData([
                "accepted": true,
                "outcome": outcome,
            ]))
        } catch {
            rejected = true
        }
        #expect(rejected)
    }
}

@Test("BlabeePet rejects ambiguous option ids and inconsistent rollback checkpoints")
func blabeePetChoiceIdentityAndCheckpointConsistency() throws {
    var duplicateOptions = petTestSnapshotObject(cards: [PetTestCard(suffix: "duplicate")])
    var duplicateInteractions = try #require(
        duplicateOptions["interactions"] as? [[String: Any]]
    )
    var choices = try #require(duplicateInteractions[0]["choices"] as? [[String: Any]])
    choices[1]["option_id"] = choices[0]["option_id"]
    duplicateInteractions[0]["choices"] = choices
    duplicateOptions["interactions"] = duplicateInteractions
    var rejectedDuplicate = false
    do {
        _ = try PetSnapshot.parse(petTestData(duplicateOptions))
    } catch {
        rejectedDuplicate = true
    }
    #expect(rejectedDuplicate)

    var mismatchedRollback = petTestSnapshotObject(cards: [
        PetTestCard(suffix: "rollback", rollbackEnabled: true),
    ])
    var rollbackInteractions = try #require(
        mismatchedRollback["interactions"] as? [[String: Any]]
    )
    var rollbackChoices = try #require(
        rollbackInteractions[0]["choices"] as? [[String: Any]]
    )
    rollbackChoices[3]["target_checkpoint_id"] = "checkpoint_other"
    rollbackInteractions[0]["choices"] = rollbackChoices
    mismatchedRollback["interactions"] = rollbackInteractions
    var rejectedRollback = false
    do {
        _ = try PetSnapshot.parse(petTestData(mismatchedRollback))
    } catch {
        rejectedRollback = true
    }
    #expect(rejectedRollback)
}

@Test("BlabeePet serializes the exact sixteen-field selection and fourteen-field focus")
func blabeePetExactSelectionSerialization() throws {
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: [PetTestCard(suffix: "serialize")],
        foregroundSuffix: "serialize"
    ))
    let interaction = try #require(snapshot.interactions.first)
    let choice = try #require(interaction.choice(slot: 1))
    let request = try PetSelectionRequest(
        identity: interaction.identity,
        selectionID: "selection_fresh_1",
        optionID: choice.optionID
    )
    let object = try petTestObject(request.data())
    #expect(Set(object.keys) == [
        "schema_version", "kind", "selection_id", "interaction_id", "packet_id",
        "revision", "option_id", "project_id", "session_id", "source_turn_id",
        "source_prompt_id", "episode_id", "episode_root_prompt_id",
        "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence",
    ])
    #expect(object.count == 16)
    #expect(object["kind"] as? String == "blabee_selection_request")
    #expect(object["option_id"] as? String == choice.optionID)
    #expect(object["selection_id"] as? String == "selection_fresh_1")

    let focus = try petTestObject(PetFocusRequest(identity: interaction.identity).data())
    #expect(focus.count == 14)
    #expect(focus["kind"] as? String == "blabee_pet_focus_request")
    #expect(focus["interaction_id"] as? String == interaction.identity.interactionID)
}

@Test("BlabeePet labels dynamic, fixed, and disabled slots without remapping")
func blabeePetSlotLabels() throws {
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: [
        PetTestCard(suffix: "labels", alternativeEnabled: false),
    ]))
    let choices = try #require(snapshot.interactions.first?.choices)
    #expect(choices[0].displayTitle == "Recommended labels")
    #expect(choices[1].displayTitle == "대안 없음")
    #expect(choices[1].enabled == false)
    #expect(choices[1].disabledReason == "no_safe_meaningful_alternative")
    #expect(choices[2].displayTitle == "보류")
    #expect(choices[3].displayTitle == "롤백")
    #expect(choices[3].enabled == false)
}
