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
import { diag } from "./diagnostics.ts";

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
      diag.error("GetItem", error);
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
      diag.error("GetItemsByPartitionKey", error);
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
      diag.error("Query", error);
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
      diag.error("UpsertItem", error);
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
      diag.error("DeleteItem", error);
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

    const blob: Record<string, unknown> = {
      action,
      container,
    };

    const dense: Record<string, unknown> = {
      name: action,
      in: container,
      ru,
      ms,
      bytes,
    };

    const metrics: Record<string, number> = { ru, ms, bytes };

    if (pkey) {
      blob["pkey"] = dense["pkey"] = pkey;
    }

    if (query) {
      // No query.parameters to avoid IDs
      blob["query"] = dense["query"] =
        typeof query === "string" ? query : query.query;
    }

    if (count != null) {
      blob["response"] = {
        ...rest,
        resourceCount: count,
      };
      dense["count"] = metrics["count"] = count;
    } else {
      blob["response"] = rest;
    }

    diag.aggregate(action, blob, dense, metrics);
  } catch (error) {
    diag.error("LogDBAction", error);
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
