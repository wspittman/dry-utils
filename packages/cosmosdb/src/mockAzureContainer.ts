import type {
  FeedOptions,
  FeedResponse,
  ItemDefinition as Item,
  ItemResponse,
  SqlQuerySpec,
} from "@azure/cosmos";

export class MockAzureContainer {
  // Data structure: { pkey: { id: item } }
  private readonly data: Record<string, Record<string, Item>> = {};
  private readonly pkey: string;

  constructor(pkey: string, data: Item[] = []) {
    this.pkey = pkey;
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

    const pk = item[this.pkey] as string;
    if (typeof pk !== "string") {
      throw new Error(`Partition key must be string. Found ${typeof pk}`);
    }

    this.data[pk] ??= {};
    this.data[pk][item.id] = item;
  }

  _getItem(id: string, pkey: string): Item | undefined {
    return this.data[pkey]?.[id];
  }

  _getPartition(pkey: string): Item[] {
    return Object.values(this.data[pkey] ?? {});
  }

  _deleteItem(id: string, pkey: string): Item | undefined {
    const item = this._getItem(id, pkey);
    if (this.data[pkey]) {
      delete this.data[pkey][id];
    }
    return item;
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

  query<T extends Item>(
    query: string | SqlQuerySpec,
    options?: FeedOptions,
  ): MockQueryIterator<T> {
    if (typeof query !== "string") {
      throw new Error("Only string queries are supported in mock query");
    }
    if (!options?.partitionKey || typeof options.partitionKey !== "string") {
      throw new Error("String partition key is required for mock query");
    }
    // This is a very naive query implementation that only supports "SELECT * FROM c"
    if (query.trim().toUpperCase() !== "SELECT * FROM C") {
      throw new Error("Only 'SELECT * FROM c' queries are supported in mock");
    }
    const items = this.#container._getPartition(options.partitionKey) as T[];
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

class MockQueryIterator<T extends Item> {
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

function mockFeedResponse<T extends Item>(
  resources: T[],
): Promise<FeedResponse<T>> {
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
