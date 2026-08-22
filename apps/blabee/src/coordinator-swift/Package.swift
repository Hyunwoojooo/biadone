// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BlabeeCoordinator",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "CoordinatorSwift", targets: ["CoordinatorSwift"]),
        .executable(name: "blabee-coordinator", targets: ["BlabeeCoordinator"]),
    ],
    targets: [
        .target(
            name: "CoordinatorSwift",
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("Security"),
            ]
        ),
        .executableTarget(
            name: "BlabeeCoordinator",
            dependencies: ["CoordinatorSwift"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("SwiftUI"),
            ]
        ),
        .testTarget(
            name: "CoordinatorSwiftTests",
            dependencies: ["CoordinatorSwift"]
        ),
        .testTarget(
            name: "BlabeePetTests",
            dependencies: ["BlabeeCoordinator"]
        ),
    ]
)
