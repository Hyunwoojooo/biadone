import Foundation

/// Headless test entry point. This source is never included in the app bundle.
@main
struct PetTransportProbe {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard arguments.count >= 2, let token = ProcessInfo.processInfo.environment["BLABEE_CLAUDE_UI_TOKEN"] else {
                throw PetFailure.invalid("The test probe requires mode, runtime, and a test UI token.")
            }
            let client = CoordinatorClient(runtime: arguments[1], token: token)
            if arguments[0] == "select" {
                guard arguments.count == 6, let revision = Int(arguments[4]) else {
                    throw PetFailure.invalid("Selection probe requires session, packet, revision, and option.")
                }
                let selectionID = try client.select(session: arguments[2], packet: arguments[3], revision: revision, option: arguments[5])
                try writeJSON(["selected": true, "selection_id": selectionID])
            } else {
                let sessions = try client.list()
                var pending: PendingPetSelection?
                if arguments[0] == "pending" {
                    guard arguments.count == 5 else { throw PetFailure.invalid("Pending probe requires session, packet, and optional receipt identity.") }
                    pending = PendingPetSelection(sessionID: arguments[2], packetID: arguments[3],
                        selectionID: arguments[4].isEmpty ? nil : arguments[4])
                }
                try writeJSON(["sessions": sessions.map { session in
                    ["session_id": session.session_id, "phase": session.phase,
                     "selection_enabled": session.isSelectionReady,
                     "pending_blocked": pending?.blocks(session) ?? false,
                     "pending_invalidated": pending?.isInvalidated(by: session) ?? false,
                     "task": session.packet?.options.first?.task ?? ""]
                }])
            }
        } catch {
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
            exit(1)
        }
    }
}
