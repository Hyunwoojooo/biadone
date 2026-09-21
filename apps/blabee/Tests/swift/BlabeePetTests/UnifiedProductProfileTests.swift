import BlabeeProductSupport
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Unified Blabee product identity")
struct UnifiedProductProfileTests {
    @Test("Both bridges belong to the existing installed app and storage namespace")
    func existingProductIdentity() throws {
        let profile = BlabeeProductProfile.current
        #expect(BlabeeProductProfile.allCases == [.blabee])
        #expect(profile.installedAppPath == "/Applications/Blabee.app")
        #expect(profile.bundleIdentifier == "com.biadone.blabee")
        #expect(profile.applicationSupportDirectoryName == "Blabee")
        #expect(profile.servicePlistName == "com.biadone.blabee.coordinator.plist")
        #expect(profile.primaryFreshnessAccount == "primary")
        // Construction validates the account syntax without accessing Keychain.
        let anchor = try KeychainFreshnessAnchorStore(account: profile.primaryFreshnessAccount)
        #expect(anchor.storageSlot == "primary")
        #expect(anchor.service == KeychainFreshnessAnchorStore.defaultService)
    }

    @Test("Packaging descriptor only accepts the unified product, including legacy unmarked bundles")
    func descriptorRejectsSeparateProducts() throws {
        let profile = BlabeeProductProfile.current
        let value = try #require(JSONSerialization.jsonObject(with: profile.distributionData()) as? [String: String])
        #expect(value == ["schema_version": "blabee.distribution-profile.v1",
                         "profile_id": "blabee", "bundle_identifier": "com.biadone.blabee"])
        #expect(profile.matchesDistributionMarker(nil))
        #expect(profile.matchesDistributionMarker("blabee"))
        #expect(!profile.matchesDistributionMarker("claude-preview"))
        #expect(!profile.matchesDistributionMarker(""))
    }
}
