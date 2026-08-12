import type { SqlQuerySpec } from "@azure/cosmos";
import { validatePropPath } from "./utils.ts";
import { type RawWhere, Where, type WhereInput } from "./Where.ts";

/** A supported SELECT projection. */
export type Selector = "*" | "ID" | "COUNT";

/** A property path and optional sort direction. */
export type OrderBy = [field: string, direction?: "ASC" | "DESC"];

/** Configuration for a CosmosDB SQL query. */
export interface QueryOptions {
  select?: Selector;
  top?: number;
  where?: readonly WhereInput[];
  orderBy?: readonly OrderBy[];
}

/**
 * Builds a CosmosDB SQL query.
 * @param options Selection, limit, predicates, and ordering
 * @returns The SQL query and parameter definitions
 */
export function buildQuery({
  select = "*",
  top,
  where = [],
  orderBy = [],
}: QueryOptions = {}): SqlQuerySpec {
  if (top != null && top < 1) {
    throw new Error("Query: Max results must be greater than 0");
  }
  const selectStr = getSelectorString(select);
  const topStr = top != null ? ` TOP ${top}` : "";

  const whereClauses = where.map(toWhere);
  const [whereClause, parameters] = whereClauses.length
    ? Where.all(whereClauses).build()
    : ["", undefined];
  const whereStr = whereClause ? ` WHERE ${whereClause}` : "";
  const paramStr = toSQLParameters(parameters);

  const orderClauses = orderBy.map(toOrderStr);
  const orderStr = orderClauses.length
    ? ` ORDER BY ${orderClauses.join(", ")}`
    : "";

  return {
    query: `SELECT${topStr} ${selectStr} FROM c${whereStr}${orderStr}`,
    parameters: paramStr,
  };
}

function getSelectorString(select: Selector): string {
  switch (select) {
    case "*":
      return "*";
    case "ID":
      return "c.id";
    case "COUNT":
      return "VALUE COUNT(1)";
  }
}

function toWhere(input: WhereInput): Where {
  if (input instanceof Where) return input;
  return input.length === 3 ? Where.is(...input) : Where.raw(input);
}

function toOrderStr([field, direction = "ASC"]: OrderBy) {
  validatePropPath(field);
  return `c.${field} ${direction}`;
}

function toSQLParameters(parameters: RawWhere[1]) {
  if (!parameters) return undefined;

  return Object.entries(parameters).map(([name, value]) => ({
    name,
    value,
  }));
}
