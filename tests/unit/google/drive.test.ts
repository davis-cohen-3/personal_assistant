import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFilesList, mockFilesGet, mockFilesExport } = vi.hoisted(() => ({
  mockFilesList: vi.fn(),
  mockFilesGet: vi.fn(),
  mockFilesExport: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        list: mockFilesList,
        get: mockFilesGet,
        export: mockFilesExport,
      },
    })),
  },
}));

vi.mock("../../../src/server/google/auth.js", () => ({
  getAuthClient: vi.fn(() => ({})),
}));

import {
  getFileMetadata,
  listRecentFiles,
  readDocument,
  searchFiles,
  translateQuery,
} from "../../../src/server/google/drive.js";

const makeFile = (overrides?: object) => ({
  id: "file1",
  name: "Budget Q4",
  mimeType: "application/vnd.google-apps.spreadsheet",
  modifiedTime: "2024-03-15T10:00:00Z",
  webViewLink: "https://docs.google.com/spreadsheets/d/file1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchFiles", () => {
  it("calls files.list with trashed=false appended", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [makeFile()] } });

    await searchFiles("budget report");

    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({
        spaces: "drive",
        q: expect.stringContaining("trashed = false"),
      }),
    );
  });

  it("translates plain text query to fullText contains", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await searchFiles("quarterly report");

    const call = mockFilesList.mock.calls[0][0];
    expect(call.q).toContain("fullText contains 'quarterly report'");
  });

  it("passes through Drive DSL queries unchanged", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await searchFiles("name contains 'budget'");

    const call = mockFilesList.mock.calls[0][0];
    expect(call.q).toContain("name contains 'budget'");
    expect(call.q).not.toContain("fullText contains");
  });

  it("returns file metadata array", async () => {
    mockFilesList.mockResolvedValue({
      data: {
        files: [makeFile(), makeFile({ id: "file2", name: "Report" })],
      },
    });

    const result = await searchFiles("budget");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("file1");
    expect(result[0].name).toBe("Budget Q4");
  });

  it("returns empty array when no files match", async () => {
    mockFilesList.mockResolvedValue({ data: {} });

    const result = await searchFiles("nothing");

    expect(result).toEqual([]);
  });

  it("passes maxResults option", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await searchFiles("budget", { maxResults: 20 });

    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 20 }),
    );
  });
});

describe("listRecentFiles", () => {
  it("orders by viewedByMeTime desc", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [makeFile()] } });

    await listRecentFiles();

    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "viewedByMeTime desc" }),
    );
  });

  it("uses default maxResults of 20", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await listRecentFiles();

    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 20 }),
    );
  });

  it("accepts custom maxResults", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await listRecentFiles(10);

    expect(mockFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 10 }),
    );
  });

  it("excludes trashed files", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await listRecentFiles();

    const call = mockFilesList.mock.calls[0][0];
    expect(call.q).toContain("trashed = false");
  });
});

describe("readDocument", () => {
  it("exports file as text/plain", async () => {
    mockFilesExport.mockResolvedValue({ data: "Document content here" });

    await readDocument("file1");

    expect(mockFilesExport).toHaveBeenCalledWith({
      fileId: "file1",
      mimeType: "text/plain",
    });
  });

  it("returns document text", async () => {
    mockFilesExport.mockResolvedValue({ data: "Document content here" });

    const result = await readDocument("file1");

    expect(result).toBe("Document content here");
  });

  it("throws AppError with clear message when export limit exceeded (FEAS-012)", async () => {
    const error = { status: 403, message: "Export file size exceeds limit" };
    mockFilesExport.mockRejectedValue(error);

    await expect(readDocument("largeFile")).rejects.toThrow(
      /10MB|too large|export limit/i,
    );
  });

  it("re-throws non-size errors", async () => {
    const error = { status: 404, message: "File not found" };
    mockFilesExport.mockRejectedValue(error);

    await expect(readDocument("missingFile")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getFileMetadata", () => {
  it("calls files.get with standard metadata fields", async () => {
    mockFilesGet.mockResolvedValue({ data: makeFile() });

    await getFileMetadata("file1");

    expect(mockFilesGet).toHaveBeenCalledWith({
      fileId: "file1",
      fields: expect.stringContaining("name"),
    });
  });

  it("returns file metadata", async () => {
    mockFilesGet.mockResolvedValue({ data: makeFile() });

    const result = await getFileMetadata("file1");

    expect(result.id).toBe("file1");
    expect(result.name).toBe("Budget Q4");
    expect(result.mimeType).toBe("application/vnd.google-apps.spreadsheet");
    expect(result.webViewLink).toBe("https://docs.google.com/spreadsheets/d/file1");
  });
});

describe("translateQuery", () => {
  it("wraps plain text as fullText contains", () => {
    expect(translateQuery("quarterly budget")).toBe(
      "fullText contains 'quarterly budget' and trashed = false",
    );
  });

  it("passes through queries that already contain Drive operators", () => {
    const driveQuery = "name contains 'budget'";
    const result = translateQuery(driveQuery);
    expect(result).toContain("name contains 'budget'");
    expect(result).not.toContain("fullText contains");
  });

  it("appends trashed=false to Drive DSL queries", () => {
    const result = translateQuery("mimeType = 'application/vnd.google-apps.document'");
    expect(result).toContain("trashed = false");
  });

  it("handles mimeType filter query", () => {
    const result = translateQuery("mimeType = 'application/vnd.google-apps.spreadsheet'");
    expect(result).toContain("mimeType =");
  });

  it("escapes single quotes in plain text query", () => {
    const result = translateQuery("John's report");
    expect(result).toBe("fullText contains 'John\\'s report' and trashed = false");
  });

  it("escapes backslashes in plain text query", () => {
    const result = translateQuery("path\\to\\file");
    expect(result).toBe("fullText contains 'path\\\\to\\\\file' and trashed = false");
  });
});
