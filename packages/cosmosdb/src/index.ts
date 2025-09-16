import type { ItemDefinition } from "@azure/cosmos";
import { Container } from "./container.ts";
import { connectDB, type DBOptions } from "./dbInit.ts";

export { subscribeCosmosDBLogging } from "./diagnostics.ts";

export { Query } from "./Query.ts";
export { Container };

export async function dbConnect(
  options: DBOptions
): Promise<Record<string, Container<ItemDefinition>>> {
  return await connectDB(options);
}
