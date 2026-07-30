import {
  getNote,
  patchNote,
  softDeleteNote,
} from "../_repository";
import {
  ApiRequestError,
  noteApiResponse,
  noteErrorResponse,
  parsePatchNoteInput,
  readJsonBody,
  requireOwnerKey,
} from "../_shared";

type NoteRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: NoteRouteContext,
): Promise<Response> {
  try {
    const ownerKey = requireOwnerKey(request);
    const id = await noteId(context);
    const note = await getNote(ownerKey, id);
    if (!note) throw noteNotFound();
    return noteApiResponse({ note });
  } catch (error) {
    return noteErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: NoteRouteContext,
): Promise<Response> {
  try {
    const ownerKey = requireOwnerKey(request);
    const id = await noteId(context);
    const patch = parsePatchNoteInput(await readJsonBody(request));
    const note = await patchNote(ownerKey, id, patch);
    if (!note) throw noteNotFound();
    return noteApiResponse({ note });
  } catch (error) {
    return noteErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: NoteRouteContext,
): Promise<Response> {
  try {
    const ownerKey = requireOwnerKey(request);
    const id = await noteId(context);
    const note = await softDeleteNote(ownerKey, id);
    if (!note) throw noteNotFound();
    return noteApiResponse({ note });
  } catch (error) {
    return noteErrorResponse(error);
  }
}

async function noteId(context: NoteRouteContext): Promise<string> {
  const { id } = await context.params;
  const normalized = id.trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) {
    throw new ApiRequestError("INVALID_NOTE_ID", "Note id is invalid.");
  }
  return normalized;
}

function noteNotFound(): ApiRequestError {
  return new ApiRequestError(
    "NOTE_NOT_FOUND",
    "Note was not found.",
    404,
  );
}
