import CryptoKit
import Foundation

public enum ContractPin {
    public static let schemaVersion = "1.0"
    public static let manifestSHA256 = "3728189a98f9e566366c2106946762c9e0ec75e56a2be13ed00cb249a2f65214"

    public static let schemaSHA256: [String: String] = [
        "action.schema.json": "74891ce2683cb20ec4f120760246d1e0bbd84b6e70f5f3a2ab6ffcfc799ceaf7",
        "common.schema.json": "a84342c432fc2a1ffe63268096899d3ed6d3354ddfe3b61ba2659f1ea4fe61ca",
        "continuation-envelope.schema.json": "d010ff4462fb0b7da6e86f872ac995ad73114396bb1432bbb02b656ea695fec2",
        "decision-packet.schema.json": "80aeae753e1daa1b0d6cbeae001ee145df8ad0c5cb3ac622dd99e643b20eb57f",
        "decision-proposal.schema.json": "904ec5d5accb5e69b866d3248e23bfad371bd80d42dab751e8ae46bcaf10708e",
        "native-request.schema.json": "46244b35bfc09795ca5e5f4ae82f8c89db0231993968fc7dcdd4955b55851a5a",
        "prompt-episode.schema.json": "f234f4f2e100e4324e006a7494a96d01b91b47273b0e9d3213a74dd8877e504e",
        "resume-capsule.schema.json": "4dd3f13ab51b1cf10e987eb159880631065b803e179de53e22c8ecfefa1a7ed5",
        "runtime-event.schema.json": "8ff09e12b8a39fd7d35d320bb2a4c2fe1e2410074475767b5ab25c6cab53952b",
        "selection-request.schema.json": "5337114c185b226fe844148b7254bccd2cb7a0c3b1dd839fb3ad0660920aaede",
    ]

    public static func verify(contractsDirectory: URL) throws {
        let expectedFiles = Set(schemaSHA256.keys).union(["manifest.json"])
        let actualFiles: Set<String>
        do {
            actualFiles = Set(try FileManager.default.contentsOfDirectory(
                at: contractsDirectory,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            ).filter { $0.pathExtension == "json" }.map(\.lastPathComponent))
        } catch {
            throw CoordinatorError("contract_pin_mismatch", "cannot enumerate pinned contracts")
        }
        try require(
            actualFiles == expectedFiles,
            "unsupported_contract_update",
            "Contracts/v1 JSON file set changed"
        )
        try verifyFile(
            contractsDirectory.appendingPathComponent("manifest.json"),
            expected: manifestSHA256
        )
        for (file, expected) in schemaSHA256 {
            try verifyFile(contractsDirectory.appendingPathComponent(file), expected: expected)
        }
    }

    private static func verifyFile(_ URL: URL, expected: String) throws {
        let data: Data
        do {
            data = try Data(contentsOf: URL, options: [.mappedIfSafe])
        } catch {
            throw CoordinatorError("contract_pin_mismatch", "missing pinned contract \(URL.lastPathComponent)")
        }
        let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try require(
            actual == expected,
            "contract_pin_mismatch",
            "pinned contract hash changed: \(URL.lastPathComponent)"
        )
    }
}
