import type {
  FeedOptions,
  FeedResponse,
  ItemDefinition as Item,
  ItemResponse,
  SqlQuerySpec,
} from "@azure/cosmos";

const FORCE_ERROR = "FORCE_ERROR";

interface QueryDef {
  matcher: string | RegExp;
  func: (
    items: Item[],
    getParam: <T>(name: string) => T | undefined,
  ) => unknown[];
}

export interface MockAzureContainerOptions {
  data?: Item[];
  queries?: QueryDef[];
}

export class MockAzureContainer {
  // Data structure: { pkey: { id: item } }
  readonly #data: Record<string, Record<string, Item>> = {};
  readonly #pkey: string;
  readonly #queries: QueryDef[] = [];

  constructor(
    pkey: string,
    { data = [], queries = [] }: MockAzureContainerOptions = {},
  ) {
    this.#pkey = pkey;
    this.#queries = queries;
    data.forEach((item) => this._addItem(item));
  }

  item(id: string, pkey: string): MockItem {
    return new MockItem(this, id, pkey);
  }

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
    const queryStr = query.query;

    if (queryStr === "SELECT * FROM c") {
      return items;
    }

    if (queryStr === "SELECT VALUE COUNT(1) FROM c") {
      return [items.length];
    }

    const projectedProperties = getSimpleSelectedProperties(queryStr);

    if (projectedProperties) {
      return items.map((item) =>
        Object.fromEntries(
          projectedProperties
            .filter((property) => property in item)
            .map((property) => [property, item[property]]),
        ),
      );
    }

    for (const { matcher, func } of this.#queries) {
      if (
        (typeof matcher === "string" && matcher === queryStr) ||
        (matcher instanceof RegExp && matcher.test(queryStr))
      ) {
        return func(items, (name) => getParam(query, name));
      }
    }

    return items;
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

function getParam<T>(query: SqlQuerySpec, name: string): T | undefined {
  const { parameters = [] } = query;
  const param = parameters.find((p) => p.name === name);
  return param ? (param.value as T) : undefined;
}

function getSimpleSelectedProperties(query: string): string[] | undefined {
  // Woo Regex!
  // Matches "SELECT x from c"
  // Where x is a comma-separated list of c.property (no spaces)
  // Where property can be A-Za-z0-9_
  const re =
    /^SELECT\s+((?:c\.[A-Za-z0-9_]+)(?:\s*,\s*c\.[A-Za-z0-9_]+)*)\s+FROM\s+c$/i;

  const match = query.match(re);
  if (!match) return undefined;

  const clause = match[1]?.trim();
  if (!clause) return undefined;

  const properties: string[] = [];
  for (const part of clause.split(",")) {
    // trim and remove "c." prefix
    const propMatch = part.trim().slice(2);
    if (!propMatch) return undefined;
    properties.push(propMatch);
  }

  return properties;
}
