import Foundation
import Darwin

enum PetFailure: LocalizedError {
    case invalid(String)
    case system(String, Int32)
    case alreadyRunning

    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        case .system(let operation, let code): return "\(operation): \(String(cString: strerror(code)))"
        case .alreadyRunning: return "Blabee Claude is already running for this runtime."
        }
    }
}

struct RuntimeConfiguration: Codable, Sendable {
    let runtime: String
    let node: String
    let service: String

    static func load(arguments: [String]) throws -> (RuntimeConfiguration, String, Double) {
        var values: [String: String] = [:]
        var mode = "app"
        var hold: Double = 2
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--diagnose", "--probe-instance":
                guard mode == "app" else { throw PetFailure.invalid("Choose only one diagnostic mode.") }
                mode = argument
            case "--runtime", "--node", "--service", "--hold-seconds":
                index += 1
                guard index < arguments.count, values[argument] == nil else {
                    throw PetFailure.invalid("Missing or duplicate value for \(argument).")
                }
                values[argument] = arguments[index]
            default: throw PetFailure.invalid("Unknown argument: \(argument)")
            }
            index += 1
        }
        if let value = values["--hold-seconds"] {
            guard mode == "--probe-instance", let seconds = Double(value), seconds.isFinite,
                  seconds > 0, seconds <= 60 else {
                throw PetFailure.invalid("--hold-seconds requires --probe-instance and a value in (0, 60].")
            }
            hold = seconds
        }
        var bundled: RuntimeConfiguration?
        if let url = Bundle.main.resourceURL?.appendingPathComponent("runtime-config.json"),
           FileManager.default.fileExists(atPath: url.path) {
            bundled = try JSONDecoder().decode(RuntimeConfiguration.self, from: Data(contentsOf: url))
        }
        guard let runtime = values["--runtime"] ?? bundled?.runtime else {
            throw PetFailure.invalid("Provide --runtime ABS, or Resources/runtime-config.json.")
        }
        let node = values["--node"] ?? bundled?.node ?? ""
        let service = values["--service"] ?? bundled?.service ?? ""
        try validateAbsolute(runtime, name: "runtime")
        for (name, path) in [("node", node), ("service", service)] where !path.isEmpty {
            try validateAbsolute(path, name: name)
        }
        // This product must never acquire a legacy Codex Pet lease.
        let legacySuffix = "/Library/Application Support/Blabee"
        guard !runtime.contains(legacySuffix + "/"), !runtime.hasSuffix(legacySuffix) else {
            throw PetFailure.invalid("The Codex Blabee runtime cannot be used by Blabee Claude.")
        }
        if mode == "app" {
            guard !node.isEmpty, FileManager.default.isExecutableFile(atPath: node) else {
                throw PetFailure.invalid("--node must identify an executable Node binary.")
            }
            var isDirectory: ObjCBool = false
            guard !service.isEmpty, FileManager.default.fileExists(atPath: service, isDirectory: &isDirectory),
                  !isDirectory.boolValue, FileManager.default.isReadableFile(atPath: service) else {
                throw PetFailure.invalid("--service must identify a readable coordinator entry point.")
            }
        }
        return (RuntimeConfiguration(runtime: runtime, node: node, service: service), mode, hold)
    }

    private static func validateAbsolute(_ path: String, name: String) throws {
        guard path.hasPrefix("/"), !path.utf8.contains(0), path != "/",
              !path.split(separator: "/").contains(".."),
              !path.split(separator: "/").contains(".") else {
            throw PetFailure.invalid("\(name) must be an absolute path without dot components.")
        }
    }
}

/// Kernel-held, Claude-runtime-local lease. Existing lock files are never removed.
final class PetInstanceLease {
    private var descriptor: Int32 = -1
    let path: String

    init(runtime: String) throws {
        path = runtime + "/pet/instance-v1.lock"
        let runtimeFD = try Self.openDirectoryTree(runtime)
        defer { close(runtimeFD) }
        try Self.validateDirectory(runtimeFD, name: "Claude runtime")
        if mkdirat(runtimeFD, "pet", 0o700) != 0, errno != EEXIST {
            throw PetFailure.system("Create Claude Pet directory", errno)
        }
        let petFD = openat(runtimeFD, "pet", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard petFD >= 0 else { throw PetFailure.system("Open Claude Pet directory", errno) }
        defer { close(petFD) }
        try Self.validateDirectory(petFD, name: "Claude Pet directory")
        let fd = openat(petFD, "instance-v1.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw PetFailure.system("Open Claude Pet lock", errno) }
        var info = stat()
        guard fstat(fd, &info) == 0 else {
            let failure = errno; close(fd); throw PetFailure.system("Inspect Claude Pet lock", failure)
        }
        guard (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == geteuid(),
              info.st_nlink == 1, (info.st_mode & 0o777) == 0o600 else {
            close(fd); throw PetFailure.invalid("Claude Pet lock must be a private, single-link file owned by this user.")
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let failure = errno
            close(fd)
            if failure == EWOULDBLOCK { throw PetFailure.alreadyRunning }
            throw PetFailure.system("Lock Claude Pet instance", failure)
        }
        descriptor = fd
    }

    deinit { if descriptor >= 0 { close(descriptor) } }

    private static func validateDirectory(_ fd: Int32, name: String) throws {
        var info = stat()
        guard fstat(fd, &info) == 0 else { throw PetFailure.system("Inspect \(name)", errno) }
        guard info.st_uid == geteuid(), (info.st_mode & S_IFMT) == S_IFDIR,
              (info.st_mode & 0o777) == 0o700 else {
            throw PetFailure.invalid("\(name) must be owned by this user with mode 0700.")
        }
    }

    private static func openDirectoryTree(_ path: String) throws -> Int32 {
        var current = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard current >= 0 else { throw PetFailure.system("Open filesystem root", errno) }
        for component in path.split(separator: "/") {
            let name = String(component)
            if mkdirat(current, name, 0o700) != 0, errno != EEXIST {
                let failure = errno; close(current)
                throw PetFailure.system("Create Claude runtime directory", failure)
            }
            let next = openat(current, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else {
                let failure = errno; close(current)
                throw PetFailure.system("Open Claude runtime directory without symlinks", failure)
            }
            close(current)
            current = next
        }
        return current
    }
}

func writeJSON(_ object: [String: Any]) throws {
    var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    data.append(0x0a)
    FileHandle.standardOutput.write(data)
}
