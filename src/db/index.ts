import type { ItemDefinition } from "@azure/cosmos";
import { Container } from "./container.ts";
import { connectDB, type DBOptions } from "./dbInit.ts";
import { externalLog, type LogOptions } from "./externalLog.ts";

export { Query } from "./Query.ts";
export { Container };

export function setDBLogging(options: LogOptions): void {
  externalLog.setFn("DB", options);
}

export async function dbConnect(
  options: DBOptions
): Promise<Record<string, Container<ItemDefinition>>> {
  return await connectDB(options);
}
