import type {
  ItemDefinition as Item,
  JSONValue,
  SqlQuerySpec,
} from "@azure/cosmos";

interface MockQueryArgs {
  items: Item[];
  params: Record<string, JSONValue>;
  match?: RegExpMatchArray;
}

export interface MockQueryDef {
  matcher: string | RegExp;
  fn: (args: MockQueryArgs) => unknown[];
}

const builtInProjects: MockQueryDef[] = [
  { matcher: "*", fn: ({ items }) => items },
  { matcher: "VALUE COUNT(1)", fn: ({ items }) => [items.length] },
  {
    // Simple Selected Properties
    // Matches "SELECT x from c"
    // Where x is a comma-separated list of c.property (no spaces)
    // Where property can be A-Za-z0-9_
    matcher: /^((?:c\.[A-Za-z0-9_]+)(?:\s*,\s*c\.[A-Za-z0-9_]+)*)$/i,
    fn: ({ items, match }) => {
      const clause = match?.[1]?.trim();
      if (!clause) {
        throw new Error("Project clause did not match expected pattern");
      }

      const properties = clause.split(",").map((part) => {
        // trim and remove "c." prefix
        const propMatch = part.trim().slice(2);
        if (!propMatch) {
          throw new Error("Project property did not match expected pattern");
        }
        return propMatch;
      });

      return items.map((item) =>
        // Omit properties not on item or in projection list
        Object.fromEntries(
          properties
            .filter((property) => Object.hasOwn(item, property))
            .map((property) => [property, item[property]]),
        ),
      );
    },
  },
];

const builtInFilters: MockQueryDef[] = [
  {
    matcher: /^(.+)$/,
    fn: ({ items, params, match }) => {
      const whereClause = match?.[1]?.trim();
      if (!whereClause) {
        throw new Error("Where clause did not match expected pattern");
      }
      return items.filter((item) => evaluateWhere(whereClause, params, item));
    },
  },
];

const querySplitter =
  /^\s*SELECT\s+(?:TOP\s+(?<top>\d+)\s+)?(?<select>.+?)\s+FROM\s+c(?:\s+WHERE\s+(?<where>.+))?\s*$/i;

/**
 * Processes a SQL query spec against an in-memory item set.
 * Handles the query patterns produced by `Container` and `Query.build()`,
 * falling back to custom `MockQueryDef` matchers for anything else.
 */
export function processQuery(
  items: Item[],
  { query, parameters = [] }: SqlQuerySpec,
  filters: MockQueryDef[] = [],
  projects: MockQueryDef[] = [],
): unknown[] {
  const match = query.match(querySplitter)?.groups;
  const { select, top, where } = match ?? {};

  if (!match || !select) {
    throw new Error(`Query did not match supported mocking pattern: ${query}`);
  }

  const params = Object.fromEntries(parameters.map((p) => [p.name, p.value]));
  const topN = top ? parseInt(top, 10) : undefined;

  items = processDefs({ items, params }, where, [
    ...filters,
    ...builtInFilters,
  ]) as Item[];

  const result = processDefs({ items, params }, select, [
    ...projects,
    ...builtInProjects,
  ]);

  return topN ? result.slice(0, topN) : result;
}

function processDefs(
  args: MockQueryArgs,
  query: string = "",
  defs: MockQueryDef[] = [],
): unknown[] {
  if (!query) return args.items;

  for (const { matcher, fn } of defs) {
    const match =
      (matcher instanceof RegExp && query.match(matcher)) || undefined;

    if (match || matcher === query) {
      return fn({ ...args, match });
    }
  }

  return args.items;
}

/**
 * Retrieves a nested field value from an item using a dot-separated path.
 * e.g. "facets.experience" → item.facets.experience
 */
function getFieldValue(item: Item, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = item;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Evaluates a single condition against an item and query parameters.
 * Supports: c.field op @param (=, <, <=, >, >=) and CONTAINS(c.field, @param, true)
 */
function evaluateCondition(
  condition: string,
  params: Record<string, JSONValue>,
  item: Item,
): boolean {
  const containsRe =
    /^CONTAINS\(c\.([A-Za-z0-9_.]+),\s*(@[A-Za-z0-9_]+),\s*true\)$/i;
  const containsMatch = condition.match(containsRe);
  if (containsMatch) {
    const itemValue = getFieldValue(item, containsMatch[1]!);
    const paramValue = params[containsMatch[2]!];
    if (typeof itemValue !== "string" || typeof paramValue !== "string") {
      return false;
    }
    return itemValue.toLowerCase().includes(paramValue.toLowerCase());
  }

  const compareRe = /^c\.([A-Za-z0-9_.]+)\s*(<=|>=|<|>|=)\s*(@[A-Za-z0-9_]+)$/;
  const compareMatch = condition.match(compareRe);
  if (compareMatch) {
    const [, fieldPath, op, paramName] = compareMatch;
    const itemValue = getFieldValue(item, fieldPath!);
    const paramValue = params[paramName!];
    if (itemValue === undefined || paramValue === undefined) return false;
    switch (op!) {
      case "=":
        return itemValue === paramValue;
      case "<":
        return (itemValue as number) < (paramValue as number);
      case "<=":
        return (itemValue as number) <= (paramValue as number);
      case ">":
        return (itemValue as number) > (paramValue as number);
      case ">=":
        return (itemValue as number) >= (paramValue as number);
    }
  }

  // Unknown condition — don't filter
  return true;
}

/**
 * Evaluates a WHERE clause string against an item and query parameters.
 * Expects the parenthesized AND-joined format produced by Query.build():
 * e.g. "(c.val > @val) AND (c.status = @status)"
 */
function evaluateWhere(
  whereClause: string,
  params: Record<string, JSONValue>,
  item: Item,
): boolean {
  // Split AND-joined parenthesized conditions: "(cond1) AND (cond2)"
  // Stripping outer parens handles CONTAINS which has its own inner parens.
  for (const part of whereClause.split(" AND ")) {
    const trimmed = part.trim();
    const inner =
      trimmed.startsWith("(") && trimmed.endsWith(")")
        ? trimmed.slice(1, -1).trim()
        : trimmed;
    if (!evaluateCondition(inner, params, item)) return false;
  }
  return true;
}
