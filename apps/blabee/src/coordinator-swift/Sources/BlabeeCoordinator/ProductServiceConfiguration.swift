import CoordinatorSwift
import Darwin
import Foundation

struct ProductServiceEnvironment: Equatable {
    let invocation: ProductInvocationEnvironment
    let resourceURL: URL?
    let applicationSupportURL: URL?

    static func live(
        bundle: Bundle = .main,
        fileManager: FileManager = .default
    ) throws -> ProductServiceEnvironment {
        ProductServiceEnvironment(
            invocation: .live(bundle: bundle),
            resourceURL: bundle.resourceURL,
            applicationSupportURL: try fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: false
            )
        )
    }
}

struct ProductServiceConfiguration: Equatable {
    let database: URL
    let key: URL
    let contracts: URL
    let socketPath: String
    let config: URL
    let enabledProjectPaths: [String]
}

enum ProductServiceBootstrap {
    static let maximumConfigBytes = 64 * 1024
    static let maximumEnabledProjects = 256
    static let maximumProjectPathBytes = 4_096

    static func resolve(
        arguments: [String],
        environment: ProductServiceEnvironment
    ) throws -> ProductServiceConfiguration {
        guard arguments.isEmpty else {
            throw CoordinatorError("invalid_arguments", "service does not accept arguments")
        }
        return try resolve(environment: environment)
    }

    static func resolve(
        environment: ProductServiceEnvironment
    ) throws -> ProductServiceConfiguration {
        guard ProductInvocationResolver.isExpectedAppBundle(environment.invocation),
              let bundleURL = environment.invocation.bundleURL?.standardizedFileURL,
              let rawResourceURL = environment.resourceURL,
              rawResourceURL.isFileURL,
              let resourceURL = environment.resourceURL?.standardizedFileURL,
              resourceURL == bundleURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("Resources", isDirectory: true)
                .standardizedFileURL,
              let applicationSupportURL = environment.applicationSupportURL,
              applicationSupportURL.isFileURL,
              applicationSupportURL.path.hasPrefix("/"),
              applicationSupportURL.standardizedFileURL.path != "/",
              !applicationSupportURL.path.utf8.contains(0)
        else {
            throw CoordinatorError(
                "product_service_bundle_invalid",
                "the product service requires the exact Blabee app bundle layout"
            )
        }

        let root = applicationSupportURL.standardizedFileURL
            .appendingPathComponent("Blabee", isDirectory: true)
        let database = root
            .appendingPathComponent("storage", isDirectory: true)
            .appendingPathComponent("coordinator.sqlite3", isDirectory: false)
        let key = root
            .appendingPathComponent("storage", isDirectory: true)
            .appendingPathComponent("coordinator.key", isDirectory: false)
        let socketURL = root
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("blabee.sock", isDirectory: false)
        let contracts = resourceURL
            .appendingPathComponent("Contracts", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
        var contractsInfo = stat()
        guard lstat(contracts.path, &contractsInfo) == 0,
              contractsInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
        else {
            throw CoordinatorError(
                "product_service_bundle_invalid",
                "the bundled Contracts/v1 path must be a real directory"
            )
        }
        let configDirectory = root.appendingPathComponent("config", isDirectory: true)
        let config = configDirectory.appendingPathComponent("service.json", isDirectory: false)
        let socketPath = try OperationalSocketPath.resolve(
            explicitPath: socketURL.path,
            environment: [:]
        )
        let enabledProjectPaths = try loadEnabledProjects(
            configDirectory: configDirectory,
            configFile: config
        )

        return ProductServiceConfiguration(
            database: database,
            key: key,
            contracts: contracts,
            socketPath: socketPath,
            config: config,
            enabledProjectPaths: enabledProjectPaths
        )
    }

    private static func loadEnabledProjects(
        configDirectory: URL,
        configFile: URL
    ) throws -> [String] {
        var pathInfo = stat()
        guard lstat(configDirectory.path, &pathInfo) == 0 else {
            if errno == ENOENT { return [] }
            throw unsafeConfiguration("the service config directory cannot be inspected")
        }
        guard pathInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              pathInfo.st_mode & 0o7777 == 0o700,
              pathInfo.st_uid == geteuid()
        else {
            throw unsafeConfiguration(
                "the service config directory must be owned by the current user with mode 0700"
            )
        }

        let directoryDescriptor = open(
            configDirectory.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else {
            throw unsafeConfiguration("the service config directory cannot be opened safely")
        }
        defer { close(directoryDescriptor) }

        var openedDirectoryInfo = stat()
        guard fstat(directoryDescriptor, &openedDirectoryInfo) == 0,
              openedDirectoryInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              openedDirectoryInfo.st_mode & 0o7777 == 0o700,
              openedDirectoryInfo.st_uid == geteuid(),
              openedDirectoryInfo.st_dev == pathInfo.st_dev,
              openedDirectoryInfo.st_ino == pathInfo.st_ino
        else {
            throw unsafeConfiguration("the service config directory changed while opening")
        }

        let fileDescriptor = openat(
            directoryDescriptor,
            configFile.lastPathComponent,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard fileDescriptor >= 0 else {
            if errno == ENOENT { return [] }
            throw unsafeConfiguration("the service config file cannot be opened safely")
        }
        defer { close(fileDescriptor) }

        var fileInfo = stat()
        guard fstat(fileDescriptor, &fileInfo) == 0,
              fileInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              fileInfo.st_mode & 0o7777 == 0o600,
              fileInfo.st_uid == geteuid(),
              fileInfo.st_size >= 0,
              fileInfo.st_size <= off_t(maximumConfigBytes)
        else {
            throw unsafeConfiguration(
                "the service config must be a current-user regular file with mode 0600 within 64 KiB"
            )
        }

        let data = try readBoundedFile(fileDescriptor, initialInfo: fileInfo)
        return try decodeEnabledProjects(data)
    }

    private static func readBoundedFile(
        _ descriptor: Int32,
        initialInfo: stat
    ) throws -> Data {
        let expectedBytes = Int(initialInfo.st_size)
        var data = Data()
        data.reserveCapacity(expectedBytes)
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { bytes in
                Darwin.read(descriptor, bytes.baseAddress, bytes.count)
            }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw unsafeConfiguration("the service config could not be read")
            }
            guard count <= maximumConfigBytes - data.count else {
                throw unsafeConfiguration("the service config exceeds 64 KiB")
            }
            data.append(contentsOf: buffer.prefix(count))
        }

        var finalInfo = stat()
        guard data.count == expectedBytes,
              fstat(descriptor, &finalInfo) == 0,
              finalInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              finalInfo.st_mode & 0o7777 == 0o600,
              finalInfo.st_uid == geteuid(),
              finalInfo.st_dev == initialInfo.st_dev,
              finalInfo.st_ino == initialInfo.st_ino,
              finalInfo.st_size == initialInfo.st_size
        else {
            throw unsafeConfiguration("the service config changed while reading")
        }
        return data
    }

    private static func decodeEnabledProjects(_ data: Data) throws -> [String] {
        let object: [String: Any]
        do {
            object = try StrictJSONTransport.object(
                from: data,
                limits: StrictJSONLimits(maximumBytes: maximumConfigBytes, maximumDepth: 8)
            )
        } catch {
            throw invalidConfiguration("the service config is not strict JSON")
        }

        guard Set(object.keys) == Set(["schema_version", "enabled_projects"]),
              object["schema_version"] as? String == "1.0",
              let projects = object["enabled_projects"] as? [Any],
              projects.count <= maximumEnabledProjects
        else {
            throw invalidConfiguration("the service config schema is invalid")
        }

        var normalized: [String] = []
        normalized.reserveCapacity(projects.count)
        var seen: Set<String> = []
        for value in projects {
            guard let path = value as? String,
                  !path.isEmpty,
                  path.hasPrefix("/"),
                  !path.utf8.contains(0),
                  path.utf8.count <= maximumProjectPathBytes
            else {
                throw invalidConfiguration("enabled project paths must be bounded absolute paths")
            }
            let standardized = URL(fileURLWithPath: path, isDirectory: true)
                .standardizedFileURL.path
            guard seen.insert(standardized).inserted else {
                throw invalidConfiguration("enabled project paths must remain unique after normalization")
            }
            normalized.append(standardized)
        }
        return normalized.sorted { left, right in
            left.utf8.lexicographicallyPrecedes(right.utf8)
        }
    }

    private static func unsafeConfiguration(_ message: String) -> CoordinatorError {
        CoordinatorError("product_service_config_unsafe", message)
    }

    private static func invalidConfiguration(_ message: String) -> CoordinatorError {
        CoordinatorError("product_service_config_invalid", message)
    }
}
