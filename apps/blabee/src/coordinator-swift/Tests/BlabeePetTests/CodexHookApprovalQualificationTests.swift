import CoordinatorSwift
import Foundation
import Security
import Testing
@testable import BlabeeCoordinator

@Suite("CodexHookApprovalQualification")
struct CodexHookApprovalQualificationTests {
    private typealias Gate = CodexHookApprovalQualification

    @Test("live signing reader requests the Signing fields including Team ID")
    func signingReaderRequestsTeamIdentifier() throws {
        var currentCode: SecCode?
        #expect(SecCodeCopySelf(SecCSFlags(), &currentCode) == errSecSuccess)
        let code = try #require(currentCode)
        var reads = 0
        let result = Gate.signingInformation(for: code) { subject, flags, information in
            reads += 1
            #expect(Unmanaged.passUnretained(subject).toOpaque()
                == Unmanaged.passUnretained(code).toOpaque())
            #expect(flags.rawValue == kSecCSSigningInformation)
            // Reproduce Security's contract: generic fields do not contain Team ID.
            var fields: [CFString: Any] = [kSecCodeInfoIdentifier: "codex"]
            if flags.rawValue & kSecCSSigningInformation != 0 {
                fields[kSecCodeInfoTeamIdentifier] = Gate.codexTeamIdentifier
            }
            information.pointee = fields as CFDictionary
            return errSecSuccess
        }

        #expect(reads == 1)
        #expect(result?[kSecCodeInfoIdentifier] as? String == "codex")
        #expect(result?[kSecCodeInfoTeamIdentifier] as? String == Gate.codexTeamIdentifier)
    }

    @Test("failed or missing signing information is not usable evidence")
    func signingReaderFailsClosed() throws {
        var currentCode: SecCode?
        #expect(SecCodeCopySelf(SecCSFlags(), &currentCode) == errSecSuccess)
        let code = try #require(currentCode)

        #expect(Gate.signingInformation(for: code) { _, _, information in
            information.pointee = [kSecCodeInfoTeamIdentifier: Gate.codexTeamIdentifier]
                as CFDictionary
            return errSecParam
        } == nil)
        #expect(Gate.signingInformation(for: code) { _, _, _ in errSecSuccess } == nil)
    }

    @Test("exact qualified live Codex may be the direct parent")
    func directParentQualifies() {
        let fixture = HookQualificationFixture(shells: [])

        #expect(fixture.evaluate() == HookPermissionPolicy.qualifiedRuntime)
        #expect(fixture.signatureRequests.map(\.1) == [.qualifiedCodex, .qualifiedCodex])
        #expect(fixture.processReads.keys.sorted() == [90, 100])
    }

    @Test("persistent launcher sh and outer Codex shell are supported")
    func launcherShapedChainQualifies() {
        let fixture = HookQualificationFixture(shells: ["/bin/sh", "/bin/zsh"])

        #expect(fixture.evaluate() == HookPermissionPolicy.qualifiedRuntime)
        #expect(fixture.signatureRequests.map(\.1) == [
            .systemShell(identifier: "com.apple.sh"),
            .systemShell(identifier: "com.apple.zsh"),
            .qualifiedCodex,
            .qualifiedCodex,
            .systemShell(identifier: "com.apple.zsh"),
            .systemShell(identifier: "com.apple.sh"),
        ])
        #expect(fixture.processReads.values.allSatisfy { $0 <= 3 })
    }

    @Test("at most four ancestors are inspected")
    func boundedAncestry() {
        let atLimit = HookQualificationFixture(shells: ["/bin/sh", "/bin/bash", "/bin/zsh"])
        #expect(atLimit.evaluate() == HookPermissionPolicy.qualifiedRuntime)

        let tooDeep = HookQualificationFixture(shells: Array(repeating: "/bin/sh", count: 4))
        #expect(tooDeep.evaluate() == nil)
        #expect(tooDeep.processReads[tooDeep.codexID] == nil)
        #expect(tooDeep.signatureRequests.count == Gate.maximumAncestorCount)
    }

    @Test("wrong identifier, team, hash or invalid signature never qualifies")
    func rejectsUnqualifiedCodeIdentity() {
        let invalidSignatures: [Gate.SignatureEvidence?] = [
            nil,
            .init(identifier: "not-codex", teamIdentifier: Gate.codexTeamIdentifier,
                  cdHash: HookPermissionPolicy.qualifiedCDHash, requirementSatisfied: true),
            .init(identifier: "codex", teamIdentifier: "OTHERTEAM",
                  cdHash: HookPermissionPolicy.qualifiedCDHash, requirementSatisfied: true),
            .init(identifier: "codex", teamIdentifier: nil,
                  cdHash: HookPermissionPolicy.qualifiedCDHash, requirementSatisfied: true),
            .init(identifier: "codex", teamIdentifier: Gate.codexTeamIdentifier,
                  cdHash: String(repeating: "0", count: 40), requirementSatisfied: true),
            .init(identifier: "codex", teamIdentifier: Gate.codexTeamIdentifier,
                  cdHash: HookPermissionPolicy.qualifiedCDHash, requirementSatisfied: false),
        ]
        for signature in invalidSignatures {
            let fixture = HookQualificationFixture(shells: [])
            fixture.signatures[fixture.codexID] = signature
            #expect(fixture.evaluate() == nil)
        }
    }

    @Test("system-shell path alone cannot authorize an intermediate")
    func requiresAppleShellIdentity() {
        for signature in [
            Gate.SignatureEvidence(identifier: "fake.sh", teamIdentifier: nil,
                                  cdHash: "fake", requirementSatisfied: true),
            Gate.SignatureEvidence(identifier: "com.apple.sh", teamIdentifier: nil,
                                  cdHash: "fake", requirementSatisfied: false),
        ] {
            let fixture = HookQualificationFixture()
            fixture.signatures[90] = signature
            #expect(fixture.evaluate() == nil)
            #expect(fixture.processReads[fixture.codexID] == nil)
        }
    }

    @Test("an arbitrary intermediary cannot be skipped to find a Codex ancestor")
    func rejectsUnexpectedIntermediate() {
        let fixture = HookQualificationFixture()
        fixture.replaceProcess(90, path: "/usr/local/bin/process-broker")

        #expect(fixture.evaluate() == nil)
        #expect(fixture.processReads[fixture.codexID] == nil)
        #expect(fixture.signatureRequests.map(\.1) == [.qualifiedCodex])
    }

    @Test("all processes must have the current effective UID")
    func rejectsDifferentOwner() {
        for processID: Int32 in [100, 90, 80] {
            let fixture = HookQualificationFixture()
            fixture.replaceProcess(processID, userID: 502)
            #expect(fixture.evaluate() == nil)
        }
    }

    @Test("missing or inconsistent process evidence fails closed")
    func rejectsIncompleteProcessEvidence() {
        for processID: Int32 in [100, 90, 80] {
            let fixture = HookQualificationFixture()
            fixture.processes[processID] = nil
            #expect(fixture.evaluate() == nil)
        }
        let wrongPID = HookQualificationFixture()
        wrongPID.processes[90] = wrongPID.processes[80]
        #expect(wrongPID.evaluate() == nil)
    }

    @Test("cycles, reparenting to init and impossible birth order fail closed")
    func rejectsBrokenParentChain() {
        let cycle = HookQualificationFixture()
        cycle.replaceProcess(90, parentID: 100)
        #expect(cycle.evaluate() == nil)

        let noParent = HookQualificationFixture()
        noParent.replaceProcess(90, parentID: 1)
        #expect(noParent.evaluate() == nil)

        let newParent = HookQualificationFixture()
        newParent.replaceProcess(90, start: 2_000)
        #expect(newParent.evaluate() == nil)

        let unknownBirth = HookQualificationFixture()
        unknownBirth.replaceProcess(90, start: 0)
        #expect(unknownBirth.evaluate() == nil)
    }

    @Test("PID reuse, reparenting, UID and executable changes invalidate qualification")
    func detectsProcessChangesDuringValidation() {
        let changes: [(Gate.ProcessEvidence) -> Gate.ProcessEvidence?] = [
            { _ in nil },
            { replacing($0, parentID: 1) },
            { replacing($0, userID: 502) },
            { replacing($0, start: $0.startSeconds + 1) },
            { replacing($0, path: "/usr/bin/other-program") },
        ]
        for change in changes {
            let fixture = HookQualificationFixture()
            fixture.onProcessRead = { pid, count, evidence in
                pid == 90 && count >= 2 ? change(evidence) : evidence
            }
            #expect(fixture.evaluate() == nil)
        }
    }

    @Test("the Hook process is rechecked after ancestor signatures")
    func detectsCurrentProcessReparenting() {
        let fixture = HookQualificationFixture()
        fixture.onProcessRead = { pid, count, evidence in
            pid == 100 && count >= 2 ? replacing(evidence, parentID: 1) : evidence
        }
        #expect(fixture.evaluate() == nil)
    }

    @Test("same path and PID cannot conceal changed running code identity")
    func detectsSignatureChangesDuringValidation() {
        for targetID: Int32 in [90, 80] {
            let fixture = HookQualificationFixture()
            fixture.onSignatureRead = { pid, count, evidence in
                guard pid == targetID && count >= 2 else { return evidence }
                return Gate.SignatureEvidence(
                    identifier: evidence.identifier, teamIdentifier: evidence.teamIdentifier,
                    cdHash: "different-running-code", requirementSatisfied: true
                )
            }
            #expect(fixture.evaluate() == nil)
        }
    }

    @Test("a process change during the last signature check is still detected")
    func finalChainReadDetectsLateReparenting() {
        let fixture = HookQualificationFixture()
        fixture.onSignatureRead = { pid, count, evidence in
            if pid == 90 && count == 2 {
                fixture.replaceProcess(80, parentID: 999)
            }
            return evidence
        }
        #expect(fixture.evaluate() == nil)
    }

    @Test("a version-like installed path is not a runtime qualification override")
    func versionTextDoesNotQualify() {
        let fixture = HookQualificationFixture(shells: [])
        fixture.replaceProcess(fixture.codexID, path: "/installed/0.153.4/codex")
        fixture.signatures[fixture.codexID] = nil
        #expect(fixture.evaluate() == nil)
    }

    @Test("Security requirements parse and pin the qualified signed runtime")
    func requirementsAreValidAndExact() {
        for expected in [
            Gate.CodeRequirement.qualifiedCodex,
            .systemShell(identifier: "com.apple.sh"),
            .systemShell(identifier: "com.apple.zsh"),
            .systemShell(identifier: "com.apple.bash"),
        ] {
            var requirement: SecRequirement?
            #expect(SecRequirementCreateWithString(
                expected.expression as CFString, SecCSFlags(), &requirement
            ) == errSecSuccess)
            #expect(requirement != nil)
        }
        let expression = Gate.CodeRequirement.qualifiedCodex.expression
        #expect(expression.contains("anchor apple generic"))
        #expect(expression.contains("identifier \"codex\""))
        #expect(expression.contains(Gate.codexTeamIdentifier))
        #expect(expression.contains("cdhash H\"\(HookPermissionPolicy.qualifiedCDHash)\""))
    }
}

private typealias HookGate = CodexHookApprovalQualification

private final class HookQualificationFixture {
    var processes: [Int32: HookGate.ProcessEvidence] = [:]
    var signatures: [Int32: HookGate.SignatureEvidence] = [:]
    var processReads: [Int32: Int] = [:]
    var signatureReads: [Int32: Int] = [:]
    var signatureRequests: [(Int32, HookGate.CodeRequirement)] = []
    var onProcessRead: ((Int32, Int, HookGate.ProcessEvidence) -> HookGate.ProcessEvidence?)?
    var onSignatureRead: ((Int32, Int, HookGate.SignatureEvidence) -> HookGate.SignatureEvidence?)?
    let codexID: Int32

    init(shells: [String] = ["/bin/sh"]) {
        let paths = ["/Applications/Blabee.app/Contents/MacOS/blabee-coordinator"]
            + shells + ["/official/standalone/current/bin/codex"]
        codexID = 100 - Int32(paths.count - 1) * 10
        for (index, path) in paths.enumerated() {
            let pid = 100 - Int32(index) * 10
            processes[pid] = .init(
                processID: pid, parentProcessID: pid == codexID ? 1 : pid - 10,
                effectiveUserID: 501, startSeconds: 1_000 - UInt64(index) * 100,
                startMicroseconds: 0, executablePath: path
            )
            if pid == codexID {
                signatures[pid] = .init(
                    identifier: "codex", teamIdentifier: HookGate.codexTeamIdentifier,
                    cdHash: HookPermissionPolicy.qualifiedCDHash, requirementSatisfied: true
                )
            } else if index > 0 {
                signatures[pid] = .init(
                    identifier: "com.apple.\((path as NSString).lastPathComponent)",
                    teamIdentifier: nil, cdHash: "system-shell-\(index)",
                    requirementSatisfied: true
                )
            }
        }
    }

    func replaceProcess(
        _ pid: Int32, parentID: Int32? = nil, userID: UInt32? = nil,
        start: UInt64? = nil, path: String? = nil
    ) {
        guard let process = processes[pid] else { return }
        processes[pid] = replacing(
            process, parentID: parentID, userID: userID, start: start, path: path
        )
    }

    func evaluate() -> String? {
        HookGate.qualification(
            processID: 100, effectiveUserID: 501,
            processEvidence: { pid in
                let count = self.processReads[pid, default: 0] + 1
                self.processReads[pid] = count
                guard let evidence = self.processes[pid] else { return nil }
                if let intercept = self.onProcessRead { return intercept(pid, count, evidence) }
                return evidence
            },
            signatureEvidence: { pid, requirement in
                self.signatureRequests.append((pid, requirement))
                let count = self.signatureReads[pid, default: 0] + 1
                self.signatureReads[pid] = count
                guard let evidence = self.signatures[pid] else { return nil }
                if let intercept = self.onSignatureRead { return intercept(pid, count, evidence) }
                return evidence
            }
        )
    }
}

private func replacing(
    _ value: HookGate.ProcessEvidence,
    parentID: Int32? = nil, userID: UInt32? = nil,
    start: UInt64? = nil, path: String? = nil
) -> HookGate.ProcessEvidence {
    .init(
        processID: value.processID, parentProcessID: parentID ?? value.parentProcessID,
        effectiveUserID: userID ?? value.effectiveUserID,
        startSeconds: start ?? value.startSeconds, startMicroseconds: value.startMicroseconds,
        executablePath: path ?? value.executablePath
    )
}
