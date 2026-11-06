import { isWorkSuggestionBoardPublicOutputTextSafe } from "../suggestionBoard/publicTextSafety";

const LAUNCHER_PRIVATE_REF_PATTERN =
  /(?:action_ref|analysis|artifact|attention|binding|board_item|board_source|candidate|claim|command|connection|context_ref|continuation_context_link|continuation_offer|continuation_run|execution|focus|github_repo|input_sha|instance|item_ref|managed_event|mapping|observation_sha|private_target|project|proof|repository|result|result_sha|root|scope|settlement|source_record_ref|stream|sync|thread|user|work_board|work_context|work_item|workstream)_[A-Za-z0-9_-]+/iu;

export function isLauncherWorkBoardPublicTitleSafe(value: string): boolean {
  return (
    isWorkSuggestionBoardPublicOutputTextSafe(value) &&
    !LAUNCHER_PRIVATE_REF_PATTERN.test(value)
  );
}
