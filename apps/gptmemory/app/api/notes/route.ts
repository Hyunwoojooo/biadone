import {
  createNote,
  listNotes,
} from "./_repository";
import {
  noteApiResponse,
  noteErrorResponse,
  parseCreateNoteInput,
  parseListNotesInput,
  readJsonBody,
  requireOwnerKey,
} from "./_shared";

export async function GET(request: Request): Promise<Response> {
  try {
    const ownerKey = requireOwnerKey(request);
    const input = parseListNotesInput(request);
    const notes = await listNotes(ownerKey, input);
    return noteApiResponse({ notes });
  } catch (error) {
    return noteErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ownerKey = requireOwnerKey(request);
    const input = parseCreateNoteInput(await readJsonBody(request));
    const result = await createNote(ownerKey, input);
    return noteApiResponse(result, {
      status: result.disposition === "created" ? 201 : 200,
    });
  } catch (error) {
    return noteErrorResponse(error);
  }
}
