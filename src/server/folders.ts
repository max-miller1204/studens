import type * as http from "node:http";
import * as store from "../store.ts";
import { readJsonBody, sendJson } from "./http.ts";

export async function handleFolders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, { error: "Method not allowed." }, 405);
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, { error: "Invalid folder request JSON." }, 400);
  }
  try {
    return sendJson(res, { folders: store.editClassroomFolders(body) });
  } catch (error) {
    if (error instanceof store.FolderInputError)
      return sendJson(res, { error: error.message }, 400);
    if (error instanceof store.FolderBusyError) return sendJson(res, { error: error.message }, 409);
    console.error("[classroom] folder edit failed", error);
    return sendJson(res, { error: (error as Error).message }, 500);
  }
}
