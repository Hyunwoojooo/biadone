import CoordinatorSwift
import Darwin
import Foundation

package enum ProductServiceSettingsAction: String, Equatable {
    case enable
    case disable

    var status: String {
        switch self {
        case .enable: "enabled"
        case .disable: "disabled"
        }
    }
}

package struct ProductServiceSettingsResult: Equatable {
    package let changed: Bool
    package let status: String
    package let project: String
    package let enabledProjects: [String]

    package func outputData() throws -> Data {
        var data = try StrictJSONTransport.data(forJSONObject: [
            "changed": changed,
            "enabled_projects": enabledProjects,
            "project": project,
            "status": status,
        ])
        data.append(0x0A)
        return data
    }
}

package enum ProductServiceSettingsWritePoint: Equatable {
    case beforeRename
    case afterRenameBeforeDirectorySync
    case beforeIdempotentDirectorySync
}

package enum ProductServiceSettingsEvent: Equatable {
    case beforeProcessMutex
    case beforeFileLock
    case fileLockAcquired
}

package struct ProductServiceSettingsWriter {
    package typealias FailureInjector = (ProductServiceSettingsWritePoint) throws -> Void
    package typealias EventObserver = (ProductServiceSettingsEvent) -> Void

    private static let mutexRegistry = ProductServiceSettingsMutexRegistry()
    private static let lockFileName = ".service.json.lock"

    private let failureInjector: FailureInjector?
    private let eventObserver: EventObserver?

    package init(
        failureInjector: FailureInjector? = nil,
        eventObserver: EventObserver? = nil
    ) {
        self.failureInjector = failureInjector
        self.eventObserver = eventObserver
    }

    package func update(
        action: ProductServiceSettingsAction,
        project rawProject: String,
        environment: ProductServiceEnvironment
    ) throws -> ProductServiceSettingsResult {
        let paths = try ProductServiceBootstrap.resolvePaths(environment: environment)
        let project = try Self.normalizeProjectPath(rawProject)
        if action == .enable {
            try Self.requireRealProjectDirectory(project)
        }
        let processMutex = Self.mutexRegistry.mutex(
            for: Self.normalizedSystemAlias(paths.config.path)
        )
        eventObserver?(.beforeProcessMutex)
        processMutex.lock()
        defer { processMutex.unlock() }

        let directories = try Self.openSecureConfigDirectories(paths: paths)
        defer {
            close(directories.config)
            close(directories.product)
            close(directories.applicationSupport)
        }
        let lockDescriptor = try Self.openPersistentLock(
            directoryDescriptor: directories.config
        )
        defer { close(lockDescriptor) }

        eventObserver?(.beforeFileLock)
        try Self.acquireExclusiveLock(lockDescriptor)
        defer { _ = flock(lockDescriptor, LOCK_UN) }
        try Self.verifyNamedLock(
            lockDescriptor,
            directoryDescriptor: directories.config
        )
        try Self.verifyDirectoryChain(directories)
        eventObserver?(.fileLockAcquired)

        let current = try ProductServiceBootstrap.loadEnabledProjects(
            directoryDescriptor: directories.config,
            fileName: paths.config.lastPathComponent
        )
        var updated = current
        let changed: Bool
        switch action {
        case .enable:
            if current.contains(project) {
                changed = false
            } else {
                guard current.count < ProductServiceBootstrap.maximumEnabledProjects else {
                    throw CoordinatorError(
                        "product_service_config_invalid",
                        "the service config cannot contain more than 256 enabled projects"
                    )
                }
                updated.append(project)
                updated.sort(by: Self.utf8Precedes)
                changed = true
            }
        case .disable:
            let previousCount = updated.count
            updated.removeAll { $0 == project }
            changed = updated.count != previousCount
        }

        if changed {
            let data = try Self.encode(enabledProjects: updated)
            try writeAtomically(
                data,
                directoryDescriptor: directories.config,
                destinationName: paths.config.lastPathComponent
            )
        } else {
            do {
                try failureInjector?(.beforeIdempotentDirectorySync)
                try Self.sync(
                    directories.config,
                    code: "product_service_config_durability_uncertain",
                    message: "the service config directory cannot be synchronized"
                )
            } catch {
                throw CoordinatorError(
                    "product_service_config_durability_uncertain",
                    "the unchanged service config directory durability is uncertain"
                )
            }
        }
        return ProductServiceSettingsResult(
            changed: changed,
            status: action.status,
            project: project,
            enabledProjects: updated
        )
    }

    private func writeAtomically(
        _ data: Data,
        directoryDescriptor: Int32,
        destinationName: String
    ) throws {
        let temporaryName = ".service.json.\(getpid()).\(UUID().uuidString).tmp"
        let descriptor = openat(
            directoryDescriptor,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CoordinatorError(
                "product_service_config_write_failed",
                "the temporary service config cannot be created safely"
            )
        }

        var temporaryEntryExists = true
        var descriptorIsOpen = true
        do {
            guard fchmod(descriptor, mode_t(0o600)) == 0 else {
                throw CoordinatorError(
                    "product_service_config_write_failed",
                    "the temporary service config mode cannot be secured"
                )
            }
            var temporaryInfo = stat()
            guard fstat(descriptor, &temporaryInfo) == 0,
                  temporaryInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  temporaryInfo.st_mode & 0o7777 == 0o600,
                  temporaryInfo.st_uid == geteuid(),
                  temporaryInfo.st_nlink == 1
            else {
                throw CoordinatorError(
                    "product_service_config_write_failed",
                    "the temporary service config metadata is unsafe"
                )
            }

            try Self.writeAll(data, to: descriptor)
            try Self.sync(
                descriptor,
                code: "product_service_config_write_failed",
                message: "the temporary service config cannot be synchronized"
            )
            var writtenInfo = stat()
            guard fstat(descriptor, &writtenInfo) == 0,
                  writtenInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  writtenInfo.st_mode & 0o7777 == 0o600,
                  writtenInfo.st_uid == geteuid(),
                  writtenInfo.st_nlink == 1,
                  writtenInfo.st_dev == temporaryInfo.st_dev,
                  writtenInfo.st_ino == temporaryInfo.st_ino,
                  writtenInfo.st_size == off_t(data.count)
            else {
                throw CoordinatorError(
                    "product_service_config_write_failed",
                    "the temporary service config changed while writing"
                )
            }
            guard close(descriptor) == 0 else {
                descriptorIsOpen = false
                throw CoordinatorError(
                    "product_service_config_write_failed",
                    "the temporary service config cannot be closed"
                )
            }
            descriptorIsOpen = false

            try failureInjector?(.beforeRename)
            guard renameat(
                directoryDescriptor,
                temporaryName,
                directoryDescriptor,
                destinationName
            ) == 0 else {
                throw CoordinatorError(
                    "product_service_config_write_failed",
                    "the service config cannot be replaced atomically"
                )
            }
            temporaryEntryExists = false

            var destinationInfo = stat()
            guard fstatat(
                directoryDescriptor,
                destinationName,
                &destinationInfo,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                destinationInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                destinationInfo.st_mode & 0o7777 == 0o600,
                destinationInfo.st_uid == geteuid(),
                destinationInfo.st_nlink == 1,
                destinationInfo.st_dev == writtenInfo.st_dev,
                destinationInfo.st_ino == writtenInfo.st_ino,
                destinationInfo.st_size == off_t(data.count)
            else {
                throw CoordinatorError(
                    "product_service_config_durability_uncertain",
                    "the replaced service config cannot be verified"
                )
            }

            do {
                try failureInjector?(.afterRenameBeforeDirectorySync)
                try Self.sync(
                    directoryDescriptor,
                    code: "product_service_config_durability_uncertain",
                    message: "the service config directory cannot be synchronized"
                )
            } catch {
                throw CoordinatorError(
                    "product_service_config_durability_uncertain",
                    "the service config was replaced but directory durability is uncertain"
                )
            }
        } catch {
            if descriptorIsOpen { close(descriptor) }
            if temporaryEntryExists,
               unlinkat(directoryDescriptor, temporaryName, 0) != 0,
               errno != ENOENT
            {
                throw CoordinatorError(
                    "product_service_config_cleanup_failed",
                    "the temporary service config could not be removed"
                )
            }
            throw error
        }
    }

    private static func encode(enabledProjects: [String]) throws -> Data {
        let sorted = enabledProjects.sorted(by: utf8Precedes)
        guard sorted == enabledProjects,
              Set(sorted).count == sorted.count,
              sorted.count <= ProductServiceBootstrap.maximumEnabledProjects
        else {
            throw CoordinatorError(
                "product_service_config_invalid",
                "enabled project paths must be bounded, unique, and sorted"
            )
        }
        let data = try StrictJSONTransport.data(forJSONObject: [
            "enabled_projects": sorted,
            "schema_version": "1.0",
        ])
        guard data.count <= ProductServiceBootstrap.maximumConfigBytes else {
            throw CoordinatorError(
                "product_service_config_invalid",
                "the service config exceeds 64 KiB"
            )
        }
        return data
    }

    private static func normalizeProjectPath(_ rawPath: String) throws -> String {
        guard !rawPath.isEmpty,
              rawPath.hasPrefix("/"),
              !rawPath.utf8.contains(0),
              rawPath.utf8.count <= ProductServiceBootstrap.maximumProjectPathBytes
        else {
            throw CoordinatorError(
                "project_settings_project_invalid",
                "the project must be a bounded absolute directory path"
            )
        }
        let standardizedPath = URL(fileURLWithPath: rawPath, isDirectory: true)
            .standardizedFileURL.path
        let path = normalizedSystemAlias(standardizedPath)
        guard path.utf8.count <= ProductServiceBootstrap.maximumProjectPathBytes
        else {
            throw CoordinatorError(
                "project_settings_project_invalid",
                "the normalized project path exceeds the byte limit"
            )
        }

        return path
    }

    private static func requireRealProjectDirectory(_ path: String) throws {
        guard path != "/" else {
            throw CoordinatorError(
                "project_settings_project_invalid",
                "the project path cannot select the filesystem root"
            )
        }
        let components = path.split(separator: "/").map(String.init)
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CoordinatorError(
                "project_settings_project_invalid",
                "the filesystem root cannot be opened safely"
            )
        }
        do {
            for component in components {
                let next = openat(
                    descriptor,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
                )
                guard next >= 0 else {
                    throw CoordinatorError(
                        "project_settings_project_invalid",
                        "the project path must contain only real directories"
                    )
                }
                close(descriptor)
                descriptor = next
            }
            var openedInfo = stat()
            guard fstat(descriptor, &openedInfo) == 0,
                  openedInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            else {
                throw CoordinatorError(
                    "project_settings_project_invalid",
                    "the project must be an existing real directory"
                )
            }
            close(descriptor)
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func openSecureConfigDirectories(
        paths: ProductServicePaths
    ) throws -> ProductServiceSettingsDirectoryChain {
        let applicationSupportDescriptor = try openExistingApplicationSupport(
            paths.applicationSupport
        )
        do {
            let productDescriptor = try openOrCreateSecureDirectory(
                parentDescriptor: applicationSupportDescriptor,
                name: "Blabee"
            )
            do {
                let configDescriptor = try openOrCreateSecureDirectory(
                    parentDescriptor: productDescriptor,
                    name: "config"
                )
                return ProductServiceSettingsDirectoryChain(
                    applicationSupport: applicationSupportDescriptor,
                    product: productDescriptor,
                    config: configDescriptor
                )
            } catch {
                close(productDescriptor)
                throw error
            }
        } catch {
            close(applicationSupportDescriptor)
            throw error
        }
    }

    private static func openExistingApplicationSupport(_ url: URL) throws -> Int32 {
        try ProductServiceSecureFilesystem.openExistingApplicationSupport(url)
    }

    private static func openOrCreateSecureDirectory(
        parentDescriptor: Int32,
        name: String
    ) throws -> Int32 {
        var created = false
        var createdIdentity = stat()
        if mkdirat(parentDescriptor, name, mode_t(0o700)) == 0 {
            created = true
        } else if errno != EEXIST {
            throw unsafeConfiguration("the service config directory cannot be created")
        }
        if created {
            guard fstatat(
                parentDescriptor,
                name,
                &createdIdentity,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                createdIdentity.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                createdIdentity.st_uid == geteuid(),
                fchmodat(
                    parentDescriptor,
                    name,
                    mode_t(0o700),
                    AT_SYMLINK_NOFOLLOW
                ) == 0
            else {
                throw unsafeConfiguration("the new service config directory cannot be secured")
            }
            var securedIdentity = stat()
            guard fstatat(
                parentDescriptor,
                name,
                &securedIdentity,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                securedIdentity.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                securedIdentity.st_mode & 0o7777 == 0o700,
                securedIdentity.st_uid == geteuid(),
                securedIdentity.st_dev == createdIdentity.st_dev,
                securedIdentity.st_ino == createdIdentity.st_ino
            else {
                throw unsafeConfiguration("the new service config directory changed while securing")
            }
        }
        let descriptor = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw unsafeConfiguration("the service config path contains an unsafe component")
        }
        do {
            if created {
                guard fchmod(descriptor, mode_t(0o700)) == 0 else {
                    throw unsafeConfiguration("the service config directory mode cannot be secured")
                }
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_mode & 0o7777 == 0o700,
                  info.st_uid == geteuid(),
                  !created || (
                    info.st_dev == createdIdentity.st_dev
                        && info.st_ino == createdIdentity.st_ino
                  )
            else {
                throw unsafeConfiguration(
                    "the service config directories must be current-user mode 0700 directories"
                )
            }
            if created {
                try sync(
                    descriptor,
                    code: "product_service_config_write_failed",
                    message: "the service config directory metadata cannot be synchronized"
                )
                try sync(
                    parentDescriptor,
                    code: "product_service_config_write_failed",
                    message: "the service config directory creation cannot be synchronized"
                )
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func openPersistentLock(directoryDescriptor: Int32) throws -> Int32 {
        var created = false
        var descriptor = openat(
            directoryDescriptor,
            lockFileName,
            O_RDWR | O_CREAT | O_EXCL | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        if descriptor >= 0 {
            created = true
        } else if errno == EEXIST {
            descriptor = openat(
                directoryDescriptor,
                lockFileName,
                O_RDWR | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
            )
        }
        guard descriptor >= 0 else {
            throw unsafeConfiguration("the service config lock cannot be opened safely")
        }
        do {
            if created {
                guard fchmod(descriptor, mode_t(0o600)) == 0 else {
                    throw unsafeConfiguration("the service config lock mode cannot be secured")
                }
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  info.st_mode & 0o7777 == 0o600,
                  info.st_uid == geteuid(),
                  info.st_nlink == 1
            else {
                throw unsafeConfiguration(
                    "the service config lock must be a current-user single-link mode 0600 regular file"
                )
            }
            if created {
                try sync(
                    descriptor,
                    code: "product_service_config_write_failed",
                    message: "the service config lock cannot be synchronized"
                )
                try sync(
                    directoryDescriptor,
                    code: "product_service_config_write_failed",
                    message: "the service config lock entry cannot be synchronized"
                )
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func acquireExclusiveLock(_ descriptor: Int32) throws {
        while flock(descriptor, LOCK_EX) != 0 {
            if errno == EINTR { continue }
            throw CoordinatorError(
                "product_service_config_lock_failed",
                "the service config lock cannot be acquired"
            )
        }
    }

    private static func verifyNamedLock(
        _ descriptor: Int32,
        directoryDescriptor: Int32
    ) throws {
        var descriptorInfo = stat()
        var namedInfo = stat()
        guard fstat(descriptor, &descriptorInfo) == 0,
              fstatat(
                directoryDescriptor,
                lockFileName,
                &namedInfo,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              descriptorInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              descriptorInfo.st_mode & 0o7777 == 0o600,
              descriptorInfo.st_uid == geteuid(),
              descriptorInfo.st_nlink == 1,
              namedInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              namedInfo.st_mode & 0o7777 == 0o600,
              namedInfo.st_uid == geteuid(),
              namedInfo.st_nlink == 1,
              namedInfo.st_dev == descriptorInfo.st_dev,
              namedInfo.st_ino == descriptorInfo.st_ino
        else {
            throw unsafeConfiguration("the service config lock changed while waiting")
        }
    }

    private static func verifyDirectoryChain(
        _ directories: ProductServiceSettingsDirectoryChain
    ) throws {
        try verifyNamedDirectory(
            name: "Blabee",
            descriptor: directories.product,
            parentDescriptor: directories.applicationSupport
        )
        try verifyNamedDirectory(
            name: "config",
            descriptor: directories.config,
            parentDescriptor: directories.product
        )
    }

    private static func verifyNamedDirectory(
        name: String,
        descriptor: Int32,
        parentDescriptor: Int32
    ) throws {
        var descriptorInfo = stat()
        var namedInfo = stat()
        guard fstat(descriptor, &descriptorInfo) == 0,
              fstatat(parentDescriptor, name, &namedInfo, AT_SYMLINK_NOFOLLOW) == 0,
              descriptorInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              descriptorInfo.st_mode & 0o7777 == 0o700,
              descriptorInfo.st_uid == geteuid(),
              namedInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              namedInfo.st_mode & 0o7777 == 0o700,
              namedInfo.st_uid == geteuid(),
              namedInfo.st_dev == descriptorInfo.st_dev,
              namedInfo.st_ino == descriptorInfo.st_ino
        else {
            throw unsafeConfiguration("the service config directory chain changed while waiting")
        }
    }

    private static func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(
                    descriptor,
                    baseAddress.advanced(by: offset),
                    bytes.count - offset
                )
                if count < 0 {
                    if errno == EINTR { continue }
                    throw CoordinatorError(
                        "product_service_config_write_failed",
                        "the service config could not be written completely"
                    )
                }
                guard count > 0 else {
                    throw CoordinatorError(
                        "product_service_config_write_failed",
                        "the service config write made no progress"
                    )
                }
                offset += count
            }
        }
    }

    private static func sync(
        _ descriptor: Int32,
        code: String,
        message: String
    ) throws {
        while fsync(descriptor) != 0 {
            if errno == EINTR { continue }
            throw CoordinatorError(code, message)
        }
    }

    private static func utf8Precedes(_ left: String, _ right: String) -> Bool {
        left.utf8.lexicographicallyPrecedes(right.utf8)
    }

    private static func normalizedSystemAlias(_ path: String) -> String {
        ProductServiceSecureFilesystem.normalizedSystemAlias(path)
    }

    private static func unsafeConfiguration(_ message: String) -> CoordinatorError {
        CoordinatorError("product_service_config_unsafe", message)
    }
}

private struct ProductServiceSettingsDirectoryChain {
    let applicationSupport: Int32
    let product: Int32
    let config: Int32
}

package enum ProductProjectSettingsCommand {
    package static func run(
        arguments: [String],
        environment: ProductServiceEnvironment,
        writer: ProductServiceSettingsWriter = ProductServiceSettingsWriter()
    ) throws -> ProductServiceSettingsResult {
        guard arguments.count == 3,
              let action = ProductServiceSettingsAction(rawValue: arguments[0]),
              arguments[1] == "--project",
              !arguments[2].isEmpty
        else {
            throw CoordinatorError(
                "invalid_arguments",
                "project-settings requires enable|disable --project ABSOLUTE_PATH"
            )
        }
        return try writer.update(
            action: action,
            project: arguments[2],
            environment: environment
        )
    }
}

private final class ProductServiceSettingsMutexRegistry: @unchecked Sendable {
    private let registryLock = NSLock()
    private var mutexes: [String: NSLock] = [:]

    func mutex(for path: String) -> NSLock {
        registryLock.lock()
        defer { registryLock.unlock() }
        if let mutex = mutexes[path] { return mutex }
        let mutex = NSLock()
        mutexes[path] = mutex
        return mutex
    }
}
