import { Container } from "@azure/cosmos";
import { connectDB, DBOptions } from "./dbInit";
import { externalLog, LogOptions } from "./externalLog";

export { Container } from "./container";
export { Query } from "./Query";

export function setDBLogging(options: LogOptions) {
  externalLog.setFn("DB", options);
}

export let containerMap: Record<string, Container> = {};

export async function dbConnect(options: DBOptions): Promise<void> {
  containerMap = await connectDB(options);
}
