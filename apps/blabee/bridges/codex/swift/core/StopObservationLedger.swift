import CryptoKit
import Foundation

/// A boundary-local record of Stop observations. Only domain-separated
/// digests are retained; the assistant message itself is never stored.
struct StopObservation: Sendable, Equatable {
    let digest: String
    let messageDigest: String
    let generation: UInt64
    let stopHookActive: Bool
}

struct StopObservationLedger: Sendable {
    private let key: SymmetricKey
    private var observedDigests: Set<String> = []

    init(keyData: Data? = nil) {
        key = keyData.map(SymmetricKey.init(data:)) ?? SymmetricKey(size: .bits256)
    }

    mutating func register(
        sessionID: String,
        turnID: String,
        stopHookActive: Bool,
        lastAssistantMessage: String,
        generation: UInt64
    ) -> StopObservation? {
        let messageBytes = Data(lastAssistantMessage.utf8)
        let messageDigest = digest(
            domain: "blabee.stop-message.v1",
            fields: [messageBytes]
        )
        let observationDigest = digest(
            domain: "blabee.stop-observation.v1",
            fields: [
                Data(sessionID.utf8),
                Data(turnID.utf8),
                Data(stopHookActive ? [1] : [0]),
                messageBytes,
            ]
        )
        guard observedDigests.insert(observationDigest).inserted else { return nil }
        return StopObservation(
            digest: observationDigest,
            messageDigest: messageDigest,
            generation: generation,
            stopHookActive: stopHookActive
        )
    }

    func deliveryDigest(
        observation: StopObservation,
        response: Data,
        generation: UInt64
    ) -> String {
        digest(
            domain: "blabee.stop-delivery.v1",
            fields: [
                Data(observation.digest.utf8),
                Data(String(generation).utf8),
                response,
            ]
        )
    }

    private func digest(domain: String, fields: [Data]) -> String {
        var input = Data(domain.utf8)
        input.append(0)
        for field in fields {
            var count = UInt64(field.count).bigEndian
            withUnsafeBytes(of: &count) { input.append(contentsOf: $0) }
            input.append(field)
        }
        return HMAC<SHA256>.authenticationCode(for: input, using: key)
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
