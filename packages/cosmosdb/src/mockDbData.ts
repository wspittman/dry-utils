import fs from "node:fs";
import type { MockDBData } from "./dbInit.ts";

export interface MockDBDataOptions {
  /** Inline JSON string containing mock data, keyed by container name. */
  mockDataJson?: string;
  /** Absolute path to a JSON file containing mock data, keyed by container name. */
  mockDataPath?: string;
}

/**
 * Loads Cosmos DB mock data from JSON sources.
 * Inline JSON overrides duplicate container keys loaded from the file source.
 * @param options Optional sources for mock data: inline JSON and/or a file path.
 * @returns Parsed mock data map, or undefined when no sources are configured.
 */
export function loadMockDBData({
  mockDataJson,
  mockDataPath,
}: MockDBDataOptions): MockDBData | undefined {
  const trimJson = mockDataJson?.trim();
  const trimPath = mockDataPath?.trim();

  if (!trimJson && !trimPath) {
    return undefined;
  }

  const fileData = trimPath
    ? parseMockDBData(fs.readFileSync(trimPath, "utf-8"), `file ${trimPath}`)
    : undefined;

  const inlineData = trimJson
    ? parseMockDBData(trimJson, "mockDataJson")
    : undefined;

  return {
    ...(fileData ?? {}),
    ...(inlineData ?? {}),
  };
}

function parseMockDBData(rawJson: string, source: string): MockDBData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`Invalid Cosmos DB mock data JSON in ${source}.`, {
      cause: error,
    });
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(
      `Cosmos DB mock data in ${source} must be a JSON object keyed by container name.`,
    );
  }

  return parsed as MockDBData;
}
