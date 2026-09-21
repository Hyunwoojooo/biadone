import CoordinatorSwift
import Foundation

struct BlabeeSuggestionModeLoadResult: Sendable, Equatable {
    let mode: BlabeeSuggestionMode
    let diagnostic: String?
}

protocol BlabeeSuggestionModeStoring: Sendable {
    func load() -> BlabeeSuggestionModeLoadResult
    func save(_ mode: BlabeeSuggestionMode)
}

/// Stores only the Pet's follow-up suggestion frequency preference.
///
/// This preference is intentionally separate from service.json because it is
/// UX policy, not project scope or security authority. The Pet and background
/// coordinator are built into the same executable and therefore read the same
/// UserDefaults domain.
final class BlabeeSuggestionModeStore: BlabeeSuggestionModeStoring, @unchecked Sendable {
    static let defaultKey = "com.biadone.blabee.suggestion-mode.v1"

    private let defaults: UserDefaults
    private let key: String

    init(
        defaults: UserDefaults = .standard,
        key: String = BlabeeSuggestionModeStore.defaultKey
    ) {
        self.defaults = defaults
        self.key = key
    }

    func load() -> BlabeeSuggestionModeLoadResult {
        guard defaults.object(forKey: key) != nil else {
            return BlabeeSuggestionModeLoadResult(mode: .smart, diagnostic: nil)
        }
        guard let rawValue = defaults.string(forKey: key),
              let mode = BlabeeSuggestionMode(rawValue: rawValue)
        else {
            return BlabeeSuggestionModeLoadResult(
                mode: .actionOnly,
                diagnostic: "저장된 후속 제안 모드를 확인할 수 없어 안전을 위해 ‘작업만’으로 설정했습니다."
            )
        }
        return BlabeeSuggestionModeLoadResult(mode: mode, diagnostic: nil)
    }

    func save(_ mode: BlabeeSuggestionMode) {
        defaults.set(mode.rawValue, forKey: key)
    }
}

extension BlabeeSuggestionMode {
    var petDisplayTitle: String {
        switch self {
        case .smart: "스마트"
        case .always: "항상"
        case .actionOnly: "작업만"
        }
    }

    var petDisplayDescription: String {
        switch self {
        case .smart:
            "실행 작업은 항상 제안하고, 설명·분석은 유용한 후속 선택이 2개 이상일 때만 제안합니다."
        case .always:
            "단순 답변을 포함해 적격한 최종 응답마다 다음 대화를 제안합니다."
        case .actionOnly:
            "파일 변경, 테스트, 조사처럼 실제 작업을 수행한 응답 뒤에만 제안합니다."
        }
    }
}
