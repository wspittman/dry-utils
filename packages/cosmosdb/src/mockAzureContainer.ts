import type {
  FeedOptions,
  FeedResponse,
  ItemDefinition as Item,
  ItemResponse,
  SqlQuerySpec,
} from "@azure/cosmos";
import { processQuery, type MockQueryDef } from "./mockQueryProcessor.ts";

// Partition key value that triggers a simulated error, used in tests to exercise error paths.
const FORCE_ERROR = "FORCE_ERROR";

/**
 * In-memory implementation of an Azure Cosmos DB container.
 * For use in unit tests or in dev environments that don't have access to a Cosmos DB instance.
 * Supports item CRUD, partition-scoped reads, and SQL query processing via
 * custom filter and projection matchers.
 */
export class MockAzureContainer {
  // Data structure: { pkey: { id: item } }
  readonly #data: Record<string, Record<string, Item>> = {};
  readonly #pkey: string;
  readonly #filters: MockQueryDef[];
  readonly #projects: MockQueryDef[];

  /**
   * @param pkey The partition key field name used to organize items.
   * @param data Initial items to seed the container.
   * @param filters Custom WHERE clause matchers for query processing.
   * @param projects Custom SELECT clause matchers for query processing.
   */
  constructor(
    pkey: string,
    data: Item[] = [],
    filters: MockQueryDef[] = [],
    projects: MockQueryDef[] = [],
  ) {
    this.#pkey = pkey;
    this.#filters = filters;
    this.#projects = projects;
    data.forEach((item) => this._addItem(item));
  }

  /** Returns a mock item reference for the given id and partition key. */
  item(id: string, pkey: string): MockItem {
    return new MockItem(this, id, pkey);
  }

  /** Returns a mock items collection for querying and upserting. */
  get items(): MockItems {
    return new MockItems(this);
  }

  _addItem(item: Item): void {
    if (!item.id) {
      throw new Error("Item must have an id property");
    }

    const pk = item[this.#pkey] as string;
    if (typeof pk !== "string") {
      throw new Error(`Partition key must be string. Found ${typeof pk}`);
    }

    this._checkForceError(pk);
    this.#data[pk] ??= {};
    this.#data[pk][item.id] = structuredClone(item);
  }

  _getItem(id: string, pkey: string): Item | undefined {
    this._checkForceError(pkey);
    return structuredClone(this.#data[pkey]?.[id]);
  }

  _getPartition(pkey: string): Item[] {
    this._checkForceError(pkey);
    return Object.values(this.#data[pkey] ?? {}).map((item) =>
      structuredClone(item),
    );
  }

  _getAllItems(): Item[] {
    return Object.values(this.#data).flatMap((partition) =>
      Object.values(partition).map((item) => structuredClone(item)),
    );
  }

  _query(query: SqlQuerySpec, pkey?: string): unknown[] {
    const items = pkey ? this._getPartition(pkey) : this._getAllItems();
    return processQuery(items, query, this.#filters, this.#projects);
  }

  _deleteItem(id: string, pkey: string): Item | undefined {
    this._checkForceError(pkey);
    const item = this._getItem(id, pkey);
    if (this.#data[pkey]) {
      delete this.#data[pkey][id];
    }
    return item;
  }

  _checkForceError(pkey: string): void {
    if (pkey === FORCE_ERROR) {
      throw new Error("Error Time");
    }
  }
}

class MockItems {
  #container: MockAzureContainer;

  constructor(container: MockAzureContainer) {
    this.#container = container;
  }

  readAll<T extends Item>({
    partitionKey,
  }: FeedOptions = {}): MockQueryIterator<T> {
    if (!partitionKey || typeof partitionKey !== "string") {
      throw new Error("String partition key is required for mock readAll");
    }

    const items = this.#container._getPartition(partitionKey) as T[];
    return new MockQueryIterator<T>(items);
  }

  query<T>(
    query: string | SqlQuerySpec,
    { partitionKey }: FeedOptions = {},
  ): MockQueryIterator<T> {
    const items = this.#container._query(
      typeof query === "string" ? { query } : query,
      partitionKey as string,
    ) as T[];

    return new MockQueryIterator<T>(items);
  }

  upsert(item: Item): Promise<ItemResponse<Item>> {
    this.#container._addItem(item);
    return mockItemResponse(item);
  }
}

class MockItem {
  #container: MockAzureContainer;
  #id: string;
  #pkey: string;

  constructor(container: MockAzureContainer, id: string, pkey: string) {
    this.#container = container;
    this.#id = id;
    this.#pkey = pkey;
  }

  read<T extends Item>(): Promise<ItemResponse<T>> {
    return mockItemResponse(
      this.#container._getItem(this.#id, this.#pkey) as T,
    );
  }

  delete<T extends Item>(): Promise<ItemResponse<T>> {
    return mockItemResponse(
      this.#container._deleteItem(this.#id, this.#pkey) as T,
    );
  }
}

class MockQueryIterator<T> {
  #items: T[];

  constructor(items: T[]) {
    this.#items = items;
  }

  fetchAll(): Promise<FeedResponse<T>> {
    return mockFeedResponse(this.#items);
  }
}

function mockItemResponse<T extends Item>(
  resource: T,
): Promise<ItemResponse<T>> {
  return Promise.resolve({
    resource,
    ...mockDiagnostics(),
  } as ItemResponse<T>);
}

function mockFeedResponse<T>(resources: T[]): Promise<FeedResponse<T>> {
  return Promise.resolve({
    resources,
    ...mockDiagnostics(),
  } as FeedResponse<T>);
}

const mockDiagnostics = () => {
  return {
    requestCharge: 1,
    diagnostics: {
      clientSideRequestStatistics: {
        requestDurationInMs: 123,
        totalResponsePayloadLengthInBytes: 456,
      },
    },
  };
};
