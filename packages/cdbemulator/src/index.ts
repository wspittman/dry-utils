/**
 * Minimal compatibility surface required to emulate `@azure/cosmos`
 * for consumers of `dry-utils-cosmosdb`.
 *
 * This file is a spec-oriented contract, not a production implementation.
 */

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export type PartitionKey =
  | string
  | number
  | boolean
  | null
  | readonly JSONValue[];

export interface SqlParameter {
  name: string;
  value: JSONValue;
}

export interface SqlQuerySpec {
  query: string;
  parameters?: SqlParameter[];
}

export interface FeedOptions {
  partitionKey?: PartitionKey;
}

export interface ItemDefinition {
  id?: string;
  [key: string]: unknown;
}

export interface Resource {
  id: string;
  _etag?: string;
  _ts?: number;
}

export interface ClientSideRequestStatistics {
  requestDurationInMs: number;
  totalResponsePayloadLengthInBytes: number;
}

export interface ResponseDiagnostics {
  clientSideRequestStatistics: ClientSideRequestStatistics;
}

export interface ItemResponse<T> {
  resource?: T;
  requestCharge: number;
  diagnostics: ResponseDiagnostics;
}

export interface FeedResponse<T> {
  resources: T[];
  requestCharge: number;
  diagnostics: ResponseDiagnostics;
}

export interface ContainerRequest {
  id: string;
  partitionKey: { paths: string[] };
  indexingPolicy?: {
    includedPaths?: { path: string }[];
    excludedPaths?: { path: string }[];
  };
}

export interface QueryIterator<T> {
  fetchAll(): Promise<FeedResponse<T>>;
}

export interface ItemHandle {
  read<T>(): Promise<ItemResponse<T>>;
  delete(): Promise<ItemResponse<unknown>>;
}

export interface ItemsHandle {
  readAll<T>(options?: FeedOptions): QueryIterator<T>;
  query<T>(
    query: string | SqlQuerySpec,
    options?: FeedOptions,
  ): QueryIterator<T>;
  upsert<T extends ItemDefinition>(item: T): Promise<ItemResponse<T>>;
}

export interface Container {
  item(id: string, partitionKey?: PartitionKey): ItemHandle;
  readonly items: ItemsHandle;
}

export interface Containers {
  createIfNotExists(
    details: ContainerRequest,
  ): Promise<{ container: Container }>;
}

export interface Database {
  readonly containers: Containers;
}

export interface Databases {
  createIfNotExists(details: { id: string }): Promise<{ database: Database }>;
}

export interface CosmosClientOptions {
  endpoint: string;
  key: string;
  agent?: unknown;
}

export interface CosmosClientLike {
  readonly databases: Databases;
}

/** Constructor contract for module export parity. */
export type CosmosClientCtor = new (
  options: CosmosClientOptions,
) => CosmosClientLike;

type StoredItem = {
  id: string;
  partitionKey: PartitionKey;
  doc: Record<string, unknown>;
};

class InMemoryContainer implements Container {
  private readonly partitionKeyField: string;
  private readonly rows = new Map<string, StoredItem>();

  readonly items: ItemsHandle;

  constructor(partitionPath: string) {
    this.partitionKeyField = partitionPath
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean)
      .join(".");

    this.items = {
      readAll: <T>(options?: FeedOptions) =>
        this.createIterator(
          () => this.filterByPartition(options?.partitionKey) as T[],
        ),
      query: <T>(query: string | SqlQuerySpec, options?: FeedOptions) =>
        this.createIterator(() => this.queryItems<T>(query, options)),
      upsert: async <T extends ItemDefinition>(
        item: T,
      ): Promise<ItemResponse<T>> => {
        await Promise.resolve();
        const started = Date.now();
        if (typeof item.id !== "string" || !item.id) {
          throw new Error("Upsert requires item.id");
        }

        const pk = getByPath(
          item as Record<string, unknown>,
          this.partitionKeyField,
        );
        if (!isPartitionKey(pk)) {
          throw new Error(
            `Upsert requires partition key value at path "${this.partitionKeyField}"`,
          );
        }

        const doc = structuredClone(item as Record<string, unknown>);
        const key = makeStoreKey(item.id, pk);
        this.rows.set(key, { id: item.id, partitionKey: pk, doc });

        return buildItemResponse(doc as T, started);
      },
    };
  }

  item(id: string, partitionKey?: PartitionKey): ItemHandle {
    return {
      read: async <T>() => {
        await Promise.resolve();
        const started = Date.now();
        const row = this.getRow(id, partitionKey);
        const resource = row ? (structuredClone(row.doc) as T) : undefined;
        return buildItemResponse(resource, started);
      },
      delete: async () => {
        await Promise.resolve();
        const started = Date.now();
        const key = makeStoreKey(id, partitionKey);
        const row = this.rows.get(key);

        if (!row) {
          const error = Object.assign(new Error("Item not found"), {
            code: 404,
          });
          throw error;
        }

        this.rows.delete(key);
        return buildItemResponse(undefined, started);
      },
    };
  }

  private createIterator<T>(fetch: () => T[]): QueryIterator<T> {
    return {
      fetchAll: async () => {
        await Promise.resolve();
        const started = Date.now();
        const resources = fetch();
        return buildFeedResponse(resources, started);
      },
    };
  }

  private filterByPartition(partitionKey?: PartitionKey) {
    const all = [...this.rows.values()].map((x) => structuredClone(x.doc));
    if (partitionKey === undefined) {
      return all;
    }

    return all.filter((doc) => {
      const value = getByPath(doc, this.partitionKeyField);
      return partitionEquals(value, partitionKey);
    });
  }

  private queryItems<T>(
    queryInput: string | SqlQuerySpec,
    options?: FeedOptions,
  ): T[] {
    const query =
      typeof queryInput === "string" ? queryInput : queryInput.query;
    const params = new Map<string, JSONValue>();
    for (const parameter of (typeof queryInput === "string"
      ? []
      : queryInput.parameters) ?? []) {
      params.set(parameter.name, parameter.value);
    }
    const normalized = query.trim();

    if (
      /^SELECT\s+VALUE\s+COUNT\(1\)\s+FROM\s+c(?:\s+WHERE\s+.+)?$/i.test(
        normalized,
      )
    ) {
      const rows = this.applyWhere(
        this.filterByPartition(options?.partitionKey),
        normalized,
        params,
      );
      return [rows.length] as T[];
    }

    if (/^SELECT\s+c\.id\s+FROM\s+c(?:\s+WHERE\s+.+)?$/i.test(normalized)) {
      const rows = this.applyWhere(
        this.filterByPartition(options?.partitionKey),
        normalized,
        params,
      );
      return rows.map((row) => ({ id: row.id }) as T);
    }

    const selectMatch = normalized.match(
      /^SELECT(?:\s+TOP\s+(\d+))?\s+\*\s+FROM\s+c(?:\s+WHERE\s+(.+))?$/i,
    );

    if (!selectMatch) {
      throw new Error(`Unsupported query: ${query}`);
    }

    const top = selectMatch[1] ? Number(selectMatch[1]) : undefined;
    const filtered = this.applyWhere(
      this.filterByPartition(options?.partitionKey),
      normalized,
      params,
    );
    const resources = top == null ? filtered : filtered.slice(0, top);
    return resources as T[];
  }

  private applyWhere(
    docs: Record<string, unknown>[],
    query: string,
    params: Map<string, JSONValue>,
  ) {
    const whereMatch = query.match(/\s+WHERE\s+(.+)$/i);
    if (!whereMatch) {
      return docs;
    }

    const conditions = splitAndConditions(whereMatch[1] ?? "");
    return docs.filter((doc) =>
      conditions.every((condition) =>
        evaluateCondition(doc, condition, params),
      ),
    );
  }

  private getRow(id: string, partitionKey?: PartitionKey) {
    if (partitionKey !== undefined) {
      return this.rows.get(makeStoreKey(id, partitionKey));
    }

    for (const row of this.rows.values()) {
      if (row.id === id) {
        return row;
      }
    }

    return undefined;
  }
}

class InMemoryContainers implements Containers {
  private readonly containers = new Map<string, InMemoryContainer>();

  async createIfNotExists(
    details: ContainerRequest,
  ): Promise<{ container: Container }> {
    await Promise.resolve();
    const existing = this.containers.get(details.id);
    if (existing) {
      return { container: existing };
    }

    const partitionPath = details.partitionKey.paths[0];
    if (typeof partitionPath !== "string") {
      throw new Error("ContainerRequest.partitionKey.paths[0] is required");
    }

    const container = new InMemoryContainer(partitionPath);
    this.containers.set(details.id, container);
    return { container };
  }
}

class InMemoryDatabase implements Database {
  readonly containers: Containers;

  constructor() {
    this.containers = new InMemoryContainers();
  }
}

class InMemoryDatabases implements Databases {
  private readonly databases = new Map<string, InMemoryDatabase>();

  async createIfNotExists(details: {
    id: string;
  }): Promise<{ database: Database }> {
    await Promise.resolve();
    const existing = this.databases.get(details.id);
    if (existing) {
      return { database: existing };
    }

    const database = new InMemoryDatabase();
    this.databases.set(details.id, database);
    return { database };
  }
}

export class CosmosClient implements CosmosClientLike {
  readonly databases: Databases;

  constructor(_options: CosmosClientOptions) {
    this.databases = new InMemoryDatabases();
  }
}

function buildItemResponse<T>(
  resource: T | undefined,
  started: number,
): ItemResponse<T> {
  return {
    resource,
    requestCharge: 1,
    diagnostics: {
      clientSideRequestStatistics: {
        requestDurationInMs: Math.max(0, Date.now() - started),
        totalResponsePayloadLengthInBytes: byteLength(resource),
      },
    },
  };
}

function buildFeedResponse<T>(
  resources: T[],
  started: number,
): FeedResponse<T> {
  return {
    resources,
    requestCharge: 1,
    diagnostics: {
      clientSideRequestStatistics: {
        requestDurationInMs: Math.max(0, Date.now() - started),
        totalResponsePayloadLengthInBytes: byteLength(resources),
      },
    },
  };
}

function splitAndConditions(where: string) {
  const trimmed = where.trim();
  const grouped = trimmed.includes(") AND (")
    ? trimmed.split(/\)\s+AND\s+\(/i)
    : trimmed.split(/\s+AND\s+/i);

  return grouped
    .map((part) => part.trim().replace(/^\(/, "").replace(/\)$/, "").trim())
    .filter(Boolean);
}

function evaluateCondition(
  doc: Record<string, unknown>,
  condition: string,
  params: Map<string, JSONValue>,
) {
  const containsMatch = condition.match(
    /^CONTAINS\(\s*c\.([\w.]+)\s*,\s*(@\w+|".*?"|'.*?')\s*,\s*true\s*\)$/i,
  );

  if (containsMatch) {
    const field = containsMatch[1] as string;
    const rhs = parseValue(containsMatch[2] as string, params);
    const value = getByPath(doc, field);
    return typeof value === "string" && typeof rhs === "string"
      ? value.toLowerCase().includes(rhs.toLowerCase())
      : false;
  }

  const cmpMatch = condition.match(
    /^c\.([\w.]+)\s*(<=|>=|=|<|>)\s*(@\w+|".*?"|'.*?'|-?\d+(?:\.\d+)?|true|false|null)$/i,
  );
  if (!cmpMatch) {
    throw new Error(`Unsupported WHERE condition: ${condition}`);
  }

  const field = cmpMatch[1] as string;
  const op = cmpMatch[2] as "=" | "<" | "<=" | ">" | ">=";
  const rhs = parseValue(cmpMatch[3] as string, params);
  const lhs = getByPath(doc, field);

  if (op === "=") {
    return deepEqual(lhs, rhs);
  }

  if (typeof lhs !== "number" || typeof rhs !== "number") {
    return false;
  }

  switch (op) {
    case "<":
      return lhs < rhs;
    case "<=":
      return lhs <= rhs;
    case ">":
      return lhs > rhs;
    case ">=":
      return lhs >= rhs;
  }
}

function parseValue(token: string, params: Map<string, JSONValue>) {
  if (token.startsWith("@")) {
    if (!params.has(token)) {
      throw new Error(`Missing query parameter: ${token}`);
    }

    return params.get(token);
  }

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  if (token === "true") {
    return true;
  }

  if (token === "false") {
    return false;
  }

  if (token === "null") {
    return null;
  }

  if (!Number.isNaN(Number(token))) {
    return Number(token);
  }

  return token;
}

function getByPath(doc: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }

    return undefined;
  }, doc);
}

function makeStoreKey(id: string, partitionKey: PartitionKey | undefined) {
  return `${id}::${JSON.stringify(partitionKey)}`;
}

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function partitionEquals(itemValue: unknown, expected: PartitionKey) {
  return deepEqual(itemValue, expected);
}

function isPartitionKey(value: unknown): value is PartitionKey {
  if (value == null) {
    return true;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(isJSONValue);
}

function isJSONValue(value: unknown): value is JSONValue {
  if (value == null) {
    return true;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJSONValue);
  }

  if (typeof value === "object") {
    return Object.values(value).every(isJSONValue);
  }

  return false;
}

function byteLength(value: unknown) {
  if (value === undefined) {
    return 0;
  }

  return Buffer.byteLength(JSON.stringify(value));
}
