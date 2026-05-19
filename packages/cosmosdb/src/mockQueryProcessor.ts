import type {
  ItemDefinition as Item,
  JSONValue,
  SqlQuerySpec,
} from "@azure/cosmos";

// Split into SELECT, FROM, WHERE, ORDER BY components, supporting optional TOP and GROUP BY (ignored in processing but allows matching queries from Container and Query.build()).
const querySplitter = new RegExp(
  /^\s*SELECT\s+(?:TOP\s+(?<top>\d+)\s+)?(?<select>.+?)\s+FROM\s+c(?:\s+WHERE\s+(?<where>.+?))?(?:\s+ORDER\s+BY\s+(?<orderby>.+?))?(?:\s+GROUP\s+BY\s+.+)?\s*$/i,
);
const cond_is_defined = new RegExp(
  /^IS_DEFINED\(c\.(?<field>[A-Za-z0-9_.]+)\)$/i,
);
const cond_contains = new RegExp(
  /^CONTAINS\(c\.(?<field>[A-Za-z0-9_.]+),\s*(?<param>@[A-Za-z0-9_]+),\s*true\)$/i,
);
const cond_compare = new RegExp(
  /^c\.(?<field>[A-Za-z0-9_.]+)\s*(?<op><=|>=|<|>|=)\s*(?<param>@[A-Za-z0-9_]+)$/i,
);
const cond_in = new RegExp(
  /^c\.(?<field>[A-Za-z0-9_.]+)\s+IN\s+\((?<params>(?:@[A-Za-z0-9_]+)(?:\s*,\s*@[A-Za-z0-9_]+)*)\)$/i,
);

/**
 * Arguments passed to a {@link MockQueryDef} handler during query processing.
 * @property items The current set of items being processed.
 * @property params The query parameters as a name-value map.
 * @property match If the matcher was a regex, the RegExpMatchArray from matching the query clause.
 */
interface MockQueryArgs {
  items: Item[];
  params: Record<string, JSONValue>;
  match?: RegExpMatchArray;
}

/**
 * Defines a custom matcher and handler for a SELECT projection or WHERE filter clause.
 * Used to extend the built-in query processing in `MockAzureContainer`.
 * @property matcher A string or regex pattern to match against the query clause. If a regex, capture groups will be passed to the handler.
 * @property fn A function that takes the items, query parameters, and regex match (if applicable) and returns the processed result.
 */
export interface MockQueryDef {
  matcher: string | RegExp;
  fn: (args: MockQueryArgs) => unknown[];
}

const builtInProjects: MockQueryDef[] = [
  { matcher: "*", fn: ({ items }) => items },
  { matcher: /^VALUE COUNT\(1\)$/i, fn: ({ items }) => [items.length] },
  {
    // getCountBy: SELECT c.{prop} AS name, COUNT(1) AS count FROM c WHERE IS_DEFINED(c.{prop}) GROUP BY c.{prop}
    matcher:
      /^c\.(?<prop>[A-Za-z0-9_.]+)\s+AS\s+name\s*,\s*COUNT\(1\)\s+AS\s+count$/i,
    fn: ({ items, match }) => {
      const prop = match!.groups!["prop"]!;
      const counts = new Map<unknown, number>();
      for (const item of items) {
        const value = getFieldValue(item, prop);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([name, count]) => ({
        name,
        count,
      }));
    },
  },
  {
    // Simple Selected Properties
    // Matches a comma-separated list of c.property (no spaces)
    // Where property can be A-Za-z0-9_
    matcher: /^(?<clause>(?:c\.[A-Za-z0-9_]+)(?:\s*,\s*c\.[A-Za-z0-9_]+)*)$/i,
    fn: ({ items, match }) => {
      const clause = match!.groups!["clause"]!.trim();

      // Split, trim, and remove "c." prefix
      const properties = clause.split(",").map((part) => part.trim().slice(2));

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
    matcher: /^(?<where>.+)$/,
    fn: ({ items, params, match }) => {
      const whereClause = match!.groups!["where"]!.trim();
      if (!whereClause) {
        throw new Error("Where clause did not match expected pattern");
      }
      return items.filter((item) => evaluateWhere(whereClause, params, item));
    },
  },
];

/**
 * Processes a SQL query spec against an in-memory item set.
 * Handles the query patterns produced by `Container` and `Query.build()`.
 * Provided filters and projects are checked before built-in processing, allowing for custom query extensions.
 * @param items The items to query against.
 * @param query The SQL query spec with parameterized values.
 * @param filters Custom WHERE clause matchers to extend filtering capabilities.
 * @param projects Custom SELECT clause matchers to extend projection capabilities.
 * @returns The result of processing the query, which may be an array of items, a scalar value, or any structure returned by custom matchers.
 */
export function processQuery(
  items: Item[],
  { query, parameters = [] }: SqlQuerySpec,
  filters: MockQueryDef[] = [],
  projects: MockQueryDef[] = [],
): unknown[] {
  const match = query.match(querySplitter)?.groups;
  const { select, top, where, orderby } = match ?? {};

  if (!match || !select) {
    throw new Error(`Query did not match supported mocking pattern: ${query}`);
  }

  const params = Object.fromEntries(parameters.map((p) => [p.name, p.value]));
  const topN = top ? parseInt(top, 10) : undefined;

  items = invokeMatchingDef({ items, params }, where, [
    ...filters,
    ...builtInFilters,
  ]) as Item[];

  if (orderby) {
    items = sortByOrderBy(items, orderby);
  }

  const result = invokeMatchingDef({ items, params }, select, [
    ...projects,
    ...builtInProjects,
  ]);

  return topN ? result.slice(0, topN) : result;
}

/**
 * Finds the first matching {@link MockQueryDef} for the given query string and invokes its handler.
 * Returns the original items unchanged if no matcher is found or the query is empty.
 */
function invokeMatchingDef(
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
 * Sorts items by a CosmosDB ORDER BY clause string.
 * Parses `c.field [ASC|DESC], c.other [ASC|DESC]` and applies a stable multi-key sort.
 */
function sortByOrderBy(items: Item[], orderby: string): Item[] {
  const parts = orderby.split(",").map((s) => {
    const match = s
      .trim()
      .match(/^c\.(?<field>[A-Za-z0-9_.]+)(?:\s+(?<dir>ASC|DESC))?$/i);
    return match
      ? {
          field: match.groups!["field"]!,
          desc: match.groups!["dir"]?.toUpperCase() === "DESC",
        }
      : null;
  });

  return [...items].sort((a, b) => {
    for (const part of parts) {
      if (!part) continue;
      const av = getFieldValue(a, part.field);
      const bv = getFieldValue(b, part.field);
      if (av === bv) continue;
      if (av == null) return part.desc ? -1 : 1;
      if (bv == null) return part.desc ? 1 : -1;
      const cmp = av < bv ? -1 : 1;
      return part.desc ? -cmp : cmp;
    }
    return 0;
  });
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
  const isDefinedMatch = condition.match(cond_is_defined);
  if (isDefinedMatch) {
    const { field } = isDefinedMatch.groups!;
    return getFieldValue(item, field!) !== undefined;
  }

  const containsMatch = condition.match(cond_contains);
  if (containsMatch) {
    const { field, param } = containsMatch.groups!;
    const itemValue = getFieldValue(item, field!);
    const paramValue = params[param!];
    if (typeof itemValue !== "string" || typeof paramValue !== "string") {
      return false;
    }
    return itemValue.toLowerCase().includes(paramValue.toLowerCase());
  }

  const compareMatch = condition.match(cond_compare);
  if (compareMatch) {
    const { field, op, param } = compareMatch.groups!;
    const itemValue = getFieldValue(item, field!);
    const paramValue = params[param!];
    if (itemValue == null || paramValue == null) return false;
    if (typeof itemValue !== typeof paramValue) return false;
    switch (op) {
      case "=":
        return itemValue === paramValue;
      case "<":
        return itemValue < paramValue;
      case "<=":
        return itemValue <= paramValue;
      case ">":
        return itemValue > paramValue;
      case ">=":
        return itemValue >= paramValue;
    }
  }

  const inMatch = condition.match(cond_in);
  if (inMatch) {
    const { field, params: paramsStr } = inMatch.groups!;
    const itemValue = getFieldValue(item, field!);
    const values = paramsStr!.split(",").map((p) => params[p.trim()]);
    return values.includes(itemValue as JSONValue);
  }

  throw new Error(`Unsupported WHERE condition in mock: ${condition}`);
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
  for (const part of whereClause.split(/ AND /i)) {
    const trimmed = part.trim();
    const inner =
      trimmed.startsWith("(") && trimmed.endsWith(")")
        ? trimmed.slice(1, -1).trim()
        : trimmed;
    if (!evaluateCondition(inner, params, item)) return false;
  }
  return true;
}
