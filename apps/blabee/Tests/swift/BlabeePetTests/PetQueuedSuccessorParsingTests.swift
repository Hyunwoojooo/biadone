import Foundation
import Testing
@testable import BlabeeCoordinator

private func petQueuedSuccessorSnapshot() throws -> [String: Any] {
    // This is the wire shape produced by the coordinator regression
    // operationalVerifiedQueuedPromptRetainsPromotedSuccessor: the active
    // successor keeps its full routing binding while its session has already
    // started the verified queued turn.
    var object = petTestSnapshotObject(cards: [PetTestCard(suffix: "successor")])
    var sessions = try #require(object["sessions"] as? [[String: Any]])
    sessions[0]["source_turn_id"] = "turn_queued_delivery"
    sessions[0]["source_prompt_id"] = "prompt_queued_delivery"
    sessions[0]["episode_id"] = "episode_queued_delivery"
    object["sessions"] = sessions
    return object
}

@Test("A retained queued successor uses its active routing binding after the session advances")
func petQueuedSuccessorParsing() throws {
    let snapshot = try PetSnapshot.parse(petTestData(petQueuedSuccessorSnapshot()))
    let interaction = try #require(snapshot.interactions.first)
    #expect(interaction.identity.binding.sourceTurnID == "turn_successor")
    #expect(snapshot.sessions.first?.sourceTurnID == "turn_queued_delivery")
    #expect(snapshot.routing.pending.first?.identity == interaction.identity)
}

@Test("A retained successor still requires its exact route and project/session join",
      arguments: ["route_turn", "route_prompt", "route_episode", "route_packet", "session", "project", "cwd"])
func petQueuedSuccessorRejectsForeignBinding(change: String) throws {
    var object = try petQueuedSuccessorSnapshot()
    var interactions = try #require(object["interactions"] as? [[String: Any]])
    switch change {
    case "route_turn": interactions[0]["source_turn_id"] = "other_turn"
    case "route_prompt": interactions[0]["source_prompt_id"] = "other_prompt"
    case "route_episode": interactions[0]["episode_id"] = "other_episode"
    case "route_packet": interactions[0]["packet_id"] = "other_packet"
    case "session": object["sessions"] = [[String: Any]]()
    case "project": object["projects"] = [[String: Any]]()
    default: interactions[0]["cwd"] = "/tmp/foreign-project"
    }
    object["interactions"] = interactions
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}
