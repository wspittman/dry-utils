import {
  Container,
  ContainerRequest,
  CosmosClient,
  Database,
} from "@azure/cosmos";
import fs from "fs";
import https from "https";
import { externalLog } from "./externalLog.ts";

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
}: DBOptions): Promise<Record<string, Container>> {
  let agent;
  if (localCertPath) {
    agent = new https.Agent({ ca: fs.readFileSync(localCertPath) });
  }

  const cosmosClient = new CosmosClient({ endpoint, key, agent });

  const { database } = await cosmosClient.databases.createIfNotExists({
    id: name,
  });

  const containerMap: Record<string, Container> = {};

  const containerPromises = containers.map((c) => createContainer(database, c));
  const results = await Promise.allSettled(containerPromises);
  const failures: string[] = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      containerMap[containers[i].name] = r.value;
    } else {
      failures.push(containers[i].name);
    }
  });

  if (failures.length) {
    throw new Error(`Failed to initialize containers: ${failures.join(", ")}`);
  }

  externalLog.log("ConnectDB", "CosmosDB connected");

  return containerMap;
}

async function createContainer(
  database: Database,
  options: ContainerOptions,
  attempt = 1
): Promise<Container | undefined> {
  const { name, partitionKey, indexExclusions = "none" } = options;
  try {
    const details: ContainerRequest = {
      id: name,
      partitionKey: { paths: [`/${partitionKey}`] },
    };

    if (indexExclusions !== "none") {
      details.indexingPolicy = getIndexingPolicy(indexExclusions);
    }

    const { container } = await database.containers.createIfNotExists(details);
    return container;
  } catch (error) {
    if (attempt < MAX_CREATE_ATTEMPTS) {
      externalLog.error(
        "CreateContainer",
        `Failed to create container: ${name} (attempt ${attempt})`
      );
      return createContainer(database, options, attempt + 1);
    }

    externalLog.error("CreateContainer", error);
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
