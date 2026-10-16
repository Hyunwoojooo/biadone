import CoordinatorSwift
import Foundation

/// Adds the private product registration endpoint to the common service while
/// preserving the existing Codex and explicitly provisioned development paths.
final class ClaudeProductServiceCoordinator: CoordinatorOperationalHandling, @unchecked Sendable {
    private let codex: any CoordinatorOperationalHandling
    let registry: ClaudeSessionRegistry?
    private let enrollment: ClaudeSessionEnrollment?
    private let pet: PetProviderService?
    private let access: ProductAccessService?

    init(codex: any CoordinatorOperationalHandling, registry: ClaudeSessionRegistry? = nil,
         enrollment: ClaudeSessionEnrollment? = nil, pet: PetProviderService? = nil,
         access: ProductAccessService? = nil) {
        self.codex = codex
        self.registry = registry
        self.enrollment = enrollment
        self.pet = pet
        self.access = access
    }

    static func start(codex: any CoordinatorOperationalHandling, parentURL: URL,
                      socketPath: String, runtimeIdentity: String,
                      secretCorpus: RuntimeSecretCorpus,
                      petSelectorCredential: String? = nil,
                      petArrivalLedger: PetEventArrivalLedger = PetEventArrivalLedger(),
                      productAccessCheck: @escaping @Sendable () throws -> UInt64 = { 0 },
                      access: ProductAccessService? = nil) throws -> ClaudeProductServiceCoordinator {
        let root = try ClaudeBridgeConfiguration.privateChild(of: parentURL, name: "claude-product")
        let registry = try ClaudeSessionRegistry(rootURL: root, runtimeIdentity: runtimeIdentity,
                                                secretCorpus: secretCorpus, petArrivalLedger: petArrivalLedger,
                                                productAccessCheck: productAccessCheck)
        let enrollment = try ClaudeSessionEnrollment(socketPath: socketPath, runtimeIdentity: runtimeIdentity,
            serviceIncarnation: registry.serviceIncarnation, secretCorpus: secretCorpus,
            enroll: { connection, request, deliver in
                try registry.enroll(connectionID: connection, request: request, deliverGrant: deliver)
            }, control: { connection, request in
                try registry.control(connectionID: connection, request: request)
            }, disconnected: { registry.disconnect(connectionID: $0) })
        let pet = try petSelectorCredential.map {
            try PetProviderService(credential: $0, codex: codex, registry: registry, secretCorpus: secretCorpus,
                                   arrivalLedger: petArrivalLedger)
        }
        try enrollment.start()
        return ClaudeProductServiceCoordinator(codex: codex, registry: registry, enrollment: enrollment, pet: pet, access: access)
    }

    func stop() {
        pet?.stop()
        enrollment?.stop()
        registry?.disconnectAll()
    }

    deinit { stop() }

    func handle(type: String, payload: Data) async throws -> Data {
        switch type {
        case ProductAccessService.requestType:
            guard let access else { throw CoordinatorError("product_access_unavailable") }
            return try access.handle(payload)
        case "claude_owner_v1":
            // Owner enrollment/credentials never travel through general JSON UDS.
            throw CoordinatorError("claude_private_endpoint_required")
        case "claude_session_v2":
            guard let registry else { throw CoordinatorError("claude_product_unavailable") }
            return try registry.handleSession(payload)
        case "pet_provider_v1":
            guard let pet else { throw CoordinatorError("pet_provider_unauthorized") }
            return try await pet.handleProvider(payload)
        case "pet_directory_v1":
            guard let pet else { throw CoordinatorError("pet_provider_unauthorized") }
            return try pet.handleDirectory(payload)
        case "pet_inbox_v1":
            guard let pet else { throw CoordinatorError("pet_provider_unauthorized") }
            return try pet.handleInbox(payload)
        case "claude_session_v1":
            // The old native host is a separate contract.
            throw CoordinatorError("claude_product_unavailable")
        default:
            return try await codex.handle(type: type, payload: payload)
        }
    }

    func doctorStatus(payload: Data) async throws -> Data { try await codex.doctorStatus(payload: payload) }
    func processTime() async throws -> [Data] {
        registry?.processTime()
        return try await codex.processTime()
    }
    func millisecondsUntilNextDeadline() async -> Int32? {
        let claude = registry?.millisecondsUntilNextDeadline()
        let codex = await codex.millisecondsUntilNextDeadline()
        return [claude, codex].compactMap { $0 }.min()
    }
}
