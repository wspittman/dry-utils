export { Container, type DBItem } from "./container.ts";
export {
  connectDB,
  type ContainerOptions,
  type DBOptions,
  type MockDBData,
  type MockDBQueryDefs,
} from "./dbInit.ts";
export { subscribeCosmosDBLogging } from "./diagnostics.ts";
export { loadMockDBData, type MockDBDataOptions } from "./mockDbData.ts";
export type { MockQueryDef } from "./mockQueryProcessor.ts";
export {
  buildQuery,
  type OrderBy,
  type QueryOptions,
  type Selector,
} from "./Query.ts";
export {
  Where,
  type Condition,
  type Operator,
  type RawWhere,
  type WhereInput,
} from "./Where.ts";

export type {
  FeedOptions,
  ItemDefinition,
  JSONValue,
  SqlQuerySpec,
} from "@azure/cosmos";
