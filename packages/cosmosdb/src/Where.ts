import type { JSONValue } from "@azure/cosmos";
import { validatePropPath } from "./utils.ts";

/** Operators supported by structured predicates. */
export type Operator =
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

/** A structured field predicate. */
export type Condition = [field: string, op: Operator, value: JSONValue];

/** A raw SQL predicate and its declared parameters. */
export type RawWhere = [
  clause: string,
  parameters?: Readonly<Record<string, JSONValue>>,
];

/** Any predicate input accepted by a `Where` group. */
export type WhereInput = Condition | RawWhere | Where;

type WhereNode =
  | { kind: "condition"; condition: Condition }
  | { kind: "raw"; raw: RawWhere }
  | {
      kind: "group";
      operator: "AND" | "OR";
      clauses: readonly Where[];
    };

interface BuildContext {
  nextParameter: number;
  parameters: Record<string, JSONValue>;
}

/**
 * A composable CosmosDB SQL predicate expression.
 *
 * When adding WHERE clauses to a query, prefer clauses that
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
 *     - Example: Where.distance("location", origin, "<=", radiusInMeters)
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
export class Where {
  readonly #node: WhereNode;

  private constructor(node: WhereNode) {
    this.#node = node;
  }

  /**
   * Creates a structured field predicate.
   * @param condition Field, comparison operator, and value
   * @returns A predicate for the condition
   */
  static is(...condition: Condition): Where {
    const [field, operator, value] = condition;
    validatePropPath(field);
    validateMultiValue(operator, value);
    return new Where({ kind: "condition", condition });
  }

  /**
   * Creates a predicate from a raw SQL clause and its declared parameters.
   * @param raw SQL clause and optional parameter values
   * @returns A predicate for the raw clause
   */
  static raw(...[clause, parameters = {}]: RawWhere): Where {
    for (const name of Object.keys(parameters)) {
      if (!name.startsWith("@")) {
        throw new Error(`Where: Parameter "${name}" must start with @`);
      }
      if (/^@p\d+$/.test(name)) {
        throw new Error(
          `Where: Parameter "${name}" must start with conflict with generated @p123 parameters`,
        );
      }
    }
    return new Where({ kind: "raw", raw: [clause, { ...parameters }] });
  }

  /**
   * Adds a parameterized `ST_DISTANCE` comparison for a GeoJSON Point.
   * @param field Document field path containing the stored Point
   * @param origin Point from which distance is measured
   * @param op Scalar comparison operator
   * @param meters Distance value in meters
   * @returns A predicate for the distance clause
   */
  static distance(
    field: string,
    origin: JSONValue,
    op: "<=" | ">=",
    meters: number,
  ): Where {
    validatePropPath(field);

    const prop = `c.${field}`;
    const param = `@${field.replace(/\./g, "_")}`;
    const paramOrigin = `${param}_origin`;
    const paramMeters = `${param}_meters`;

    return Where.raw(
      `ST_DISTANCE(${prop}, ${paramOrigin}) ${op} ${paramMeters}`,
      { [paramOrigin]: origin, [paramMeters]: meters },
    );
  }

  /**
   * Creates a predicate that matches any child predicate.
   * @param clauses Predicates to combine with OR
   * @returns The grouped predicate
   */
  static any(clauses: readonly WhereInput[]): Where {
    return Where.#group("OR", "any", clauses);
  }

  /**
   * Creates a predicate that matches every child predicate.
   * @param clauses Predicates to combine with AND
   * @returns The grouped predicate
   */
  static all(clauses: readonly WhereInput[]): Where {
    return Where.#group("AND", "all", clauses);
  }

  /**
   * Builds this expression with deterministic, collision-free parameters.
   * @returns The SQL clause and its parameter values
   */
  build(): RawWhere {
    const context: BuildContext = { nextParameter: 0, parameters: {} };
    return [this.#render(context), context.parameters];
  }

  static #group(
    operator: "AND" | "OR",
    name: "all" | "any",
    inputs: readonly WhereInput[],
  ): Where {
    if (!inputs.length) {
      throw new Error(`Where.${name} requires at least one clause`);
    }
    return new Where({
      kind: "group",
      operator,
      clauses: inputs.map(toWhere),
    });
  }

  #render(context: BuildContext): string {
    switch (this.#node.kind) {
      case "condition":
        return renderCondition(this.#node.condition, context);
      case "raw":
        return renderRaw(this.#node.raw, context);
      case "group": {
        const clauses = this.#node.clauses.map((clause) =>
          clause.#render(context),
        );
        return clauses.length === 1
          ? clauses[0]!
          : clauses
              .map((clause) => `(${clause})`)
              .join(` ${this.#node.operator} `);
      }
    }
  }
}

function toWhere(input: WhereInput): Where {
  if (input instanceof Where) return input;
  return input.length === 3 ? Where.is(...input) : Where.raw(...input);
}

function renderCondition(
  [field, operator, value]: Condition,
  context: BuildContext,
): string {
  const property = `c.${field}`;

  if (isMultiValueOperator(operator)) {
    const values = isJSONValueArray(value) ? value : [value];
    const paramString = values
      .map((entry) => addParameter(context, entry))
      .join(", ");
    return operator === "IN"
      ? `${property} IN (${paramString})`
      : `${operator}(${property}, ${paramString})`;
  }

  const parameter = addParameter(context, value);
  if (operator === "CONTAINS" || operator === "FULLTEXTCONTAINS") {
    const caseInsensitive = operator === "CONTAINS" ? ", true" : "";
    return `${operator}(${property}, ${parameter}${caseInsensitive})`;
  }

  return `${property} ${operator} ${parameter}`;
}

function renderRaw([clause, parameters = {}]: RawWhere, context: BuildContext) {
  for (const [name, value] of Object.entries(parameters)) {
    const pattern = parameterPattern(name);
    if (!pattern.test(clause)) continue;
    const generatedName = addParameter(context, value);
    clause = clause.replace(pattern, generatedName);
  }
  return clause;
}

function parameterPattern(name: string): RegExp {
  // Escape regex-special characters in `name`
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Match `name` unless followed by letter/digit/underscore
  return new RegExp(`${escaped}(?![A-Za-z0-9_])`, "g");
}

function addParameter(context: BuildContext, value: JSONValue): string {
  const name = `@p${context.nextParameter++}`;
  context.parameters[name] = value;
  return name;
}

function validateMultiValue(operator: Operator, value: JSONValue): void {
  if (
    isMultiValueOperator(operator) &&
    isJSONValueArray(value) &&
    !value.length
  ) {
    throw new Error(`${operator} operator requires at least one value`);
  }
}

function isJSONValueArray(value: JSONValue): value is JSONValue[] {
  return Array.isArray(value);
}

function isMultiValueOperator(
  operator: Operator,
): operator is "IN" | "FULLTEXTCONTAINSALL" | "FULLTEXTCONTAINSANY" {
  return ["IN", "FULLTEXTCONTAINSALL", "FULLTEXTCONTAINSANY"].includes(
    operator,
  );
}
