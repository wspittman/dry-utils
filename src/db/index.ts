import { Container } from "@azure/cosmos";
import { connectDB, DBOptions } from "./dbInit.ts";
import { externalLog, LogOptions } from "./externalLog.ts";

export { Container } from "./container.ts";
export { Query } from "./Query.ts";

export function setDBLogging(options: LogOptions) {
  externalLog.setFn("DB", options);
}

export let containerMap: Record<string, Container> = {};

export async function dbConnect(options: DBOptions): Promise<void> {
  containerMap = await connectDB(options);
}
