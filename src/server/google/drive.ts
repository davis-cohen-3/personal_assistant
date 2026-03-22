import { google } from "googleapis";
import { AppError } from "../exceptions.js";
import type { OAuth2Client } from "./auth.js";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface SearchFilesOptions {
  maxResults?: number;
  orderBy?: string;
}

const DRIVE_DSL_PATTERN = /contains|mimeType\s*=|'[^']+'\s+in\s+|sharedWithMe|trashed/;

export function translateQuery(query: string): string {
  if (DRIVE_DSL_PATTERN.test(query)) {
    return `${query} and trashed = false`;
  }
  return `fullText contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
}

function mapFile(file: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
}): DriveFile {
  return {
    id: file.id ?? "",
    name: file.name ?? "",
    mimeType: file.mimeType ?? "",
    modifiedTime: file.modifiedTime ?? "",
    webViewLink: file.webViewLink ?? "",
  };
}

function isExportSizeError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if (!("status" in err) || err.status !== 403) return false;
  if (!("message" in err) || typeof err.message !== "string") return false;
  const msg = err.message.toLowerCase();
  return msg.includes("export") || msg.includes("size") || msg.includes("limit");
}

export async function searchFiles(
  auth: OAuth2Client,
  query: string,
  opts?: SearchFilesOptions,
): Promise<DriveFile[]> {
  console.info("drive.searchFiles", { query, maxResults: opts?.maxResults });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: translateQuery(query),
    spaces: "drive",
    pageSize: opts?.maxResults ?? 25,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    ...(opts?.orderBy ? { orderBy: opts.orderBy } : {}),
  });
  return (res.data.files ?? []).map(mapFile);
}

export async function listRecentFiles(
  auth: OAuth2Client,
  maxResults?: number,
): Promise<DriveFile[]> {
  console.info("drive.listRecentFiles", { maxResults });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    orderBy: "viewedByMeTime desc",
    pageSize: maxResults ?? 20,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    q: "trashed = false",
  });
  return (res.data.files ?? []).map(mapFile);
}

export async function readDocument(auth: OAuth2Client, fileId: string): Promise<string> {
  console.info("drive.readDocument", { fileId });
  const drive = google.drive({ version: "v3", auth });
  try {
    const res = await drive.files.export({
      fileId,
      mimeType: "text/plain",
    });
    if (typeof res.data !== "string") throw new AppError("Unexpected export response type", 500);
    return res.data;
  } catch (err: unknown) {
    if (isExportSizeError(err)) {
      throw new AppError("Document is too large to read (exceeds 10MB export limit)", 400, {
        userFacing: true,
      });
    }
    throw err;
  }
}

export async function getFileMetadata(auth: OAuth2Client, fileId: string): Promise<DriveFile> {
  console.info("drive.getFileMetadata", { fileId });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,modifiedTime,webViewLink",
  });
  return mapFile(res.data);
}
