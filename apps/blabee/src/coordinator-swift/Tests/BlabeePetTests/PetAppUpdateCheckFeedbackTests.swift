import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Air update check feedback")
struct PetAppUpdateCheckFeedbackTests {
    @Test("Only a confirmed comparison may claim latest or available")
    func feedbackUsesRealResult() throws {
        let now = Date(timeIntervalSince1970: 10_000)
        let current = try #require(PetAppUpdateCheckFeedback(state: .upToDate, now: now))
        #expect(current.title(at: now) == "최신 버전")

        let release = PetAppUpdateRelease(
            version: try #require(PetAppUpdateVersion(version: "0.1.0", build: "43")),
            releaseURL: try #require(URL(string: "https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.43"))
        )
        let available = try #require(PetAppUpdateCheckFeedback(state: .available(release), now: now))
        #expect(available.title(at: now) == "업데이트 가능")
        for state in [PetAppUpdateState.notChecked, .checking, .noPublishedRelease, .unavailable("offline")] {
            #expect(PetAppUpdateCheckFeedback(state: state, now: now) == nil)
        }
    }

    @Test("The success label lasts three seconds without clearing the release")
    func feedbackExpiresIndependently() throws {
        let now = Date(timeIntervalSince1970: 10_000)
        let release = PetAppUpdateRelease(
            version: try #require(PetAppUpdateVersion(version: "0.1.0", build: "43")),
            releaseURL: try #require(URL(string: "https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.43"))
        )
        let state = PetAppUpdateState.available(release)
        let feedback = try #require(PetAppUpdateCheckFeedback(state: state, now: now))
        #expect(feedback.title(at: now.addingTimeInterval(2.999)) == "업데이트 가능")
        #expect(feedback.title(at: now.addingTimeInterval(3)) == nil)
        #expect(state.availableRelease == release)
    }
}
