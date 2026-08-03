import type { JSONValue, SqlQuerySpec } from "@azure/cosmos";
import { validatePropPath } from "./utils.ts";

type Op =
  | "<"
  | "<="
  | "="
  | ">"
  | ">="
  | "CONTAINS"
  | "FULLTEXTCONTAINS"
  | "FULLTEXTCONTAINSALL"
  | "FULLTEXTCONTAINSANY"
  | "IN";
type Selector = "*" | "ID" | "COUNT";

export type Condition = [field: string, op: Op, value: JSONValue];
export type Where = [clause: string, parameters?: Record<string, JSONValue>];

/**
 * Helper class for building SQL queries
 *
 * When adding WHERE clauses to the QueryBuilder, prefer clauses that
 * - Make the best use of the index
 * - Reduce the number of documents scanned
 *
 * Preferring and ordering by the most efficient and selective filters
 * reduces the number of documents scanned, improving query speed and lowering RU costs.
 * Treat ORs as if they are the worst of their parts.
 *
 * Prefer WHERE clauses in this order:
 *
 * 1. Index Seek (=, IN, FullTextContains)
 *     - Directly locate one or more indexed values and load matching items.
 *     - RU (load): Scales with result count
 *
 *     Ordinary range-index seeks:
 *     - RU (index): Constant per equality filter.
 *     - Example: c.x = 10
 *     - Example: c.x IN ("value1", "value2", "value3")
 *     - Example: ARRAY_CONTAINS(c.list, { x: 10 })
 *
 *     Full-text index seeks:
 *     - Required: FullTextIndex has been configured for the property path.
 *     - Look up analyzed terms in the specialized inverted index.
 *     - RU (index): Scales with number of searched terms and posting-list/intersection work.
 *     - Example: FullTextContains(c.text, "engineer")
 *     - Example: FullTextContainsAll(c.text, "senior", "engineer")
 *
 * 2. Precise Index Scan (>, >=, <, <=, STARTSWITH, bounded ST_DISTANCE)
 *     - Start at a specific location or region in an ordered/specialized index and scan only the relevant portion.
 *     - RU (load): Scales with result count
 *
 *     Scalar range-index scans:
 *     - RU (index): Comparable to index seek, increases slightly based on the cardinality of indexed properties
 *     - Binary search of indexed values.
 *     - Example: c.x > 10
 *     - Example: STARTSWITH(c.x, "prefix")
 *     - Example: EXISTS (SELECT VALUE l FROM l IN c.list WHERE l.x > 10)
 *
 *     Spatial index scans:
 *     - Required: SpatialIndex has been configured for the property path.
 *     - Search spatial-index regions overlapping the requested radius.
 *     - RU (index): Depends on geometry, spatial distribution, and the size of the searched region.
 *     - Example: ST_DISTANCE(c.location, @origin) < @radius
 *     - Example: query.whereDistance("location", origin, "<=", radiusInMeters)
 *
 * 3. Expanded Index Scan (case-insensitive STARTSWITH, StringEquals)
 *    - Optimized search (but less efficient than a binary search) of indexed values and load only matching items
 *    - RU (index): Increases slightly based on the cardinality of indexed properties
 *    - RU (load): Query result count
 *
 * 4. Full Index Scan (CONTAINS, EndsWith, RegexMatch, LIKE)
 *    - Read distinct set of indexed values and load only matching items
 *    - RU (index): Increases linearly based on the cardinality of indexed properties
 *    - RU (load): Query result count
 *    - Example: CONTAINS(c.x, "word")
 *    - Example: EXISTS (SELECT VALUE l FROM l IN c.list WHERE CONTAINS(l.x, "word"))
 *
 * 5. Full Scan (Negation, UPPER, LOWER)
 *    - Load all items
 *    - RU (index): N/A
 *    - RU (load): Increases based on number of items in container
 *    - Example: c.x != 10
 *    - Example: NOT ARRAY_CONTAINS(c.list, { x: 10 })
 *    - Example: JOIN l IN c.list
 */
export class Query {
  #selector: Selector;
  #top?: number;
  #whereClauses: string[] = [];
  #orderClauses: string[] = [];
  #params: Record<string, JSONValue> = {};

  constructor(selector?: Selector, condition?: Condition) {
    this.#selector = selector ?? "*";
    if (condition) {
      this.whereCondition(...condition);
    }
  }

  /**
   * Sets the SELECT clause selector, replacing the default `*`.
   * @param selector The selector type to use
   * @returns The Query instance for method chaining
   */
  select(selector: Selector): this {
    this.#selector = selector;
    return this;
  }

  /**
   * Sets the maximum number of results to return, adding a TOP clause to the query.
   * @param max The maximum number of results to return
   * @returns The Query instance for method chaining
   */
  top(max: number): this {
    if (max < 1) {
      throw new Error("Query: Max results must be greater than 0");
    }
    this.#top = max;
    return this;
  }

  /**
   * Adds an ORDER BY clause to the query.
   * ASC type precedence is undefined, null, boolean, number, string, array, then object.
   * DESC fully reverses the ASC ordering.
   * @param field Document field path (e.g., `"_ts"` or `"facets.score"`)
   * @param direction Sort direction, defaults to `"ASC"`
   * @returns The Query instance for method chaining
   */
  orderBy(field: string, direction: "ASC" | "DESC" = "ASC"): this {
    validatePropPath(field);
    this.#orderClauses.push(`c.${field} ${direction}`);
    return this;
  }

  /**
   * Adds a WHERE clause to the query.
   * @param clause The WHERE clause to add
   * @param parameters Optional parameters for the clause
   * @returns The Query instance for method chaining
   */
  where([clause, parameters = {}]: Where): this {
    this.#whereClauses.push(clause);
    Object.assign(this.#params, parameters);
    return this;
  }

  /**
   * Adds a WHERE condition using field, operator, and value.
   * Automatically handles parameter naming and value formatting.
   * @param field Document field path (e.g., "status" or "facets.experience")
   * @param op Comparison or contains operator
   * @param value Value to compare against
   * @returns The Query instance for method chaining
   */
  whereCondition(...[field, op, value]: Condition): this {
    return this.where(Query.condition(field, op, value));
  }

  /**
   * Adds a parameterized `ST_DISTANCE` comparison for a GeoJSON Point.
   * @param field Document field path containing the stored Point
   * @param origin Point from which distance is measured
   * @param op Scalar comparison operator
   * @param distanceMeters Distance value in meters
   * @returns The Query instance for method chaining
   */
  whereDistance(
    field: string,
    origin: JSONValue,
    op: "<=" | ">=",
    distanceMeters: number,
  ): this {
    validatePropPath(field);
    const [prop, param] = toPair(field);
    const originParam = `${param}_origin`;
    const distanceParam = `${param}_distanceMeters`;

    return this.where([
      `ST_DISTANCE(${prop}, ${originParam}) ${op} ${distanceParam}`,
      { [originParam]: origin, [distanceParam]: distanceMeters },
    ]);
  }

  /**
   * Builds and returns the final SQL query specification.
   * @returns Object containing the SQL query string and parameter definitions
   */
  build(): SqlQuerySpec {
    const top = this.#top != null ? ` TOP ${this.#top}` : "";
    const order = this.#orderClauses.length
      ? ` ORDER BY ${this.#orderClauses.join(", ")}`
      : "";

    return {
      query: `SELECT${top} ${this.#getSelectorString()} FROM c${this.#getWhereString()}${order}`,
      parameters: Object.entries(this.#params).map(([name, value]) => ({
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

  #getWhereString(): string {
    return this.#whereClauses.length
      ? ` WHERE ${this.#whereClauses.map((x) => `(${x})`).join(" AND ")}`
      : "";
  }

  /**
   * Creates a WHERE clause from field, operator, and value.
   * Automatically handles parameter naming and value formatting.
   * @param field Document field path
   * @param op Comparison operator
   * @param value Value to compare against
   * @returns WHERE clause and its parameters
   */
  static condition(...[field, op, value]: Condition): Where {
    validatePropPath(field);
    const [prop, param] = toPair(field);

    const valueObj: Record<string, JSONValue> = Array.isArray(value)
      ? Object.fromEntries(value.map((v, i) => [`${param}_${i}`, v] as const))
      : { [param]: value };

    if (op === "CONTAINS" || op === "FULLTEXTCONTAINS") {
      const suffix = op === "CONTAINS" ? ", true" : "";
      return [`${op}(${prop}, ${param}${suffix})`, valueObj];
    }

    if (["IN", "FULLTEXTCONTAINSALL", "FULLTEXTCONTAINSANY"].includes(op)) {
      if (!Object.keys(valueObj).length) {
        throw new Error(`${op} operator requires at least one value`);
      }
      const paramList = Object.keys(valueObj).join(", ");
      const clause =
        op === "IN"
          ? `${prop} IN (${paramList})`
          : `${op}(${prop}, ${paramList})`;
      return [clause, valueObj];
    }

    return [`${prop} ${op} ${param}`, valueObj];
  }
}

const toPair = (field: string) => [`c.${field}`, toParam(field)] as const;
const toParam = (field: string) => `@${field.replace(/\./g, "_")}`;
