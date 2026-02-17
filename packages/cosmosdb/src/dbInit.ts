import type { ContainerRequest, Database, ItemDefinition } from "@azure/cosmos";
import { CosmosClient } from "@azure/cosmos";
import fs from "node:fs";
import https from "node:https";
import { Container } from "./container.ts";
import { diag } from "./diagnostics.ts";

export interface ContainerOptions {
  name: string;
  partitionKey: string;
  indexExclusions?: "none" | "all" | string[];
}

export interface DBOptions {
  endpoint: string;
  key: string;
  name: string;
  localCertPath?: string;
  containers: ContainerOptions[];
}

const MAX_CREATE_ATTEMPTS = 3;

/**
 * Establishes connection to Cosmos DB and initializes containers
 * Creates database and containers if they don't exist
 * @throws {Error} If database connection fails
 * @returns Map of container names to container instances
 */
export async function connectDB({
  endpoint,
  key,
  name,
  localCertPath,
  containers,
}: DBOptions): Promise<Record<string, Container<ItemDefinition>>> {
  let agent;
  if (localCertPath) {
    agent = new https.Agent({ ca: fs.readFileSync(localCertPath) });
  }

  const cosmosClient = new CosmosClient({ endpoint, key, agent });

  const { database } = await cosmosClient.databases.createIfNotExists({
    id: name,
  });

  const containerMap: Record<string, Container<ItemDefinition>> = {};

  const containerPromises = containers.map((c) => createContainer(database, c));
  const results = await Promise.allSettled(containerPromises);
  const failures: string[] = [];

  results.forEach((r, i) => {
    const name = containers[i]?.name;
    if (name && r.status === "fulfilled" && r.value) {
      containerMap[name] = r.value;
    } else {
      failures.push(name ?? `No container name at index ${i}`);
    }
  });

  if (failures.length) {
    throw new Error(`Failed to initialize containers: ${failures.join(", ")}`);
  }

  diag.log("ConnectDB", "CosmosDB connected");

  return containerMap;
}

async function createContainer(
  database: Database,
  options: ContainerOptions,
  attempt = 1,
): Promise<Container<ItemDefinition> | undefined> {
  const { name, partitionKey, indexExclusions = "none" } = options;
  try {
    const details: ContainerRequest = {
      id: name,
      partitionKey: { paths: [`/${partitionKey}`] },
    };

    if (indexExclusions !== "none") {
      details.indexingPolicy = getIndexingPolicy(indexExclusions);
    }

    const { container: internalContainer } =
      await database.containers.createIfNotExists(details);
    return new Container(name, internalContainer);
  } catch (error) {
    if (attempt < MAX_CREATE_ATTEMPTS) {
      diag.error(
        "CreateContainer",
        `Failed to create container: ${name} (attempt ${attempt})`,
      );
      return createContainer(database, options, attempt + 1);
    }

    diag.error("CreateContainer", error);
    return;
  }
}

function getIndexingPolicy(exclusions: "all" | string[]) {
  const all = [{ path: "/*" }];

  if (exclusions === "all") {
    return { excludedPaths: all };
  }

  return {
    includedPaths: all,
    excludedPaths: ['/"_etag"/?', ...exclusions].map((path) => ({ path })),
  };
}
