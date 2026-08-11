import type { SqlQuerySpec } from "@azure/cosmos";
import { validatePropPath } from "./utils.ts";
import {
  type Condition,
  type RawWhere,
  Where,
  type WhereInput,
} from "./Where.ts";

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

/** Builds a CosmosDB SQL query from one-shot options. */
export class Query {
  readonly #selector: Selector;
  readonly #top?: number;
  readonly #whereClauses: Where[];
  readonly #orderClauses: string[];

  /**
   * Creates a query from the supplied options.
   * @param options Selection, limit, predicates, and ordering
   */
  constructor({
    select = "*",
    top,
    where = [],
    orderBy = [],
  }: QueryOptions = {}) {
    if (top != null && top < 1) {
      throw new Error("Query: Max results must be greater than 0");
    }

    this.#selector = select;
    this.#top = top;
    this.#whereClauses = where.map(toWhere);
    this.#orderClauses = orderBy.map(([field, direction = "ASC"]) => {
      validatePropPath(field);
      return `c.${field} ${direction}`;
    });
  }

  /**
   * Builds the final CosmosDB SQL query specification.
   * @returns The SQL query and parameter definitions
   */
  build(): SqlQuerySpec {
    const top = this.#top != null ? ` TOP ${this.#top}` : "";
    const order = this.#orderClauses.length
      ? ` ORDER BY ${this.#orderClauses.join(", ")}`
      : "";
    const [whereClause, parameters] = this.#getWhere();
    const where = whereClause ? ` WHERE ${whereClause}` : "";

    return {
      query: `SELECT${top} ${this.#getSelectorString()} FROM c${where}${order}`,
      parameters: Object.entries(parameters ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
    };
  }

  #getSelectorString(): string {
    switch (this.#selector) {
      case "*":
        return "*";
      case "ID":
        return "c.id";
      case "COUNT":
        return "VALUE COUNT(1)";
    }
  }

  #getWhere(): RawWhere {
    return this.#whereClauses.length
      ? Where.all(this.#whereClauses).build()
      : ["", {}];
  }
}

function toWhere(input: WhereInput): Where {
  if (input instanceof Where) return input;
  return input.length === 3 ? Where.is(...input) : Where.raw(input);
}

export type { Condition, RawWhere, WhereInput };
