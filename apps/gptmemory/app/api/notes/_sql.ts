export const PERMANENT_DELETE_NOTE_SQL = `
  DELETE FROM notes
  WHERE id = ?
    AND owner_key = ?
    AND deleted_at IS NOT NULL
  RETURNING id
`;
