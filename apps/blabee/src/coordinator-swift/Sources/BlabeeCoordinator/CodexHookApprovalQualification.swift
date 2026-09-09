import CoordinatorSwift
import Darwin
import Foundation
import Security

/// Qualifies the runtime which actually invoked this Hook. An installed binary,
/// a reported version, PATH, and caller-supplied environment are not evidence.
/// Failure disables Pet's allow-once option; native Codex remains in control.
enum CodexHookApprovalQualification {
    static let maximumAncestorCount = 4
    static let codexTeamIdentifier = "2DC432GLL2"

    struct ProcessEvidence: Equatable, Sendable {
        let processID: Int32
        let parentProcessID: Int32
        let effectiveUserID: UInt32
        let startSeconds: UInt64
        let startMicroseconds: UInt64
        let executablePath: String

        fileprivate func isValid(processID: Int32, effectiveUserID: UInt32) -> Bool {
            self.processID == processID && processID > 1
                && parentProcessID > 0 && parentProcessID != processID
                && self.effectiveUserID == effectiveUserID
                && startSeconds > 0 && startMicroseconds < 1_000_000
                && executablePath.hasPrefix("/")
                && !executablePath.utf8.contains(0)
        }

        fileprivate func existedBefore(_ child: ProcessEvidence) -> Bool {
            startSeconds < child.startSeconds
                || (startSeconds == child.startSeconds
                    && startMicroseconds <= child.startMicroseconds)
        }
    }

    struct SignatureEvidence: Equatable, Sendable {
        let identifier: String
        let teamIdentifier: String?
        let cdHash: String
        let requirementSatisfied: Bool
    }

    enum CodeRequirement: Equatable, Sendable {
        case qualifiedCodex
        case systemShell(identifier: String)

        var expression: String {
            switch self {
            case .qualifiedCodex:
                return "identifier \"codex\" and anchor apple generic "
                    + "and certificate leaf[subject.OU] = \"\(codexTeamIdentifier)\" "
                    + "and cdhash H\"\(HookPermissionPolicy.qualifiedCDHash)\""
            case .systemShell(let identifier):
                return "identifier \"\(identifier)\" and anchor apple"
            }
        }

        fileprivate func accepts(_ evidence: SignatureEvidence) -> Bool {
            guard evidence.requirementSatisfied else { return false }
            switch self {
            case .qualifiedCodex:
                return evidence.identifier == "codex"
                    && evidence.teamIdentifier == codexTeamIdentifier
                    && evidence.cdHash == HookPermissionPolicy.qualifiedCDHash
            case .systemShell(let identifier):
                return evidence.identifier == identifier && !evidence.cdHash.isEmpty
            }
        }
    }

    static func currentQualification() -> String? {
        qualification(
            processID: getpid(),
            effectiveUserID: geteuid(),
            processEvidence: runningProcessEvidence,
            signatureEvidence: runningSignatureEvidence
        )
    }

    /// Both readers are bounded local observations. There is deliberately no
    /// environment override, executable discovery, version subprocess or cache.
    static func qualification(
        processID: Int32,
        effectiveUserID: UInt32,
        processEvidence: (Int32) -> ProcessEvidence?,
        signatureEvidence: (Int32, CodeRequirement) -> SignatureEvidence?
    ) -> String? {
        guard let current = processEvidence(processID),
              current.isValid(processID: processID, effectiveUserID: effectiveUserID)
        else { return nil }

        var chain = [current]
        var signatures: [(CodeRequirement, SignatureEvidence)] = []
        var visited: Set<Int32> = [processID]
        var foundCodex = false

        for _ in 0..<maximumAncestorCount {
            let child = chain[chain.count - 1]
            let parentID = child.parentProcessID
            guard parentID > 1, visited.insert(parentID).inserted,
                  let parent = processEvidence(parentID),
                  parent.isValid(processID: parentID, effectiveUserID: effectiveUserID),
                  parent.existedBefore(child)
            else { return nil }

            let requirement: CodeRequirement
            switch parent.executablePath {
            case "/bin/sh": requirement = .systemShell(identifier: "com.apple.sh")
            case "/bin/zsh": requirement = .systemShell(identifier: "com.apple.zsh")
            case "/bin/bash": requirement = .systemShell(identifier: "com.apple.bash")
            default: requirement = .qualifiedCodex
            }
            guard let signature = signatureEvidence(parentID, requirement),
                  requirement.accepts(signature)
            else { return nil }
            chain.append(parent)
            signatures.append((requirement, signature))
            if requirement == .qualifiedCodex {
                foundCodex = true
                break
            }
        }
        guard foundCodex else { return nil }

        // Fail closed on missing/reparented/recycled processes or exec changes
        // during qualification. Re-check the dynamic signature as well as the
        // kernel path: an on-disk update must not qualify an older live runtime.
        for index in (1..<chain.count).reversed() {
            let process = chain[index]
            let (requirement, signature) = signatures[index - 1]
            guard processEvidence(process.processID) == process,
                  signatureEvidence(process.processID, requirement) == signature
            else { return nil }
        }
        guard chain.allSatisfy({ processEvidence($0.processID) == $0 }) else {
            return nil
        }
        return HookPermissionPolicy.qualifiedRuntime
    }

    private static func runningProcessEvidence(_ processID: Int32) -> ProcessEvidence? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        guard proc_pidinfo(processID, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_status != UInt32(SZOMB),
              let reportedID = Int32(exactly: info.pbi_pid),
              let parentID = Int32(exactly: info.pbi_ppid)
        else { return nil }

        // PROC_PIDPATHINFO_MAXSIZE is a C macro that newer Swift SDKs no
        // longer import. It is defined as 4 * MAXPATHLEN (4096 on macOS).
        var buffer = [UInt8](repeating: 0, count: 4 * 1024)
        let pathLength = buffer.withUnsafeMutableBytes { bytes in
            proc_pidpath(processID, bytes.baseAddress, UInt32(bytes.count))
        }
        guard pathLength > 0, let end = buffer.firstIndex(of: 0), end > 0,
              let path = String(bytes: buffer[..<end], encoding: .utf8)
        else { return nil }
        return ProcessEvidence(
            processID: reportedID,
            parentProcessID: parentID,
            effectiveUserID: info.pbi_uid,
            startSeconds: info.pbi_start_tvsec,
            startMicroseconds: info.pbi_start_tvusec,
            executablePath: path
        )
    }

    private static func runningSignatureEvidence(
        _ processID: Int32,
        requirement expected: CodeRequirement
    ) -> SignatureEvidence? {
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            expected.expression as CFString, SecCSFlags(), &requirement
        ) == errSecSuccess, let requirement else { return nil }

        var code: SecCode?
        let attributes = [kSecGuestAttributePid: NSNumber(value: processID)] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code)
                == errSecSuccess,
              let code,
              SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess
        else { return nil }

        guard let dictionary = signingInformation(for: code),
              let identifier = dictionary[kSecCodeInfoIdentifier] as? String,
              let cdHash = dictionary[kSecCodeInfoUnique] as? Data,
              SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess
        else { return nil }
        return SignatureEvidence(
            identifier: identifier,
            teamIdentifier: dictionary[kSecCodeInfoTeamIdentifier] as? String,
            cdHash: cdHash.map { String(format: "%02x", $0) }.joined(),
            requirementSatisfied: true
        )
    }

    /// Team ID belongs to the Signing information set, not the generic set
    /// returned with zero flags. Keep this read separate so tests exercise the
    /// actual flags passed to Security, rather than only a fabricated identity.
    static func signingInformation(
        for code: SecCode,
        using copyInformation: (
            SecStaticCode, SecCSFlags, UnsafeMutablePointer<CFDictionary?>
        ) -> OSStatus = { SecCodeCopySigningInformation($0, $1, $2) }
    ) -> [CFString: Any]? {
        // The C API accepts the running SecCode object. Swift exposes its shared
        // opaque type as SecStaticCode here; keep the dynamic object, never make
        // a fresh static-code reference from its pathname.
        let subject = unsafeBitCast(code, to: SecStaticCode.self)
        var information: CFDictionary?
        guard copyInformation(
            subject, SecCSFlags(rawValue: kSecCSSigningInformation), &information
        ) == errSecSuccess else { return nil }
        return information as? [CFString: Any]
    }
}
