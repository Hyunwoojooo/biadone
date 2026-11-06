import BlabeeProductSupport
import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Security

/// Private, connection-bound enrollment. This is deliberately not a request
/// type on the ordinary operational UDS. Neither UUIDs nor runtime identity
/// authenticate a launcher. An enrolled connection can renew/end only its
/// originally issued authority; no Hook/MCP or generic UDS operation is exposed.
final class ClaudeSessionEnrollment: @unchecked Sendable {
    typealias Enroll = @Sendable (
        UUID, ClaudeProductWireCodec.Envelope, @Sendable (Data) throws -> Void
    ) throws -> Data
    typealias Disconnected = @Sendable (UUID) -> Void
    typealias Control = @Sendable (UUID, ClaudeProductWireCodec.Envelope) throws -> Data

    struct PeerIdentity: Equatable, Sendable {
        let pid: Int32
        let startTime: UInt64
        fileprivate init(pid: Int32, startTime: UInt64) {
            self.pid = pid
            self.startTime = startTime
        }
    }

    private typealias PeerVerifier = @Sendable (Int32) throws -> PeerIdentity
    private let socketPath: String
    private let runtimeIdentity: String
    private let serviceIncarnation: UUID
    private let secretCorpus: RuntimeSecretCorpus
    private let codec: ClaudeProductWireCodec
    private let peerVerifier: PeerVerifier
    private let enroll: Enroll
    private let control: Control?
    private let disconnected: Disconnected
    private let lock = NSLock()
    private let workers = DispatchGroup()
    private var listener: Int32 = -1
    private var lease: Int32 = -1
    private var socketIdentity: (dev_t, ino_t)?
    private var connections: [UUID: Int32] = [:]
    private var started = false
    private var stopped = false

    convenience init(socketPath: String, runtimeIdentity: String, serviceIncarnation: UUID,
                     secretCorpus: RuntimeSecretCorpus, enroll: @escaping Enroll,
                     control: Control? = nil,
                     disconnected: @escaping Disconnected) throws {
        try self.init(socketPath: socketPath, runtimeIdentity: runtimeIdentity,
            serviceIncarnation: serviceIncarnation, secretCorpus: secretCorpus,
            peerVerifier: { descriptor in
                try Self.verifySignedPeer(descriptor, runtimeIdentity: runtimeIdentity)
            }, enroll: enroll, control: control, disconnected: disconnected)
    }

    private init(socketPath: String, runtimeIdentity: String, serviceIncarnation: UUID,
                 secretCorpus: RuntimeSecretCorpus, peerVerifier: @escaping PeerVerifier,
                 enroll: @escaping Enroll, control: Control?, disconnected: @escaping Disconnected) throws {
        guard OperationalRuntimeIdentity.isValid(runtimeIdentity),
              socketPath.hasPrefix("/"), !socketPath.utf8.contains(0),
              socketPath.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            throw Self.failure()
        }
        self.socketPath = socketPath
        self.runtimeIdentity = runtimeIdentity
        self.serviceIncarnation = serviceIncarnation
        self.secretCorpus = secretCorpus
        self.codec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
        self.peerVerifier = peerVerifier
        self.enroll = enroll
        self.control = control
        self.disconnected = disconnected
    }

    #if BLABEE_JOURNAL_TEST_HARNESS
    /// There is no environment switch or production initializer for unsigned
    /// enrollment. Even fixtures still use a real UDS and kernel peer identity.
    static func makeTesting(socketPath: String, runtimeIdentity: String, serviceIncarnation: UUID,
                            secretCorpus: RuntimeSecretCorpus,
                            peerVerifier: @escaping @Sendable (Int32) throws -> PeerIdentity = {
                                try ClaudeSessionEnrollment.testingPeer($0)
                            },
                            enroll: @escaping Enroll, control: Control? = nil,
                            disconnected: @escaping Disconnected) throws -> Self {
        try Self(socketPath: socketPath, runtimeIdentity: runtimeIdentity,
            serviceIncarnation: serviceIncarnation, secretCorpus: secretCorpus,
            peerVerifier: peerVerifier, enroll: enroll, control: control, disconnected: disconnected)
    }

    static func testingPeer(_ descriptor: Int32) throws -> PeerIdentity {
        try kernelPeer(descriptor)
    }

    static func testingIdentity(pid: Int32, startTime: UInt64) -> PeerIdentity {
        PeerIdentity(pid: pid, startTime: startTime)
    }
    #endif

    deinit { stop() }

    func start() throws {
        try lock.withLock {
            guard !started, !stopped else { throw Self.failure() }
            let url = URL(fileURLWithPath: socketPath)
            let parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(url.deletingLastPathComponent())
            defer { close(parent) }
            let lease = try UnixDomainSocketServer.openAndAcquireOwnerLease(
                parentDescriptor: parent, name: url.lastPathComponent + ".lock"
            )
            var descriptor: Int32 = -1
            var bound: (dev_t, ino_t)?
            do {
                try Self.removeStaleSocket(parent: parent, name: url.lastPathComponent, path: socketPath)
                descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
                guard descriptor >= 0 else { throw Self.failure() }
                try Self.configureSocket(descriptor)
                guard try Self.address(socketPath, { Darwin.bind(descriptor, $0, $1) }) == 0 else {
                    throw Self.failure()
                }
                var info = stat()
                guard lstat(socketPath, &info) == 0, info.st_uid == geteuid(),
                      info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK) else { throw Self.failure() }
                bound = (info.st_dev, info.st_ino)
                guard chmod(socketPath, 0o600) == 0, Darwin.listen(descriptor, 16) == 0 else {
                    throw Self.failure()
                }
                listener = descriptor
                socketIdentity = bound
                self.lease = lease
                started = true
                workers.enter()
                DispatchQueue.global(qos: .utility).async { [self] in acceptOwners() }
            } catch {
                if descriptor >= 0 { close(descriptor) }
                if let bound { Self.removeOwnedSocket(socketPath, identity: bound) }
                _ = flock(lease, LOCK_UN)
                close(lease)
                throw Self.failure()
            }
        }
    }

    /// Does not stop the service, signal another process, or retry enrollment.
    /// Worker teardown performs the exactly-once registry disconnect callback.
    func stop() {
        lock.withLock {
            guard !stopped else { return }
            stopped = true
            if listener >= 0 { _ = shutdown(listener, SHUT_RDWR) }
            for descriptor in connections.values { _ = shutdown(descriptor, SHUT_RDWR) }
        }
    }

    private func acceptOwners() {
        defer {
            lock.withLock {
                if listener >= 0 { close(listener); listener = -1 }
                if let socketIdentity { Self.removeOwnedSocket(socketPath, identity: socketIdentity) }
                self.socketIdentity = nil
                if lease >= 0 { _ = flock(lease, LOCK_UN); close(lease); lease = -1 }
            }
            workers.leave()
        }
        while true {
            let current = lock.withLock { stopped ? -1 : listener }
            guard current >= 0 else { return }
            var pending = pollfd(fd: current, events: Int16(POLLIN), revents: 0)
            let available = poll(&pending, 1, 100)
            if available < 0, errno == EINTR { continue }
            guard available >= 0 else { stop(); return }
            if available == 0 { continue }
            guard pending.revents & Int16(POLLIN) != 0 else { stop(); return }
            let descriptor = Darwin.accept(current, nil, nil)
            if descriptor < 0, errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { continue }
            guard descriptor >= 0 else { stop(); return }
            do { try Self.configureSocket(descriptor) }
            catch { close(descriptor); continue }
            let connectionID = UUID()
            let admitted = lock.withLock {
                guard !stopped, connections.count < 32 else { return false }
                connections[connectionID] = descriptor
                workers.enter()
                return true
            }
            guard admitted else { close(descriptor); continue }
            DispatchQueue.global(qos: .utility).async { [self] in
                serve(descriptor, connectionID: connectionID)
            }
        }
    }

    private func serve(_ descriptor: Int32, connectionID: UUID) {
        defer {
            // The callback follows any in-flight enrollment callback, so an EOF
            // cannot remove an entry before that callback subsequently installs it.
            disconnected(connectionID)
            lock.withLock { _ = connections.removeValue(forKey: connectionID) }
            close(descriptor)
            workers.leave()
        }
        var request: ClaudeProductWireCodec.Envelope?
        var ownedPipe: Int32 = -1
        var responseWriteStarted = false
        defer { if ownedPipe >= 0 { close(ownedPipe) } }
        do {
            let peer = try peerVerifier(descriptor)
            let challengeID = UUID()
            let grantPipeID = UUID()
            let challenge = try StrictJSONTransport.data(forJSONObject: [
                "schema_version": "blabee.claude-enrollment-challenge.v1",
                "runtime_identity": runtimeIdentity,
                "service_incarnation": serviceIncarnation.uuidString.lowercased(),
                "owner_connection_id": connectionID.uuidString.lowercased(),
                "challenge_id": challengeID.uuidString.lowercased(),
                "grant_pipe_id": grantPipeID.uuidString.lowercased(),
            ])
            try secretCorpus.assertNoKnownSecret(in: challenge)
            responseWriteStarted = true
            try Self.write(challenge + Data([10]), to: descriptor, deadline: Self.deadline())
            responseWriteStarted = false
            let received = try Self.receiveFrame(descriptor, requiredRights: 1, deadline: Self.deadline())
            ownedPipe = received.pipe
            let parsed = try codec.decodeRequest(received.data)
            guard parsed.contract == .owner, parsed.provider == .claude,
                  parsed.role == "owner", ["enroll", "enroll_observed"].contains(parsed.operation) else {
                throw Self.failure()
            }
            request = parsed
            let body = try StrictJSONTransport.object(from: parsed.canonicalJSON)
            guard let payload = body["payload"] as? [String: Any],
                  payload["service_incarnation"] as? String == serviceIncarnation.uuidString.lowercased(),
                  payload["owner_connection_id"] as? String == connectionID.uuidString.lowercased(),
                  payload["challenge_id"] as? String == challengeID.uuidString.lowercased(),
                  payload["grant_pipe_id"] as? String == grantPipeID.uuidString.lowercased(),
                  try peerVerifier(descriptor) == peer else { throw Self.failure() }
            try Self.requireWritableAnonymousPipe(ownedPipe)
            try Self.requireIdleLiveSocket(descriptor)
            let grant = GrantWriter(descriptor: ownedPipe, owner: descriptor, peer: peer,
                                    verifyPeer: peerVerifier)
            ownedPipe = -1 // GrantWriter owns and closes every outcome from here.
            defer { grant.close() }
            // The challenge and FD are consumed at this one call site. Neither
            // an error nor a missing response can replay this callback.
            let response = try enroll(connectionID, parsed, { try grant.deliver($0) })
            guard grant.deliveredExactlyOnce else { throw Self.failure() }
            try Self.requireIdleLiveSocket(descriptor)
            guard try peerVerifier(descriptor) == peer else { throw Self.failure() }
            let checked = try codec.decodeResponse(response, matching: parsed,
                connection: .init(serviceIncarnation: serviceIncarnation, ownerConnectionID: connectionID))
            let issued = try StrictJSONTransport.object(from: checked.canonicalJSON)
            guard issued["ok"] as? Bool == true,
                  let authority = issued["authority"] as? [String: String] else { throw Self.failure() }
            responseWriteStarted = true
            try Self.write(checked.canonicalJSON + Data([10]), to: descriptor, deadline: Self.deadline())
            responseWriteStarted = false
            request = nil
            while !lock.withLock({ stopped }) {
                var waiting = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
                let result = poll(&waiting, 1, 100)
                if result < 0, errno == EINTR { continue }
                guard result >= 0 else { return }
                if result == 0 { continue }
                guard waiting.revents & Int16(POLLIN) != 0, let control else { return }
                guard try peerVerifier(descriptor) == peer else { throw Self.failure() }
                // Idle time is not a frame timeout. Once input arrives it must
                // form one bounded request, with no additional SCM_RIGHTS.
                let frame = try Self.receiveFrame(descriptor, requiredRights: 0, deadline: Self.deadline())
                let command = try codec.decodeRequest(frame.data)
                guard command.contract == .owner, command.provider == .claude, command.role == "owner",
                      command.operation == "renew" || command.operation == "end" else { throw Self.failure() }
                request = command
                let object = try StrictJSONTransport.object(from: command.canonicalJSON)
                guard object["authority"] as? [String: String] == authority,
                      try peerVerifier(descriptor) == peer else { throw Self.failure() }
                try Self.requireIdleLiveSocket(descriptor)
                let response = try control(connectionID, command)
                guard try peerVerifier(descriptor) == peer else { throw Self.failure() }
                try Self.requireIdleLiveSocket(descriptor)
                let checked = try codec.decodeResponse(response, matching: command,
                    connection: .init(serviceIncarnation: serviceIncarnation, ownerConnectionID: connectionID))
                let responseObject = try StrictJSONTransport.object(from: checked.canonicalJSON)
                responseWriteStarted = true
                try Self.write(checked.canonicalJSON + Data([10]), to: descriptor, deadline: Self.deadline())
                responseWriteStarted = false
                // End is terminal even when a buggy callback returns an error;
                // all control errors close this connection rather than retrying.
                if command.operation == "end" || responseObject["ok"] as? Bool != true { return }
                request = nil
            }
        } catch {
            // Once any part of a frame may have escaped, its outcome is
            // unknown. Do not append a second JSON response or retry it.
            guard !responseWriteStarted else { return }
            // Never surface arbitrary error descriptions, request bytes, paths,
            // or credentials. A malformed pre-enrollment frame has no trusted
            // request correlation; valid owner requests use the codec contract.
            if let request, let response = try? errorResponse(request, connectionID: connectionID) {
                try? Self.write(response + Data([10]), to: descriptor, deadline: Self.deadline())
            } else {
                let response = Data("{\"schema_version\":\"blabee.claude-enrollment-error.v1\",\"error\":{\"code\":\"enrollment_rejected\"}}\n".utf8)
                if !secretCorpus.containsKnownSecret(in: response) {
                    try? Self.write(response, to: descriptor, deadline: Self.deadline())
                }
            }
        }
    }

    private func errorResponse(_ request: ClaudeProductWireCodec.Envelope, connectionID: UUID) throws -> Data {
        var object = try StrictJSONTransport.object(from: request.canonicalJSON)
        object.removeValue(forKey: "payload")
        object["kind"] = "response"
        object["ok"] = false
        object["error"] = ["code": "unavailable"]
        return try codec.encodeResponse(object, matching: request,
            connection: .init(serviceIncarnation: serviceIncarnation, ownerConnectionID: connectionID))
    }

    private static func kernelPeer(_ descriptor: Int32) throws -> PeerIdentity {
        var uid: uid_t = 0
        var gid: gid_t = 0
        var pid: Int32 = 0
        var size = socklen_t(MemoryLayout<Int32>.size)
        guard getpeereid(descriptor, &uid, &gid) == 0, uid == geteuid(),
              getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0,
              size == MemoryLayout<Int32>.size else { throw failure() }
        return PeerIdentity(pid: pid, startTime: try UpdateManagedCodexProcessIdentity.startTime(pid: pid))
    }

    static func verifySignedPeer(_ descriptor: Int32, runtimeIdentity: String) throws -> PeerIdentity {
        let before = try kernelPeer(descriptor)
        guard try OperationalRuntimeIdentity.requireCurrent() == runtimeIdentity else { throw failure() }
        var requirement: SecRequirement?
        let expression = signedPeerRequirement() as CFString
        guard SecRequirementCreateWithString(expression, SecCSFlags(), &requirement) == errSecSuccess,
              let requirement else { throw failure() }
        var own: SecCode?
        var peer: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &own) == errSecSuccess, let own,
              SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: NSNumber(value: before.pid)] as CFDictionary,
                  SecCSFlags(), &peer) == errSecSuccess, let peer else { throw failure() }
        let ownEvidence = try signingEvidence(own, requirement: requirement)
        let peerEvidence = try signingEvidence(peer, requirement: requirement)
        guard ownEvidence.identifier == peerEvidence.identifier,
              ownEvidence.cdHash == peerEvidence.cdHash,
              ownEvidence.team == peerEvidence.team,
              try kernelPeer(descriptor) == before else { throw failure() }
        return before
    }

    static func signedPeerRequirement() -> String {
        "anchor apple generic and identifier \"\(BlabeeProductProfile.current.bundleIdentifier)\""
    }

    static let signingInformationFlags = SecCSFlags(rawValue: UInt32(kSecCSSigningInformation))

    private static func signingEvidence(_ code: SecCode, requirement: SecRequirement)
        throws -> (identifier: String, cdHash: Data, team: String) {
        guard SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess else { throw failure() }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(unsafeBitCast(code, to: SecStaticCode.self), signingInformationFlags,
                  &information) == errSecSuccess,
              let values = information as? [CFString: Any],
              let identifier = values[kSecCodeInfoIdentifier] as? String,
              identifier == OperationalRuntimeIdentity.expectedBundleIdentifier,
              let hash = values[kSecCodeInfoUnique] as? Data, !hash.isEmpty,
              let team = values[kSecCodeInfoTeamIdentifier] as? String, !team.isEmpty,
              SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess else { throw failure() }
        return (identifier, hash, team)
    }

    /// Darwin's CMSG_* macros use __DARWIN_ALIGN32, including on arm64.
    private static func aligned(_ count: Int) -> Int { (count + 3) & ~3 }

    private static func receiveFrame(_ descriptor: Int32, requiredRights: Int, deadline: UInt64) throws -> (data: Data, pipe: Int32) {
        var data = Data()
        var descriptors: [Int32] = []
        var transferred = false
        defer { if !transferred { for item in descriptors { close(item) } } }
        while true {
            try wait(descriptor, events: Int16(POLLIN), deadline: deadline)
            let segment = try peekEnrollmentSegment(descriptor)
            guard descriptors.count + segment.rights <= requiredRights else { throw failure() }
            // Consume no more bytes than were peeked. This socket has exactly
            // one reader; a sender can append records, but cannot replace the
            // already inspected head control/data record.
            var bytes = [UInt8](repeating: 0, count: segment.bytes)
            var controls = [UInt32](repeating: 0, count: 128)
            var header = msghdr()
            let count = bytes.withUnsafeMutableBytes { buffer in
                controls.withUnsafeMutableBytes { control in
                    var vector = iovec(iov_base: buffer.baseAddress, iov_len: buffer.count)
                    return withUnsafeMutablePointer(to: &vector) { pointer in
                        header.msg_iov = pointer
                        header.msg_iovlen = 1
                        header.msg_control = control.baseAddress
                        header.msg_controllen = socklen_t(control.count)
                        return Darwin.recvmsg(descriptor, &header, 0)
                    }
                }
            }
            if count < 0, errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { continue }
            guard count > 0 else { throw failure() }
            var invalid = header.msg_flags & (MSG_CTRUNC | MSG_TRUNC) != 0
            controls.withUnsafeBytes { buffer in
                let end = min(Int(header.msg_controllen), buffer.count)
                var offset = 0
                while offset + MemoryLayout<cmsghdr>.size <= end {
                    let control = buffer.loadUnaligned(fromByteOffset: offset, as: cmsghdr.self)
                    let length = Int(control.cmsg_len)
                    let start = offset + aligned(MemoryLayout<cmsghdr>.size)
                    guard length >= aligned(MemoryLayout<cmsghdr>.size) else {
                        invalid = true
                        break
                    }
                    // Even a truncated rights header can name FDs already
                    // installed in this process; collect its complete visible
                    // descriptor values before rejecting the message.
                    let controlEnd = min(offset + length, end)
                    if length > end - offset { invalid = true }
                    if control.cmsg_level == SOL_SOCKET && control.cmsg_type == SCM_RIGHTS {
                        let payloadBytes = controlEnd - start
                        if payloadBytes == 0 || payloadBytes % MemoryLayout<Int32>.size != 0 { invalid = true }
                        for position in stride(from: start, to: controlEnd - 3, by: MemoryLayout<Int32>.size) {
                            let passed = buffer.loadUnaligned(fromByteOffset: position, as: Int32.self)
                            descriptors.append(passed)
                            if fcntl(passed, F_SETFD, FD_CLOEXEC) != 0 { invalid = true }
                        }
                    } else { invalid = true }
                    offset += aligned(length)
                }
                if offset < end { invalid = true }
            }
            guard !invalid, descriptors.count <= requiredRights,
                  data.count <= ClaudeProductWireCodec.maximumMessageBytes - count else { throw failure() }
            data.append(contentsOf: bytes.prefix(count))
            if let newline = data.firstIndex(of: 10) {
                guard newline == data.count - 1, descriptors.count == requiredRights else { throw failure() }
                transferred = true
                return (Data(data.prefix(upTo: newline)), descriptors.first ?? -1)
            }
        }
    }

    /// Darwin externalizes all SCM_RIGHTS before truncating copyout_control.
    /// Receiving with an undersized ancillary buffer can therefore hide live
    /// descriptors from user space. Peek BEFORE consuming: XNU's
    /// sopeek_scm_rights clears the FD payload and creates no descriptors. Reject
    /// truncation, multiple rights or foreign control while the kernel still
    /// owns them, then close the socket without receiving that record.
    private static func peekEnrollmentSegment(_ descriptor: Int32) throws -> (bytes: Int, rights: Int) {
        var bytes = [UInt8](repeating: 0, count: 4096)
        let oneRightBytes = aligned(MemoryLayout<cmsghdr>.size) + MemoryLayout<Int32>.size
        var controls = [UInt32](repeating: 0, count: oneRightBytes / 4)
        var header = msghdr()
        let count = bytes.withUnsafeMutableBytes { buffer in
            controls.withUnsafeMutableBytes { control in
                var vector = iovec(iov_base: buffer.baseAddress, iov_len: buffer.count)
                return withUnsafeMutablePointer(to: &vector) { pointer in
                    header.msg_iov = pointer
                    header.msg_iovlen = 1
                    header.msg_control = control.baseAddress
                    header.msg_controllen = socklen_t(control.count)
                    return Darwin.recvmsg(descriptor, &header, MSG_PEEK | MSG_DONTWAIT)
                }
            }
        }
        guard count > 0, header.msg_flags & (MSG_CTRUNC | MSG_TRUNC) == 0 else { throw failure() }
        if header.msg_controllen == 0 { return (count, 0) }
        guard header.msg_controllen == oneRightBytes else { throw failure() }
        let control = controls.withUnsafeBytes { $0.loadUnaligned(as: cmsghdr.self) }
        guard control.cmsg_len == oneRightBytes,
              control.cmsg_level == SOL_SOCKET, control.cmsg_type == SCM_RIGHTS else { throw failure() }
        // The zero-valued peek payload is NOT a received descriptor; never
        // close or use it. Only the following non-peek receive owns any FD.
        return (count, 1)
    }

    private static func requireWritableAnonymousPipe(_ descriptor: Int32) throws {
        var info = stat()
        var pipeInfo = pipe_fdinfo()
        let size = Int32(MemoryLayout<pipe_fdinfo>.stride)
        let flags = fcntl(descriptor, F_GETFL)
        guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFIFO),
              flags >= 0, flags & O_ACCMODE == O_WRONLY,
              proc_pidfdinfo(getpid(), descriptor, PROC_PIDFDPIPEINFO, &pipeInfo, size) == size,
              fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0,
              fcntl(descriptor, F_SETNOSIGPIPE, 1) == 0 else { throw failure() }
    }

    private final class GrantWriter: @unchecked Sendable {
        private let lock = NSLock()
        private var descriptor: Int32
        private let owner: Int32
        private let peer: PeerIdentity
        private let verifyPeer: PeerVerifier
        private var attempts = 0
        private var delivered = false

        init(descriptor: Int32, owner: Int32, peer: PeerIdentity, verifyPeer: @escaping PeerVerifier) {
            self.descriptor = descriptor
            self.owner = owner
            self.peer = peer
            self.verifyPeer = verifyPeer
        }
        deinit { close() }
        var deliveredExactlyOnce: Bool { lock.withLock { attempts == 1 && delivered } }
        func close() { lock.withLock { closeUnlocked() } }
        private func closeUnlocked() {
            if descriptor >= 0 { Darwin.close(descriptor); descriptor = -1 }
        }
        func deliver(_ data: Data) throws {
            try lock.withLock {
                attempts += 1
                guard attempts == 1, descriptor >= 0 else { throw ClaudeSessionEnrollment.failure() }
                defer { closeUnlocked() }
                guard !data.isEmpty, data.count <= 16 * 1024,
                      try verifyPeer(owner) == peer else { throw ClaudeSessionEnrollment.failure() }
                try ClaudeSessionEnrollment.requireIdleLiveSocket(owner)
                try ClaudeSessionEnrollment.write(data, to: descriptor, deadline: ClaudeSessionEnrollment.deadline(),
                    beforeWrite: { try ClaudeSessionEnrollment.requireIdleLiveSocket(self.owner) })
                delivered = true
            }
        }
    }

    private static func requireIdleLiveSocket(_ descriptor: Int32) throws {
        var byte: UInt8 = 0
        let count = Darwin.recv(descriptor, &byte, 1, MSG_PEEK | MSG_DONTWAIT)
        guard count < 0, errno == EAGAIN || errno == EWOULDBLOCK else { throw failure() }
    }

    private static func configureSocket(_ descriptor: Int32) throws {
        var noSignal: Int32 = 1
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0,
              setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                  socklen_t(MemoryLayout<Int32>.size)) == 0 else { throw failure() }
    }

    private static func deadline() -> UInt64 {
        let (value, overflow) = DispatchTime.now().uptimeNanoseconds.addingReportingOverflow(5_000_000_000)
        return overflow ? UInt64.max : value
    }

    private static func wait(_ descriptor: Int32, events: Int16, deadline: UInt64) throws {
        while true {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { throw failure() }
            var item = pollfd(fd: descriptor, events: events, revents: 0)
            let result = poll(&item, 1, Int32(min(100, max(1, (deadline - now) / 1_000_000))))
            if result < 0, errno == EINTR { continue }
            guard result >= 0, item.revents & Int16(POLLERR | POLLHUP | POLLNVAL) == 0 else { throw failure() }
            if item.revents & events != 0 { return }
        }
    }

    private static func write(_ data: Data, to descriptor: Int32, deadline: UInt64,
                              beforeWrite: () throws -> Void = {}) throws {
        var offset = 0
        while offset < data.count {
            try beforeWrite()
            try wait(descriptor, events: Int16(POLLOUT), deadline: deadline)
            let count = data.withUnsafeBytes {
                Darwin.write(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { continue }
            guard count > 0 else { throw failure() }
            offset += count
        }
    }

    private static func address<T>(_ path: String,
        _ body: (UnsafePointer<sockaddr>, socklen_t) throws -> T) throws -> T {
        var address = sockaddr_un()
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw failure() }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
        return try withUnsafePointer(to: &address) {
            try $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                try body($0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
    }

    private static func removeStaleSocket(parent: Int32, name: String, path: String) throws {
        var info = stat()
        if fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw failure() }
            return
        }
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              info.st_mode & 0o777 == 0o600, info.st_uid == geteuid() else { throw failure() }
        let probe = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard probe >= 0 else { throw failure() }
        defer { close(probe) }
        try configureSocket(probe)
        let connected = try address(path) { Darwin.connect(probe, $0, $1) }
        guard connected != 0, errno == ECONNREFUSED else { throw failure() }
        var current = stat()
        guard fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
              current.st_dev == info.st_dev, current.st_ino == info.st_ino,
              unlinkat(parent, name, 0) == 0 else { throw failure() }
    }

    private static func removeOwnedSocket(_ path: String, identity: (dev_t, ino_t)) {
        var info = stat()
        if lstat(path, &info) == 0, info.st_dev == identity.0, info.st_ino == identity.1,
           info.st_uid == geteuid(), info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK) {
            _ = unlink(path)
        }
    }

    private static func failure() -> CoordinatorError { CoordinatorError("claude_enrollment_rejected") }
}
