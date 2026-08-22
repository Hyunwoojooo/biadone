import CoordinatorSwift
import Darwin
import Foundation

package struct ProductServiceEnvironment: Equatable {
    package let invocation: ProductInvocationEnvironment
    package let resourceURL: URL?
    package let applicationSupportURL: URL?

    package init(
        invocation: ProductInvocationEnvironment,
        resourceURL: URL?,
        applicationSupportURL: URL?
    ) {
        self.invocation = invocation
        self.resourceURL = resourceURL
        self.applicationSupportURL = applicationSupportURL
    }

    package static func live(
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

package struct ProductServiceConfiguration: Equatable {
    package let database: URL
    package let key: URL
    package let contracts: URL
    package let socketPath: String
    package let config: URL
    package let enabledProjectPaths: [String]

    package init(
        database: URL,
        key: URL,
        contracts: URL,
        socketPath: String,
        config: URL,
        enabledProjectPaths: [String]
    ) {
        self.database = database
        self.key = key
        self.contracts = contracts
        self.socketPath = socketPath
        self.config = config
        self.enabledProjectPaths = enabledProjectPaths
    }
}

struct ProductServicePaths: Equatable {
    let applicationSupport: URL
    let database: URL
    let key: URL
    let contracts: URL
    let socketPath: String
    let config: URL
}

enum ProductServiceSecureFilesystem {
    static func normalizedSystemAlias(_ path: String) -> String {
        if path == "/var" { return "/private/var" }
        if path.hasPrefix("/var/") { return "/private" + path }
        if path == "/tmp" { return "/private/tmp" }
        if path.hasPrefix("/tmp/") { return "/private" + path }
        return path
    }

    static func openExistingApplicationSupport(_ url: URL) throws -> Int32 {
        guard let descriptor = try openApplicationSupport(url, allowMissing: false) else {
            throw unsafeConfiguration("the Application Support directory does not exist")
        }
        return descriptor
    }

    static func openExistingApplicationSupportIfPresent(_ url: URL) throws -> Int32? {
        try openApplicationSupport(url, allowMissing: true)
    }

    static func openExistingSecureDirectory(
        parentDescriptor: Int32,
        name: String
    ) throws -> Int32? {
        var namedInfo = stat()
        guard fstatat(parentDescriptor, name, &namedInfo, AT_SYMLINK_NOFOLLOW) == 0 else {
            if errno == ENOENT { return nil }
            throw unsafeConfiguration("the service config directory cannot be inspected")
        }
        guard namedInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              namedInfo.st_mode & 0o7777 == 0o700,
              namedInfo.st_uid == geteuid()
        else {
            throw unsafeConfiguration(
                "the service config directory must be owned by the current user with mode 0700"
            )
        }

        let descriptor = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw unsafeConfiguration("the service config directory cannot be opened safely")
        }
        var openedInfo = stat()
        guard fstat(descriptor, &openedInfo) == 0,
              openedInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              openedInfo.st_mode & 0o7777 == 0o700,
              openedInfo.st_uid == geteuid(),
              openedInfo.st_dev == namedInfo.st_dev,
              openedInfo.st_ino == namedInfo.st_ino
        else {
            close(descriptor)
            throw unsafeConfiguration("the service config directory changed while opening")
        }
        return descriptor
    }

    private static func openApplicationSupport(
        _ url: URL,
        allowMissing: Bool
    ) throws -> Int32? {
        let path = normalizedSystemAlias(url.standardizedFileURL.path)
        guard path.hasPrefix("/"), path != "/" else {
            throw unsafeConfiguration("the Application Support path is invalid")
        }
        let components = path.split(separator: "/").map(String.init)
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw unsafeConfiguration("the filesystem root cannot be opened")
        }
        do {
            for component in components {
                let next = openat(
                    descriptor,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
                if next < 0, allowMissing, errno == ENOENT {
                    close(descriptor)
                    return nil
                }
                guard next >= 0 else {
                    throw unsafeConfiguration(
                        "the Application Support path contains an unsafe component"
                    )
                }
                close(descriptor)
                descriptor = next
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_uid == geteuid(),
                  info.st_mode & 0o022 == 0
            else {
                throw unsafeConfiguration(
                    "the Application Support directory must be current-user owned and not group or other writable"
                )
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func unsafeConfiguration(_ message: String) -> CoordinatorError {
        CoordinatorError("product_service_config_unsafe", message)
    }
}

package enum ProductServiceBootstrap {
    package static let maximumConfigBytes = 64 * 1024
    package static let maximumEnabledProjects = 256
    package static let maximumProjectPathBytes = 4_096

    package static func resolve(
        arguments: [String],
        environment: ProductServiceEnvironment
    ) throws -> ProductServiceConfiguration {
        guard arguments.isEmpty else {
            throw CoordinatorError("invalid_arguments", "service does not accept arguments")
        }
        return try resolve(environment: environment)
    }

    package static func resolve(
        environment: ProductServiceEnvironment
    ) throws -> ProductServiceConfiguration {
        let paths = try resolvePaths(environment: environment)
        let enabledProjectPaths = try loadEnabledProjects(
            applicationSupport: paths.applicationSupport
        )

        return ProductServiceConfiguration(
            database: paths.database,
            key: paths.key,
            contracts: paths.contracts,
            socketPath: paths.socketPath,
            config: paths.config,
            enabledProjectPaths: enabledProjectPaths
        )
    }

    static func resolvePaths(
        environment: ProductServiceEnvironment
    ) throws -> ProductServicePaths {
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
        let socketPath = socketURL.standardizedFileURL.path
        let socketAddress = sockaddr_un()
        let socketPathCapacity = MemoryLayout.size(ofValue: socketAddress.sun_path)
        guard socketPath.hasPrefix("/"),
              !socketPath.utf8.contains(0),
              socketPath.utf8.count + 1 <= socketPathCapacity
        else {
            throw CoordinatorError(
                "operational_socket_invalid",
                "the product service socket path is invalid or too long"
            )
        }
        return ProductServicePaths(
            applicationSupport: applicationSupportURL.standardizedFileURL,
            database: database,
            key: key,
            contracts: contracts,
            socketPath: socketPath,
            config: config
        )
    }

    static func loadEnabledProjects(applicationSupport: URL) throws -> [String] {
        guard let applicationSupportDescriptor = try ProductServiceSecureFilesystem
            .openExistingApplicationSupportIfPresent(applicationSupport)
        else {
            return []
        }
        defer { close(applicationSupportDescriptor) }
        guard let productDescriptor = try ProductServiceSecureFilesystem
            .openExistingSecureDirectory(
                parentDescriptor: applicationSupportDescriptor,
                name: "Blabee"
            )
        else {
            return []
        }
        defer { close(productDescriptor) }
        guard let configDescriptor = try ProductServiceSecureFilesystem
            .openExistingSecureDirectory(
                parentDescriptor: productDescriptor,
                name: "config"
            )
        else {
            return []
        }
        defer { close(configDescriptor) }

        return try loadEnabledProjects(
            directoryDescriptor: configDescriptor,
            fileName: "service.json"
        )
    }

    static func loadEnabledProjects(
        directoryDescriptor: Int32,
        fileName: String
    ) throws -> [String] {
        var directoryInfo = stat()
        guard fileName == "service.json",
              fstat(directoryDescriptor, &directoryInfo) == 0,
              directoryInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              directoryInfo.st_mode & 0o7777 == 0o700,
              directoryInfo.st_uid == geteuid()
        else {
            throw unsafeConfiguration("the open service config directory is unsafe")
        }

        let fileDescriptor = openat(
            directoryDescriptor,
            fileName,
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
              fileInfo.st_nlink == 1,
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
              finalInfo.st_nlink == 1,
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
            let standardized = ProductServiceSecureFilesystem.normalizedSystemAlias(
                URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL.path
            )
            guard standardized.utf8.count <= maximumProjectPathBytes else {
                throw invalidConfiguration("normalized project paths exceed the byte limit")
            }
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
