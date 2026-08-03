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
const cond_st_distance = new RegExp(
  /^ST_DISTANCE\s*\(\s*c\.(?<field>[A-Za-z0-9_.]+)\s*,\s*(?<origin>@[A-Za-z0-9_]+)\s*\)\s*<=\s*(?<radius>@[A-Za-z0-9_]+)$/i,
);

type PointCoordinates = [longitude: number, latitude: number];

const MEAN_EARTH_RADIUS_METERS = 6_371_008.8;

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
 * Values use Cosmos DB type precedence: undefined, null, boolean, number, string, array, object.
 * DESC fully reverses the ASC ordering.
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
      const typeCmp = getOrderByTypeRank(av) - getOrderByTypeRank(bv);
      if (typeCmp !== 0) return part.desc ? -typeCmp : typeCmp;
      const cmp = compareOrderByValues(av, bv);
      return part.desc ? -cmp : cmp;
    }
    return 0;
  });
}

/**
 * Returns the Cosmos DB ORDER BY precedence for a value's JSON type.
 */
function getOrderByTypeRank(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === "boolean") return 2;
  if (typeof value === "number") return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

/**
 * Compares values that share the same Cosmos DB ORDER BY type precedence.
 */
function compareOrderByValues(a: unknown, b: unknown): number {
  if (
    (typeof a === "boolean" && typeof b === "boolean") ||
    (typeof a === "number" && typeof b === "number") ||
    (typeof a === "string" && typeof b === "string")
  ) {
    return a < b ? -1 : 1;
  }
  return 0;
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
 * Supports scalar comparisons, CONTAINS, IN, IS_DEFINED, and Point-to-Point ST_DISTANCE radius filters.
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

  const distanceMatch = condition.match(cond_st_distance);
  if (distanceMatch) {
    const { field, origin, radius } = distanceMatch.groups!;
    const originCoordinates = getPointCoordinates(params[origin!]);
    if (!originCoordinates) {
      throw new Error(
        `Invalid ST_DISTANCE origin parameter ${origin}: expected a GeoJSON Point with finite longitude [-180, 180] and latitude [-90, 90]`,
      );
    }

    const radiusMeters = params[radius!];
    if (typeof radiusMeters !== "number" || !Number.isFinite(radiusMeters)) {
      throw new Error(
        `Invalid ST_DISTANCE radius parameter ${radius}: expected a finite number`,
      );
    }

    const itemCoordinates = getPointCoordinates(getFieldValue(item, field!));
    return (
      itemCoordinates !== undefined &&
      getPointDistanceMeters(itemCoordinates, originCoordinates) <= radiusMeters
    );
  }

  throw new Error(`Unsupported WHERE condition in mock: ${condition}`);
}

/**
 * Returns validated longitude/latitude coordinates for a narrow GeoJSON Point.
 */
function getPointCoordinates(value: unknown): PointCoordinates | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const point = value as Record<string, unknown>;
  const coordinates = point["coordinates"];
  if (
    point["type"] !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2
  ) {
    return;
  }

  const longitude: unknown = coordinates[0];
  const latitude: unknown = coordinates[1];
  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return;
  }

  return [longitude, latitude];
}

/**
 * Approximates Point-to-Point distance in meters with the Haversine formula.
 * Cosmos remains authoritative for exact geospatial calculations and edge cases.
 */
function getPointDistanceMeters(
  [longitudeA, latitudeA]: PointCoordinates,
  [longitudeB, latitudeB]: PointCoordinates,
): number {
  const latitudeARadians = toRadians(latitudeA);
  const latitudeBRadians = toRadians(latitudeB);
  const latitudeDelta = latitudeBRadians - latitudeARadians;
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine =
    sinLatitude * sinLatitude +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      sinLongitude *
      sinLongitude;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  const angularDistance =
    2 *
    Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine));
  return MEAN_EARTH_RADIUS_METERS * angularDistance;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
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
