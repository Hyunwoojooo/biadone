import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Security
import Testing
@testable import BlabeeCoordinator

#if BLABEE_JOURNAL_TEST_HARNESS
@Suite("Claude private session enrollment", .serialized)
struct ClaudeSessionEnrollmentTests {
    @Test("peer signing inspection requests the Team ID information set")
    func signingInformationIncludesTeamID() {
        #expect(ClaudeSessionEnrollment.signingInformationFlags.rawValue & UInt32(kSecCSSigningInformation) != 0)
    }

    @Test("verified enrollment writes one private grant and EOF revokes only its owner")
    func enrollmentAndOwnerEOF() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let first = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        let second = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { first.close(); second.close() }
        let firstChallenge = try first.readChallenge()
        let secondChallenge = try second.readChallenge()
        #expect(firstChallenge["owner_connection_id"] as? String != secondChallenge["owner_connection_id"] as? String)
        #expect(firstChallenge["challenge_id"] as? String != secondChallenge["challenge_id"] as? String)
        for (client, challenge) in [(first, firstChallenge), (second, secondChallenge)] {
            let pipe = try CP02EnrollmentTestClient.makePipe()
            defer { Darwin.close(pipe.read) }
            let request = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path)
            try client.send(request, passing: [pipe.write])
            Darwin.close(pipe.write)
            let response = try client.readResponse()
            #expect(try StrictJSONTransport.object(from: response)["ok"] as? Bool == true)
            #expect(!fixture.corpus.containsKnownSecret(in: response))
            #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
        }
        #expect(fixture.recorder.callCount == 2)
        #expect(fixture.recorder.disconnectCount == 0)
        first.close()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.disconnectedIDs == [UUID(uuidString: firstChallenge["owner_connection_id"] as! String)!])
        #expect(fixture.recorder.callCount == 2)
        second.close()
        try fixture.recorder.waitForDisconnects(2)
    }

    @Test("public runtime identity and same uid do not authorize an unsigned client")
    func productionSignatureIsRequired() throws {
        let fixture = try EnrollmentFixture(production: true)
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let response = try client.readResponse()
        #expect(try StrictJSONTransport.object(from: response)["schema_version"] as? String == "blabee.claude-enrollment-error.v1")
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
    }

    @Test("challenge, connection, service and grant-pipe references bind the exact connection",
           arguments: ["challenge_id", "owner_connection_id", "service_incarnation", "grant_pipe_id"])
    func wrongReferenceRejected(field: String) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        var challenge = try client.readChallenge()
        challenge[field] = UUID().uuidString.lowercased()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("copied challenge cannot enroll another connection")
    func crossConnectionReplayRejected() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let original = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        let replay = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { original.close(); replay.close() }
        let oldChallenge = try original.readChallenge()
        _ = try replay.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try replay.send(CP02EnrollmentTestClient.enrollRequest(challenge: oldChallenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try replay.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("PID birth changes after the challenge fail before registry dispatch")
    func changedPeerIdentityRejected() throws {
        let state = EnrollmentPeerState()
        let fixture = try EnrollmentFixture(peerVerifier: { descriptor in
            let actual = try ClaudeSessionEnrollment.testingPeer(descriptor)
            return state.next(actual)
        })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("invalid UTF-8, duplicate keys and wrong provider/version are rejected before registry dispatch",
           arguments: ["utf8", "duplicate", "provider", "version"])
    func malformedEnrollmentRejected(kind: String) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let valid = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path)
        let malformed: Data
        switch kind {
        case "utf8": malformed = Data([0xff, 0xfe])
        case "duplicate": malformed = Data("{\"provider\":\"claude\",".utf8) + valid.dropFirst()
        default:
            var object = try StrictJSONTransport.object(from: valid)
            if kind == "provider" { object["provider"] = "codex" }
            else { object["schema_version"] = "blabee.claude-owner.v99" }
            malformed = try StrictJSONTransport.data(forJSONObject: object)
        }
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(malformed, passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("SCM_RIGHTS is checked across fragmented frames", arguments: [false, true])
    func fragmentedFrameRights(duplicate: Bool) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let request = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path)
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(Data(request.prefix(8)), passing: [pipe.write], terminateFrame: false)
        try client.send(Data(request.dropFirst(8)), passing: duplicate ? [pipe.write] : [])
        Darwin.close(pipe.write)
        let response = try StrictJSONTransport.object(from: client.readResponse())
        if duplicate {
            #expect(response["ok"] as? Bool != true)
            try fixture.recorder.waitForDisconnects(1)
            #expect(fixture.recorder.callCount == 0)
            #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
        } else {
            #expect(response["ok"] as? Bool == true)
            #expect(fixture.recorder.callCount == 1)
            #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
        }
    }

    @Test("missing, multiple, or truncated SCM_RIGHTS never reach enrollment", arguments: [0, 2, 128])
    func invalidAncillaryCountRejected(count: Int) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path),
                        passing: Array(repeating: pipe.write, count: count))
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        // EOF proves every received duplicate write descriptor was closed.
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("read-only pipe, file, socket and named FIFO are not private grant writers",
           arguments: ["reader", "file", "socket", "fifo"])
    func wrongDescriptorTypeRejected(kind: String) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let descriptor: Int32
        var companion: Int32 = -1
        switch kind {
        case "reader":
            let pipe = try CP02EnrollmentTestClient.makePipe()
            descriptor = pipe.read
            companion = pipe.write
        case "file":
            descriptor = Darwin.open(fixture.root.appendingPathComponent("not-a-pipe").path,
                                    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, mode_t(0o600))
        case "socket":
            var pair: [Int32] = [-1, -1]
            guard socketpair(AF_UNIX, SOCK_STREAM, 0, &pair) == 0 else { throw enrollmentTestError() }
            descriptor = pair[0]
            companion = pair[1]
        default:
            let path = fixture.root.appendingPathComponent("named-fifo").path
            guard mkfifo(path, 0o600) == 0 else { throw enrollmentTestError() }
            companion = Darwin.open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
            descriptor = Darwin.open(path, O_WRONLY | O_NONBLOCK | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw enrollmentTestError() }
        defer { Darwin.close(descriptor); if companion >= 0 { Darwin.close(companion) } }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [descriptor])
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
    }

    @Test("a second frame is rejected before enrollment and closes its passed descriptor")
    func pipelinedFrameRejected() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let request = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path)
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(request + Data([10]) + request, passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 0)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("an enrolled connection cannot replay enrollment or receive another grant")
    func secondEnrollmentRejected() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let request = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path)
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(request, passing: [pipe.write])
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
        let replayPipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(replayPipe.read) }
        try client.send(request, passing: [replayPipe.write])
        Darwin.close(replayPipe.write)
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 1)
        #expect(try CP02EnrollmentTestClient.readGrant(replayPipe.read).isEmpty)
    }

    @Test("a new authenticated challenge authorizes a fresh logical pipe grant, not a kernel address", arguments: [false, true])
    func freshChallengeOwnsItsGrant(afterDisconnect: Bool) throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let first = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        let second = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { first.close(); second.close() }
        let firstChallenge = try first.readChallenge()
        let secondChallenge = try second.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read); Darwin.close(pipe.write) }
        try first.send(CP02EnrollmentTestClient.enrollRequest(challenge: firstChallenge, cwd: fixture.root.path), passing: [pipe.write])
        #expect(try StrictJSONTransport.object(from: first.readResponse())["ok"] as? Bool == true)
        #expect(try CP02EnrollmentTestClient.readExactly(pipe.read, count: EnrollmentFixture.grant.count) == EnrollmentFixture.grant)
        if afterDisconnect { first.close(); try fixture.recorder.waitForDisconnects(1) }
        try second.send(CP02EnrollmentTestClient.enrollRequest(challenge: secondChallenge, cwd: fixture.root.path), passing: [pipe.write])
        #expect(try StrictJSONTransport.object(from: second.readResponse())["ok"] as? Bool == true)
        #expect(try CP02EnrollmentTestClient.readExactly(pipe.read, count: EnrollmentFixture.grant.count) == EnrollmentFixture.grant)
        #expect(fixture.recorder.callCount == 2)
    }

    @Test("normal sequential enrollments do not reject newly allocated kernel pipes")
    func newPipesRemainUsable() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        for index in 0..<12 {
            let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
            defer { client.close() }
            let challenge = try client.readChallenge()
            let pipe = try CP02EnrollmentTestClient.makePipe()
            defer { Darwin.close(pipe.read) }
            try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
            Darwin.close(pipe.write)
            let response = try StrictJSONTransport.object(from: client.readResponse())
            #expect(response["ok"] as? Bool == true)
            #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
            client.close()
            try fixture.recorder.waitForDisconnects(index + 1)
        }
        #expect(fixture.recorder.callCount == 12)
    }

    @Test("callback failure and reflected secrets produce fixed errors and revoke the connection",
           arguments: [EnrollmentBehavior.fail, .reflectSecret, .deliverTwice, .noGrant, .oversizedGrant])
    func callbackFailureIsClosed(behavior: EnrollmentBehavior) throws {
        let fixture = try EnrollmentFixture(behavior: behavior)
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        let response = try client.readResponse()
        #expect(try StrictJSONTransport.object(from: response)["ok"] as? Bool == false)
        #expect(!fixture.corpus.containsKnownSecret(in: response))
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 1)
        let grant = try CP02EnrollmentTestClient.readGrant(pipe.read)
        #expect(grant == (behavior == .reflectSecret || behavior == .deliverTwice ? EnrollmentFixture.grant : Data()))
    }

    @Test("a broken grant pipe cannot signal or terminate the service")
    func brokenPipeIsClosed() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        Darwin.close(pipe.read)
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool == false)
        try fixture.recorder.waitForDisconnects(1)
        let next = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { next.close() }
        _ = try next.readChallenge()
    }

    @Test("a full private grant pipe has a bounded write timeout and does not block another connection")
    func fullPipeHasDeadline() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read); Darwin.close(pipe.write) }
        guard fcntl(pipe.write, F_SETFL, O_NONBLOCK) == 0 else { throw enrollmentTestError() }
        let filler = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = filler.withUnsafeBytes { Darwin.write(pipe.write, $0.baseAddress, $0.count) }
            if count < 0, errno == EAGAIN || errno == EWOULDBLOCK { break }
            guard count > 0 else { throw enrollmentTestError() }
        }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        #expect(fixture.recorder.entered.wait(timeout: .now() + 3) == .success)
        let other = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { other.close() }
        _ = try other.readChallenge()
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool == false)
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 1)
    }

    @Test("owner EOF during the registry callback makes grant delivery fail and invokes final cleanup")
    func disconnectDuringCallback() throws {
        let fixture = try EnrollmentFixture(behavior: .pause)
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        #expect(fixture.recorder.entered.wait(timeout: .now() + 3) == .success)
        client.close()
        fixture.recorder.resume.signal()
        try fixture.recorder.waitForDisconnects(1)
        #expect(fixture.recorder.callCount == 1)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
    }

    @Test("stopping this endpoint closes its owner callbacks once without touching a second endpoint")
    func stopIsScoped() throws {
        let firstFixture = try EnrollmentFixture()
        let secondFixture = try EnrollmentFixture()
        defer { firstFixture.cleanup(); secondFixture.cleanup() }
        let first = try CP02EnrollmentTestClient(socketPath: firstFixture.socketPath)
        let second = try CP02EnrollmentTestClient(socketPath: secondFixture.socketPath)
        defer { first.close(); second.close() }
        _ = try first.readChallenge()
        let challenge = try second.readChallenge()
        firstFixture.endpoint.stop()
        firstFixture.endpoint.stop()
        try firstFixture.recorder.waitForDisconnects(1)
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try second.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: secondFixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        #expect(try StrictJSONTransport.object(from: second.readResponse())["ok"] as? Bool == true)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
        #expect(firstFixture.recorder.disconnectCount == 1)
        #expect(secondFixture.recorder.disconnectCount == 0)
    }

    @Test("the listener refuses an unsafe parent and cannot replace an existing owner")
    func listenerOwnership() throws {
        let fixture = try EnrollmentFixture()
        defer { fixture.cleanup() }
        let duplicate = try ClaudeSessionEnrollment.makeTesting(socketPath: fixture.socketPath,
            runtimeIdentity: fixture.runtimeIdentity, serviceIncarnation: UUID(), secretCorpus: fixture.corpus,
            enroll: { _, _, _ in throw enrollmentTestError() }, disconnected: { _ in })
        #expect(throws: (any Error).self) { try duplicate.start() }
        guard chmod(fixture.root.path, 0o755) == 0 else { throw enrollmentTestError() }
        defer { _ = chmod(fixture.root.path, 0o700) }
        let unsafe = try ClaudeSessionEnrollment.makeTesting(socketPath: fixture.root.appendingPathComponent("other.sock").path,
            runtimeIdentity: fixture.runtimeIdentity, serviceIncarnation: UUID(), secretCorpus: fixture.corpus,
            enroll: { _, _, _ in throw enrollmentTestError() }, disconnected: { _ in })
        #expect(throws: (any Error).self) { try unsafe.start() }
    }

    @Test("the enrolled socket serializes owner renew and closes after acknowledged end")
    func renewAndEndOnPrivateConnection() throws {
        let controls = EnrollmentControlRecord()
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let enrolled = try enrollControlClient(client, fixture: fixture)
        for sequence in ["1", "1", "2"] {
            let request = try CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "renew",
                payload: ["renewal_sequence": sequence])
            try client.send(request, passing: [])
            let response = try client.readResponse()
            let codec = ClaudeProductWireCodec(credentialCorpus: fixture.corpus)
            let authority = enrolled["authority"] as! [String: String]
            _ = try codec.decodeResponse(response, matching: codec.decodeRequest(request), connection: .init(
                serviceIncarnation: UUID(uuidString: authority["service_incarnation"]!)!,
                ownerConnectionID: UUID(uuidString: authority["owner_connection_id"]!)!))
            #expect(try StrictJSONTransport.object(from: response)["ok"] as? Bool == true)
        }
        try client.send(CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "end",
            payload: ["reason": "child_exited"]), passing: [])
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool == true)
        try fixture.recorder.waitForDisconnects(1)
        #expect(controls.operations == ["renew", "renew", "renew", "end"])
        #expect(fixture.recorder.callCount == 1)
        #expect(fixture.recorder.disconnectCount == 1)
    }

    @Test("owner control is pinned to all six originally enrolled UUIDs",
           arguments: ["scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch"])
    func wrongControlAuthorityRejected(field: String) throws {
        let controls = EnrollmentControlRecord()
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        var enrolled = try enrollControlClient(client, fixture: fixture)
        var authority = enrolled["authority"] as! [String: String]
        authority[field] = UUID().uuidString.lowercased()
        enrolled["authority"] = authority
        try client.send(CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "renew",
            payload: ["renewal_sequence": "1"]), passing: [])
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool != true)
        try fixture.recorder.waitForDisconnects(1)
        #expect(controls.operations.isEmpty)
    }

    @Test("Hook, MCP, other provider and enrollment commands cannot use owner control",
           arguments: ["hook", "bridge", "provider", "version", "enroll"])
    func wrongControlRoleRejected(kind: String) throws {
        let controls = EnrollmentControlRecord()
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let enrolled = try enrollControlClient(client, fixture: fixture)
        var request = try StrictJSONTransport.object(from: CP02EnrollmentTestClient.ownerControlRequest(
            enrolled: enrolled, operation: "renew", payload: ["renewal_sequence": "1"]))
        switch kind {
        case "hook", "bridge": request["role"] = kind
        case "provider": request["provider"] = "codex"
        case "version": request["schema_version"] = "blabee.claude-session.v2"
        default: request["operation"] = "enroll"
        }
        try client.send(StrictJSONTransport.data(forJSONObject: request), passing: [])
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool != true)
        try fixture.recorder.waitForDisconnects(1)
        #expect(controls.operations.isEmpty)
    }

    @Test("owner control rejects all further descriptors without externalizing them", arguments: [1, 128])
    func controlDescriptorsRejected(count: Int) throws {
        let controls = EnrollmentControlRecord()
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let enrolled = try enrollControlClient(client, fixture: fixture)
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "renew",
            payload: ["renewal_sequence": "1"]), passing: Array(repeating: pipe.write, count: count))
        Darwin.close(pipe.write)
        _ = try client.readResponse()
        try fixture.recorder.waitForDisconnects(1)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read).isEmpty)
        #expect(controls.operations.isEmpty)
    }

    @Test("owner control rechecks peer birth after successful enrollment")
    func controlPeerIdentityChanged() throws {
        let controls = EnrollmentControlRecord()
        let peer = EnrollmentControlPeer()
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) },
            peerVerifier: { descriptor in try peer.observe(descriptor) })
        defer { fixture.cleanup() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let enrolled = try enrollControlClient(client, fixture: fixture)
        peer.replace()
        try client.send(CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "renew",
            payload: ["renewal_sequence": "1"]), passing: [])
        #expect(try StrictJSONTransport.object(from: client.readResponse())["ok"] as? Bool != true)
        try fixture.recorder.waitForDisconnects(1)
        #expect(controls.operations.isEmpty)
    }

    @Test("owner EOF during a control callback is cleaned up after the callback exits")
    func controlDisconnectOrdering() throws {
        let controls = EnrollmentControlRecord(paused: true)
        let fixture = try EnrollmentFixture(control: { try controls.handle($0, $1) })
        defer { fixture.cleanup(); controls.resume.signal() }
        let client = try CP02EnrollmentTestClient(socketPath: fixture.socketPath)
        defer { client.close() }
        let enrolled = try enrollControlClient(client, fixture: fixture)
        try client.send(CP02EnrollmentTestClient.ownerControlRequest(enrolled: enrolled, operation: "renew",
            payload: ["renewal_sequence": "1"]), passing: [])
        #expect(controls.entered.wait(timeout: .now() + 3) == .success)
        client.close()
        #expect(fixture.recorder.disconnectCount == 0)
        controls.resume.signal()
        try fixture.recorder.waitForDisconnects(1)
        #expect(controls.finished)
        #expect(fixture.recorder.disconnectCount == 1)
    }

    private func enrollControlClient(_ client: CP02EnrollmentTestClient,
                                     fixture: EnrollmentFixture) throws -> [String: Any] {
        let challenge = try client.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try client.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: fixture.root.path), passing: [pipe.write])
        Darwin.close(pipe.write)
        let response = try StrictJSONTransport.object(from: client.readResponse())
        #expect(response["ok"] as? Bool == true)
        #expect(try CP02EnrollmentTestClient.readGrant(pipe.read) == EnrollmentFixture.grant)
        return response
    }
}

/// Shared only by CP-02 test suites. Uses real SCM_RIGHTS; no fake server path,
/// installed app, product database, Keychain or environment configuration.
final class CP02EnrollmentTestClient: @unchecked Sendable {
    private let descriptorLock = NSLock()
    private var rawDescriptor: Int32
    private var activeOperations = 0
    private var closed = false
    var descriptor: Int32 { descriptorLock.withLock { closed ? -1 : rawDescriptor } }

    init(socketPath: String) throws {
        rawDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard rawDescriptor >= 0 else { throw enrollmentTestError() }
        do {
            var address = sockaddr_un()
            let bytes = Array(socketPath.utf8) + [0]
            guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw enrollmentTestError() }
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            address.sun_family = sa_family_t(AF_UNIX)
            withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
            let result = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(rawDescriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            var noSignal: Int32 = 1
            guard result == 0, fcntl(rawDescriptor, F_SETFD, FD_CLOEXEC) == 0,
                  setsockopt(rawDescriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                    socklen_t(MemoryLayout<Int32>.size)) == 0 else { throw enrollmentTestError() }
        } catch { Darwin.close(rawDescriptor); rawDescriptor = -1; throw error }
    }
    deinit { close() }
    func close() {
        descriptorLock.withLock {
            guard !closed else { return }
            closed = true
            _ = shutdown(rawDescriptor, SHUT_RDWR)
            if activeOperations == 0 { Darwin.close(rawDescriptor); rawDescriptor = -1 }
        }
    }
    private func withDescriptor<T>(_ body: (Int32) throws -> T) throws -> T {
        let current = try descriptorLock.withLock {
            guard !closed, rawDescriptor >= 0 else { throw enrollmentTestError() }
            activeOperations += 1
            return rawDescriptor
        }
        defer {
            descriptorLock.withLock {
                activeOperations -= 1
                if closed, activeOperations == 0 { Darwin.close(rawDescriptor); rawDescriptor = -1 }
            }
        }
        return try body(current)
    }
    func readChallenge() throws -> [String: Any] {
        let result = try StrictJSONTransport.object(from: readResponse())
        guard result["schema_version"] as? String == "blabee.claude-enrollment-challenge.v1" else {
            throw enrollmentTestError()
        }
        return result
    }
    static func enrollRequest(challenge: [String: Any], cwd: String,
                              channelSource: String = "blabee-claude") throws -> Data {
        try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "owner", "operation": "enroll",
            "payload": [
                "service_incarnation": challenge["service_incarnation"] as? String ?? "",
                "owner_connection_id": challenge["owner_connection_id"] as? String ?? "",
                "challenge_id": challenge["challenge_id"] as? String ?? "",
                "grant_pipe_id": challenge["grant_pipe_id"] as? String ?? "",
                "cwd": cwd, "channel_source": channelSource,
            ],
        ])
    }
    static func ownerControlRequest(enrolled: [String: Any], operation: String,
                                    payload: [String: String]) throws -> Data {
        try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "owner", "operation": operation,
            "authority": enrolled["authority"] as? [String: String] ?? [:], "payload": payload,
        ])
    }
    func send(_ payload: Data, passing descriptors: [Int32], terminateFrame: Bool = true) throws {
        try withDescriptor { descriptor in
            try Self.send(payload, passing: descriptors, terminateFrame: terminateFrame, to: descriptor)
        }
    }
    private static func send(_ payload: Data, passing descriptors: [Int32], terminateFrame: Bool,
                             to descriptor: Int32) throws {
        let data = payload + (terminateFrame ? Data([10]) : Data())
        let alignedHeader = (MemoryLayout<cmsghdr>.size + 3) & ~3
        let controlBytes = descriptors.isEmpty ? 0 : alignedHeader + descriptors.count * MemoryLayout<Int32>.size
        var controls = [UInt32](repeating: 0, count: (controlBytes + 3) / 4)
        let count = data.withUnsafeBytes { bytes in
            controls.withUnsafeMutableBytes { control -> Int in
                if !descriptors.isEmpty {
                    let header = cmsghdr(cmsg_len: socklen_t(controlBytes), cmsg_level: SOL_SOCKET, cmsg_type: SCM_RIGHTS)
                    control.storeBytes(of: header, as: cmsghdr.self)
                    for (index, descriptor) in descriptors.enumerated() {
                        control.storeBytes(of: descriptor, toByteOffset: alignedHeader + index * MemoryLayout<Int32>.size, as: Int32.self)
                    }
                }
                var vector = iovec(iov_base: UnsafeMutableRawPointer(mutating: bytes.baseAddress), iov_len: bytes.count)
                return withUnsafeMutablePointer(to: &vector) { pointer in
                    var header = msghdr()
                    header.msg_iov = pointer
                    header.msg_iovlen = 1
                    header.msg_control = descriptors.isEmpty ? nil : control.baseAddress
                    header.msg_controllen = socklen_t(controlBytes)
                    return Darwin.sendmsg(descriptor, &header, 0)
                }
            }
        }
        guard count == data.count else { throw enrollmentTestError() }
    }
    func readResponse() throws -> Data {
        try withDescriptor { try Self.readResponse(from: $0) }
    }
    private static func readResponse(from descriptor: Int32) throws -> Data {
        var data = Data()
        let deadline = DispatchTime.now().uptimeNanoseconds + 7_000_000_000
        while data.count <= ClaudeProductWireCodec.maximumMessageBytes {
            try Self.waitReadable(descriptor, deadline: deadline)
            var byte: UInt8 = 0
            let count = Darwin.read(descriptor, &byte, 1)
            if count < 0, errno == EINTR { continue }
            guard count == 1 else { throw enrollmentTestError() }
            if byte == 10 { return data }
            data.append(byte)
        }
        throw enrollmentTestError()
    }
    static func makePipe() throws -> (read: Int32, write: Int32) {
        var descriptors: [Int32] = [-1, -1]
        guard Darwin.pipe(&descriptors) == 0 else { throw enrollmentTestError() }
        for descriptor in descriptors { _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC) }
        return (descriptors[0], descriptors[1])
    }
    static func readGrant(_ descriptor: Int32) throws -> Data {
        var data = Data()
        let deadline = DispatchTime.now().uptimeNanoseconds + 7_000_000_000
        while data.count <= 16 * 1024 {
            try waitReadable(descriptor, deadline: deadline)
            var buffer = [UInt8](repeating: 0, count: 4096)
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0, errno == EINTR { continue }
            guard count >= 0 else { throw enrollmentTestError() }
            if count == 0 { return data }
            data.append(contentsOf: buffer.prefix(count))
        }
        throw enrollmentTestError()
    }
    static func readExactly(_ descriptor: Int32, count: Int) throws -> Data {
        var data = Data()
        let deadline = DispatchTime.now().uptimeNanoseconds + 7_000_000_000
        while data.count < count {
            try waitReadable(descriptor, deadline: deadline)
            var buffer = [UInt8](repeating: 0, count: count - data.count)
            let received = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if received < 0, errno == EINTR { continue }
            guard received > 0 else { throw enrollmentTestError() }
            data.append(contentsOf: buffer.prefix(received))
        }
        return data
    }
    private static func waitReadable(_ descriptor: Int32, deadline: UInt64) throws {
        while DispatchTime.now().uptimeNanoseconds < deadline {
            var item = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
            let result = poll(&item, 1, 100)
            if result < 0, errno == EINTR { continue }
            guard result >= 0, item.revents & Int16(POLLNVAL) == 0 else { throw enrollmentTestError() }
            if result > 0 { return }
        }
        throw enrollmentTestError()
    }
}

enum EnrollmentBehavior: Sendable { case normal, fail, reflectSecret, deliverTwice, noGrant, oversizedGrant, pause }

private final class EnrollmentRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    private var disconnects: [UUID] = []
    let entered = DispatchSemaphore(value: 0)
    let resume = DispatchSemaphore(value: 0)
    private let changed = DispatchSemaphore(value: 0)
    var callCount: Int { lock.withLock { calls } }
    var disconnectCount: Int { lock.withLock { disconnects.count } }
    var disconnectedIDs: [UUID] { lock.withLock { disconnects } }
    func called() { lock.withLock { calls += 1 }; entered.signal() }
    func disconnected(_ id: UUID) { lock.withLock { disconnects.append(id) }; changed.signal() }
    func waitForDisconnects(_ count: Int) throws {
        let deadline = DispatchTime.now() + 7
        while disconnectCount < count {
            guard changed.wait(timeout: deadline) == .success else { throw enrollmentTestError() }
        }
    }
}

private final class EnrollmentPeerState: @unchecked Sendable {
    private let lock = NSLock()
    private var observations = 0
    func next(_ peer: ClaudeSessionEnrollment.PeerIdentity) -> ClaudeSessionEnrollment.PeerIdentity {
        lock.withLock {
            observations += 1
            return observations == 1 ? peer : ClaudeSessionEnrollment.testingIdentity(pid: peer.pid, startTime: peer.startTime + 1)
        }
    }
}

private final class EnrollmentFixture {
    static let secret = String(repeating: "ab", count: 32)
    static let grant = Data(("private grant " + secret).utf8)
    let root: URL
    let socketPath: String
    let runtimeIdentity: String
    let corpus = RuntimeSecretCorpus()
    let recorder = EnrollmentRecorder()
    let endpoint: ClaudeSessionEnrollment

    init(production: Bool = false, behavior: EnrollmentBehavior = .normal,
         control: ClaudeSessionEnrollment.Control? = nil,
         peerVerifier: @escaping @Sendable (Int32) throws -> ClaudeSessionEnrollment.PeerIdentity = {
             try ClaudeSessionEnrollment.testingPeer($0)
         }) throws {
        root = URL(fileURLWithPath: "/private/tmp/be-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        socketPath = root.appendingPathComponent("owner.sock").path
        runtimeIdentity = production ? try OperationalRuntimeIdentity.requireCurrent() : "sha256:" + String(repeating: "b", count: 64)
        corpus.register(Self.secret)
        let recorder = self.recorder
        let corpus = self.corpus
        let incarnation = UUID()
        let enroll: ClaudeSessionEnrollment.Enroll = { connectionID, request, deliver in
            recorder.called()
            if behavior == .pause {
                guard recorder.resume.wait(timeout: .now() + 5) == .success else { throw enrollmentTestError() }
            }
            if behavior == .fail { throw CoordinatorError(Self.secret) }
            if behavior == .oversizedGrant { try deliver(Data(repeating: 1, count: 16 * 1024 + 1)) }
            if behavior != .noGrant { try deliver(Self.grant) }
            if behavior == .deliverTwice { try? deliver(Self.grant) }
            let original = try StrictJSONTransport.object(from: request.canonicalJSON)
            let payload = original["payload"] as! [String: Any]
            let object: [String: Any] = [
                "schema_version": "blabee.claude-owner.v1", "kind": "response", "provider": "claude",
                "request_id": request.requestID.uuidString.lowercased(), "role": "owner", "operation": "enroll",
                "authority": ["scope_id": UUID().uuidString.lowercased(), "native_session_id": UUID().uuidString.lowercased(),
                    "session_incarnation": UUID().uuidString.lowercased(), "service_incarnation": incarnation.uuidString.lowercased(),
                    "owner_connection_id": connectionID.uuidString.lowercased(), "authority_epoch": UUID().uuidString.lowercased()],
                "ok": true,
                "result": ["core_session_id": behavior == .reflectSecret ? Self.secret : "core_fixture",
                    "lease": ["deadline_nanoseconds": "10000000000", "renewal_sequence": "0"],
                    "grant_delivery": "private_pipe", "grant_pipe_id": payload["grant_pipe_id"] as! String],
            ]
            return try StrictJSONTransport.data(forJSONObject: object)
        }
        if production {
            endpoint = try ClaudeSessionEnrollment(socketPath: socketPath, runtimeIdentity: runtimeIdentity,
                serviceIncarnation: incarnation, secretCorpus: corpus, enroll: enroll,
                control: control,
                disconnected: { recorder.disconnected($0) })
        } else {
            endpoint = try ClaudeSessionEnrollment.makeTesting(socketPath: socketPath, runtimeIdentity: runtimeIdentity,
                serviceIncarnation: incarnation, secretCorpus: corpus, peerVerifier: peerVerifier,
                enroll: enroll, control: control, disconnected: { recorder.disconnected($0) })
        }
        try endpoint.start()
    }
    func cleanup() {
        recorder.resume.signal()
        endpoint.stop()
        // No installed/runtime path is reachable through this fixture-owned root.
        try? FileManager.default.removeItem(at: root)
    }
}

private final class EnrollmentControlRecord: @unchecked Sendable {
    private let lock = NSLock()
    private let paused: Bool
    private var calls: [String] = []
    private var didFinish = false
    let entered = DispatchSemaphore(value: 0)
    let resume = DispatchSemaphore(value: 0)
    var operations: [String] { lock.withLock { calls } }
    var finished: Bool { lock.withLock { didFinish } }
    init(paused: Bool = false) { self.paused = paused }
    func handle(_ connectionID: UUID, _ request: ClaudeProductWireCodec.Envelope) throws -> Data {
        lock.withLock { calls.append(request.operation) }
        entered.signal()
        if paused {
            guard resume.wait(timeout: .now() + 5) == .success else { throw enrollmentTestError() }
        }
        defer { lock.withLock { didFinish = true } }
        var response = try StrictJSONTransport.object(from: request.canonicalJSON)
        guard (response["authority"] as? [String: String])?["owner_connection_id"] == connectionID.uuidString.lowercased() else {
            throw enrollmentTestError()
        }
        let payload = response.removeValue(forKey: "payload") as! [String: String]
        response["kind"] = "response"
        response["ok"] = true
        response["result"] = request.operation == "end" ? ["ended": true] : [
            "lease": ["deadline_nanoseconds": "10000000100", "renewal_sequence": payload["renewal_sequence"]!],
        ]
        return try StrictJSONTransport.data(forJSONObject: response)
    }
}

private final class EnrollmentControlPeer: @unchecked Sendable {
    private let lock = NSLock()
    private var changed = false
    func replace() { lock.withLock { changed = true } }
    func observe(_ descriptor: Int32) throws -> ClaudeSessionEnrollment.PeerIdentity {
        let peer = try ClaudeSessionEnrollment.testingPeer(descriptor)
        return lock.withLock {
            changed ? ClaudeSessionEnrollment.testingIdentity(pid: peer.pid, startTime: peer.startTime + 1) : peer
        }
    }
}

private func enrollmentTestError() -> CoordinatorError { CoordinatorError("enrollment_test_failed") }
#endif
