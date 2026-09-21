import { createHash } from 'node:crypto';

// These two whole-message forms are the only supported selection continuations.
// Do not trim, parse a marker, or accept a matching substring of a native prompt.
export function selectionChannelContent({ selection_id, delivery_token }) {
  return `blabee-claude 선택 참조입니다. 이 서버의 claim_selection에 아래 값을 그대로 전달하세요. 성공 응답의 task와 done_when을 확인하기 전에는 선택 작업을 실행하지 마세요. Claude의 네이티브 권한을 유지하세요.\n${JSON.stringify({ selection_id, delivery_token })}`;
}

export function selectionChannelNotification(event) {
  return {
    method: 'notifications/claude/channel',
    params: { content: selectionChannelContent(event), meta: { selection_id: event.selection_id } },
  };
}

export function selectionChannelPrompt(event) {
  const { content, meta } = selectionChannelNotification(event).params;
  return `<channel source="blabee-claude" selection_id="${meta.selection_id}">\n${content}\n</channel>`;
}

export function promptSHA256(prompt) {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}
