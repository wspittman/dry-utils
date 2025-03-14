import { Container } from "@azure/cosmos";
import { connectDB, DBOptions } from "./dbInit";
import { externalLog } from "./externalLog";

export { Container } from "./container";

export const setAsyncLogging = externalLog.setFn;

export let containerMap: Record<string, Container> = {};

export async function dbConnect(options: DBOptions): Promise<void> {
  containerMap = await connectDB(options);
}
