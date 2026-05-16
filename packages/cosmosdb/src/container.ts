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
import { Query, type Condition } from "./Query.ts";

interface CountBy {
  name: unknown;
  count: number;
}

const validProp = new RegExp(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/);

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
    partitionKey: string,
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
    partitionKey: string,
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
    const result = await this.query<{ id: string }>(new Query("ID"), {
      partitionKey,
    });
    return result.map((entry) => entry.id);
  }

  /**
   * Gets the count of items in the container
   * @param condition Optional condition to filter the items
   * @returns The count of items matching the condition, or 0 if none
   */
  async getCount(condition?: Condition): Promise<number> {
    const response = await this.query<number>(new Query("COUNT", condition));
    return response[0] ?? 0;
  }

  /**
   * Gets the count of items bucketed by the distinct values of a property
   * @param prop The property path to group by (e.g. `"status"` or `"location.regionCode"`). Only `A-Za-z0-9_` identifiers separated by `.` are allowed.
   * @returns Array of `{ name, count }` pairs, one per distinct value
   */
  async getCountBy(prop: string): Promise<CountBy[]> {
    if (!validProp.test(prop)) {
      throw new Error(`Invalid property "${prop}". Only 'A-Za-z0-9_' allowed.`);
    }

    return this.query<CountBy>(
      `SELECT c.${prop} AS name, COUNT(1) AS count FROM c WHERE IS_DEFINED(c.${prop}) GROUP BY c.${prop}`,
    );
  }

  /**
   * Executes a query against the container
   * @param query SQL query string or query spec
   * @param options Optional feed options including partition key
   * @returns Query results
   */
  async query<T>(
    query: string | SqlQuerySpec | Query,
    options?: FeedOptions,
  ): Promise<T[]> {
    if (query instanceof Query) {
      query = query.build();
    }

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
      if ((error as { code?: number }).code === 404) {
        // Item already deleted, ignore
        return;
      }
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
  query?: string | SqlQuerySpec,
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
  response: ItemResponse<ItemDefinition> | FeedResponse<unknown>,
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
