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

/** A composable CosmosDB SQL predicate expression. */
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
  static raw([clause, parameters = {}]: RawWhere): Where {
    for (const name of Object.keys(parameters)) {
      if (!name.startsWith("@")) {
        throw new Error(`Where: Parameter "${name}" must start with @`);
      }
    }
    return new Where({ kind: "raw", raw: [clause, { ...parameters }] });
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
  return input.length === 3 ? Where.is(...input) : Where.raw(input);
}

function renderCondition(
  [field, operator, value]: Condition,
  context: BuildContext,
): string {
  const property = `c.${field}`;

  if (isMultiValueOperator(operator)) {
    const values = isJSONValueArray(value) ? value : [value];
    const parameters = values.map((entry) => addParameter(context, entry));
    return operator === "IN"
      ? `${property} IN (${parameters.join(", ")})`
      : `${operator}(${property}, ${parameters.join(", ")})`;
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
    clause = clause.replace(parameterPattern(name), generatedName);
  }
  return clause;
}

function parameterPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
