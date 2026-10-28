#if BLABEE_TEST_APP
import BlabeeProductSupport
import Foundation
import Testing

@Suite("Blabee Test compile profile")
struct BlabeeTestProfileTests {
    @Test("The test binary exposes only its compiled identity")
    func fixedTestIdentity() throws {
        let profile = BlabeeProductProfile.current
        #expect(profile.isTestApp)
        #expect(BlabeeProductProfile.allCases == [.blabeeTest])
        #expect(BlabeeProductProfile(rawValue: "blabee") == nil)
        #expect(profile.profileID == "blabee-test")
        #expect(profile.displayName == "Blabee Test")
        #expect(profile.appBundleName == "Blabee Test.app")
        #expect(profile.bundleIdentifier == "com.biadone.blabee.test")
        #expect(profile.applicationSupportDirectoryName == "Blabee Test")
        #expect(profile.serviceLabel == "com.biadone.blabee.test.coordinator")
        #expect(profile.installedAppPath != "/Applications/Blabee.app")
    }

    @Test("Test bundles require an explicit matching marker")
    func explicitDistributionMarker() throws {
        let profile = BlabeeProductProfile.current
        #expect(profile.matchesDistributionMarker("blabee-test"))
        #expect(!profile.matchesDistributionMarker(nil))
        #expect(!profile.matchesDistributionMarker("blabee"))
        #expect(!profile.matchesDistributionMarker(""))
        let value = try #require(JSONSerialization.jsonObject(with: profile.distributionData()) as? [String: String])
        #expect(value == ["schema_version": "blabee.distribution-profile.v1",
                         "profile_id": "blabee-test", "bundle_identifier": "com.biadone.blabee.test"])
    }
}
#endif
