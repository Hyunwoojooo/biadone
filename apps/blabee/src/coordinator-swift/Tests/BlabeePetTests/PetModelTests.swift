import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("BlabeePet strictly parses operational state and packet detail")
func blabeePetStrictModelParsing() throws {
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: [PetTestCard(suffix: "strict", rollbackEnabled: true)],
        foregroundSuffix: "strict",
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
