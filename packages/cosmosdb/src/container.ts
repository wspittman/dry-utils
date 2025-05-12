import type {
  Container as AzureContainer,
  FeedOptions,
  FeedResponse,
  ItemDefinition,
  ItemResponse,
  PartitionKey,
  Resource,
  SqlQuerySpec,
} from "@azure/cosmos";
import { externalLog } from "./externalLog.ts";

/**
 * Generic container class for database operations
 * @template Item The type of items stored in the container
 */
export class Container<Item extends ItemDefinition> {
  protected readonly name: string;
  public readonly container: AzureContainer;

  constructor(name: string, container: AzureContainer) {
    this.name = name;
    this.container = container;
  }

  /**
   * Retrieves a single item from the container
   * @param id The unique identifier of the item
   * @param partitionKey The partition key for the item
   * @returns The requested item or undefined if not found
   */
  async getItem(
    id: string,
    partitionKey: string
  ): Promise<(Item & Resource) | undefined> {
    try {
      const response = await this.container.item(id, partitionKey).read<Item>();
      logDBAction("READ", this.name, response, partitionKey);
      return response.resource;
    } catch (error) {
      externalLog.error("GetItem", error);
      throw error;
    }
  }

  /**
   * Retrieves all items from a partition
   * @param partitionKey The partition key to query
   * @returns Array of items in the partition
   */
  async getItemsByPartitionKey(
    partitionKey: string
  ): Promise<(Item & Resource)[]> {
    try {
      const response = await this.container.items
        .readAll<Item & Resource>({ partitionKey })
        .fetchAll();
      logDBAction("READ_ALL", this.name, response, partitionKey);
      return response.resources;
    } catch (error) {
      externalLog.error("GetItemsByPartitionKey", error);
      throw error;
    }
  }

  /**
   * Retrieves all item IDs from a partition
   * @param partitionKey The partition key to query
   * @returns Array of item IDs in the partition
   */
  async getIdsByPartitionKey(partitionKey: string): Promise<string[]> {
    const result = await this.query<{ id: string }>("SELECT c.id FROM c", {
      partitionKey,
    });
    return result.map((entry) => entry.id);
  }

  /**
   * Gets the total count of items in the container
   * @returns The total number of items
   */
  async getCount(): Promise<number | undefined> {
    const response = await this.query<number>("SELECT VALUE COUNT(1) FROM c");
    return response[0];
  }

  /**
   * Executes a query against the container
   * @param query SQL query string or query spec
   * @param options Optional feed options including partition key
   * @returns Query results
   */
  async query<T>(
    query: string | SqlQuerySpec,
    options?: FeedOptions
  ): Promise<T[]> {
    try {
      const response = await this.container.items
        .query<T>(query, options)
        .fetchAll();
      logDBAction("QUERY", this.name, response, options?.partitionKey, query);
      return response.resources;
    } catch (error) {
      externalLog.error("Query", error);
      throw error;
    }
  }

  /**
   * Creates or updates an item in the container
   * @param item The item to upsert
   */
  async upsertItem(item: Item): Promise<void> {
    try {
      const response = await this.container.items.upsert(item);
      logDBAction("UPSERT", this.name, response);
    } catch (error) {
      externalLog.error("UpsertItem", error);
      throw error;
    }
  }

  /**
   * Deletes an item from the container
   * @param id The unique identifier of the item
   * @param partitionKey The partition key for the item
   */
  async deleteItem(id: string, partitionKey: string): Promise<void> {
    try {
      const response = await this.container.item(id, partitionKey).delete();
      logDBAction("DELETE", this.name, response, partitionKey);
    } catch (error) {
      externalLog.error("DeleteItem", error);
      throw error;
    }
  }
}

// #region Telemetry

type DBAction = "READ" | "READ_ALL" | "UPSERT" | "DELETE" | "QUERY";

function logDBAction(
  action: DBAction,
  container: string,
  response: ItemResponse<ItemDefinition> | FeedResponse<unknown>,
  pkey?: PartitionKey,
  query?: string | SqlQuerySpec
) {
  try {
    const { ru, ms, bytes, count, rest } = extractResponse(response);

    const log: Record<string, unknown> = {
      name: action,
      in: container,
      ru,
      ms,
      bytes,
    };

    const blob: Record<string, unknown> = {
      action,
      container,
    };

    if (pkey) {
      log["pkey"] = blob["pkey"] = pkey;
    }

    if (query) {
      // No query.parameters to avoid IDs
      log["query"] = blob["query"] =
        typeof query === "string" ? query : query.query;
    }

    if (count != null) {
      log["count"] = count;
      blob["response"] = {
        ...rest,
        resourceCount: count,
      };
    } else {
      blob["response"] = rest;
    }

    externalLog.aggregate(action, log, blob, ["ru", "ms", "bytes"]);
  } catch (error) {
    externalLog.error("LogDBAction", error);
  }
}

function extractResponse(
  response: ItemResponse<ItemDefinition> | FeedResponse<unknown>
) {
  const ru = response.requestCharge;
  const { requestDurationInMs, totalResponsePayloadLengthInBytes } =
    response.diagnostics.clientSideRequestStatistics;

  // No response .item, .resource, .resources to avoid IDs
  const { item, resource, resources, ...rest } = response as unknown as {
    item?: unknown;
    resource?: unknown;
    resources?: unknown[];
    [key: string]: unknown;
  };
  const count = resources?.length;

  return {
    ru,
    ms: requestDurationInMs,
    bytes: totalResponsePayloadLengthInBytes,
    count,
    rest,
  };
}

// #endregion
