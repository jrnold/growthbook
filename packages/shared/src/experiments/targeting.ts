import { evalCondition, paddedVersionString } from "@growthbook/growthbook";
import type {
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/validators";
import type {
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";

/**
 * An empty attribute-targeting condition is stored as the string "{}".
 * Returns true only when a non-empty condition is configured.
 */
export function hasAttributeCondition(condition?: string): boolean {
  return !!condition && condition !== "{}";
}

/**
 * Whether an experiment phase (or feature rule) has any targeting configured:
 * an attribute condition, saved group targeting, or prerequisites.
 */
export function hasTargetingConfigured(target?: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
}): boolean {
  if (!target) return false;
  return (
    hasAttributeCondition(target.condition) ||
    !!target.savedGroups?.length ||
    !!target.prerequisites?.length
  );
}

/**
 * Whether changing an attribute condition from `last` to `next` could exclude
 * users that `last` included.
 *
 * evalCondition ANDs together every top-level key, every `$and` item, and every
 * operator in a field's operator object, so a condition is a set of clauses
 * that must all hold. The change counts as not more restrictive only when every
 * clause of `next` is implied by the clauses of `last`: it is one of them
 * (compared as JSON with sorted object keys), or a rule in `isClauseImplied`
 * shows that every user `last` matches also passes it. That covers widening a
 * clause, such as lowering a `$gte` threshold, adding values to an `$in` list
 * or adding a branch to an `$or`. Anything else, including a condition that
 * doesn't parse, counts as more restrictive.
 *
 * `attributes` is the org's attribute schema. Some rules trust an attribute's
 * declared scalar datatype (that a "string" attribute is a string or missing),
 * because evalCondition coerces values in literal comparisons: `{"id": "5"}`
 * also matches the number 5 and the array ["5"], and `{"id": {"$in": ["5"]}}`
 * matches neither. Without a datatype those rules don't apply.
 *
 * Safe changes that no single rule proves, such as splitting one range into
 * an `$or` of two adjacent ranges, still count as more restrictive.
 */
export function isConditionMoreRestrictive(
  last?: string,
  next?: string,
  attributes?: SDKAttributeSchema,
): boolean {
  const nextClauses = conditionClauses(next);
  if (nextClauses === null) return true;
  if (!nextClauses.length) return false;
  const lastClauses = conditionClauses(last);
  if (lastClauses === null) return true;
  const types: AttributeTypes = new Map(
    (attributes ?? []).map((a) => [a.property, a.datatype]),
  );
  return !nextClauses.every((clause) =>
    isClauseImplied(lastClauses, clause, types),
  );
}

type Clause = { key: string; value: unknown; json: string };
type AttributeTypes = Map<string, SDKAttributeType>;
type Primitive = string | number | boolean | null;

/** The ANDed clauses of a condition string, or null if it isn't valid. */
function conditionClauses(condition?: string): Clause[] | null {
  if (!hasAttributeCondition(condition)) return [];
  try {
    const parsed: unknown = JSON.parse(condition as string);
    return isPlainObject(parsed) ? splitClauses(parsed) : null;
  } catch (e) {
    return null;
  }
}

function splitClauses(condition: Record<string, unknown>): Clause[] | null {
  const clauses: Clause[] = [];
  for (const [key, value] of Object.entries(condition)) {
    if (key === "$and") {
      if (!Array.isArray(value)) return null;
      for (const item of value) {
        const inner = isPlainObject(item) ? splitClauses(item) : null;
        if (!inner) return null;
        clauses.push(...inner);
      }
    } else if (key[0] !== "$" && isOperatorObject(value)) {
      for (const [op, arg] of Object.entries(value)) {
        clauses.push(makeClause(key, { [op]: arg }));
      }
    } else {
      clauses.push(makeClause(key, value));
    }
  }
  return clauses;
}

function makeClause(key: string, value: unknown): Clause {
  return { key, value, json: canonicalJson({ [key]: value }) };
}

/** Whether every user matching all of `last` passes `clause`. */
function isClauseImplied(
  last: Clause[],
  clause: Clause,
  types: AttributeTypes,
): boolean {
  if (last.some((c) => c.json === clause.json)) return true;

  if (clause.key === "$or") {
    const branches = clause.value;
    if (Array.isArray(branches) && branches.every(isPlainObject)) {
      // An empty $or matches everyone
      if (!branches.length) return true;
      if (branches.some((b) => isConditionImplied(last, b, types))) {
        return true;
      }
    }
  } else if (clause.key[0] !== "$") {
    const datatype = types.get(clause.key);
    if (
      last.some(
        (c) =>
          c.key === clause.key &&
          isFieldClauseImplied(clause.key, c.value, clause.value, datatype),
      )
    ) {
      return true;
    }
  }

  // Every user matching an $or in `last` matches one of its branches, so it's
  // enough for each branch, with the rest of `last`, to imply the clause
  return last.some((c, i) => {
    const branches = c.value;
    if (c.key !== "$or" || !Array.isArray(branches) || !branches.length) {
      return false;
    }
    const rest = [...last.slice(0, i), ...last.slice(i + 1)];
    return branches.every((branch) => {
      const inner = isPlainObject(branch) ? splitClauses(branch) : null;
      return !!inner && isClauseImplied([...rest, ...inner], clause, types);
    });
  });
}

function isConditionImplied(
  last: Clause[],
  condition: Record<string, unknown>,
  types: AttributeTypes,
): boolean {
  const clauses = splitClauses(condition);
  return !!clauses && clauses.every((c) => isClauseImplied(last, c, types));
}

// Bounds, by operator. Numeric bounds coerce the attribute the same way for
// every constant of one type, and version bounds compare paddedVersionString.
const BOUNDS: Record<
  string,
  { lower: boolean; inclusive: boolean; version: boolean }
> = {
  $gt: { lower: true, inclusive: false, version: false },
  $gte: { lower: true, inclusive: true, version: false },
  $lt: { lower: false, inclusive: false, version: false },
  $lte: { lower: false, inclusive: true, version: false },
  $vgt: { lower: true, inclusive: false, version: true },
  $vgte: { lower: true, inclusive: true, version: true },
  $vlt: { lower: false, inclusive: false, version: true },
  $vlte: { lower: false, inclusive: true, version: true },
};

const VERSION_OPERATORS = new Set([
  "$veq",
  "$vne",
  "$vgt",
  "$vgte",
  "$vlt",
  "$vlte",
]);

// secureString values are compared as hashes, which keep equality but not
// order or patterns
const HASH_SAFE_OPERATORS = new Set([
  "literal",
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$exists",
]);

const SCALAR_TYPES: Partial<Record<SDKAttributeType, string>> = {
  string: "string",
  enum: "string",
  secureString: "string",
  number: "number",
  boolean: "boolean",
};

/**
 * Whether every user passing `{[field]: oldValue}` passes `{[field]: newValue}`,
 * where each value is a single operator or a literal.
 */
function isFieldClauseImplied(
  field: string,
  oldValue: unknown,
  newValue: unknown,
  datatype?: SDKAttributeType,
): boolean {
  const [o, a] = toOperation(oldValue);
  const [n, b] = toOperation(newValue);
  if (
    (datatype === "secureString" || datatype === "secureString[]") &&
    !(HASH_SAFE_OPERATORS.has(o) && HASH_SAFE_OPERATORS.has(n))
  ) {
    return false;
  }

  // When the old clause pins the attribute to a few values, try each one.
  // evalField has no saved groups to check them against.
  const values = exactValues(o, a, datatype);
  if (values) {
    return (
      !usesSavedGroups(newValue) &&
      values.every((v) => evalField(field, v, newValue))
    );
  }
  // $veq pins paddedVersionString of the attribute, which is all that version
  // operators look at
  if (o === "$veq" && VERSION_OPERATORS.has(n) && isPrimitive(a)) {
    return evalField(field, a, newValue);
  }

  if (o === "$in" && n === "$in") return isSubset(a, b, false);
  if ((o === "$in" || o === "$ini") && n === "$ini") {
    return isSubset(a, b, true);
  }
  if (o === "$nin" && n === "$nin") return isSubset(b, a, false);
  if (o === "$nini" && (n === "$nin" || n === "$nini")) {
    return isSubset(b, a, true);
  }
  // An array attribute is never === a primitive, and a scalar one is in `a`
  if (o === "$in" && n === "$ne") {
    return Array.isArray(a) && !a.includes(b);
  }
  if (o === "$nin" && n === "$ne") {
    return Array.isArray(a) && a.includes(b);
  }
  if (n === "$exists" && b === true) {
    if (o === "$in" || o === "$ini") {
      return Array.isArray(a) && !a.includes(null);
    }
    if (o === "$type") return a !== "null" && a !== "undefined";
  }

  return isBoundImplied(o, a, n, b);
}

function toOperation(value: unknown): [string, unknown] {
  // splitClauses leaves one operator per field clause
  return isOperatorObject(value)
    ? Object.entries(value)[0]
    : ["literal", value];
}

/**
 * The only values an attribute can have when it passes the operator, or null
 * if they aren't known. Literals and `$in` rely on a scalar datatype.
 */
function exactValues(
  op: string,
  arg: unknown,
  datatype?: SDKAttributeType,
): Primitive[] | null {
  if (op === "$eq") return isPrimitive(arg) ? [arg] : null;
  const scalar = datatype && SCALAR_TYPES[datatype];
  if (!scalar) return null;
  if (op === "literal") {
    if (typeof arg !== scalar) return null;
    // A missing attribute is null, and null + "" is "null" and null * 1 is 0
    return arg === "null" || arg === 0 ? [arg, null] : [arg as Primitive];
  }
  if (op === "$in" && Array.isArray(arg)) return arg.filter(isPrimitive);
  return null;
}

const SAVED_GROUP_OPERATORS = new Set([
  "$inGroup",
  "$notInGroup",
  "$savedGroup",
]);

/**
 * Whether a clause refers to a saved group anywhere, such as inside a `$not`
 * or an `$elemMatch`. evalCondition treats an unknown group as an empty list.
 */
function usesSavedGroups(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesSavedGroups);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([k, v]) => SAVED_GROUP_OPERATORS.has(k) || usesSavedGroups(v),
  );
}

function evalField(field: string, value: Primitive, clause: unknown): boolean {
  // Nest the value the way evalCondition's getPath reads dotted fields
  const user = field
    .split(".")
    .reduceRight<unknown>((inner, part) => ({ [part]: inner }), value);
  return evalCondition(
    user as Record<string, unknown>,
    { [field]: clause } as Parameters<typeof evalCondition>[1],
  );
}

/** Whether every item of `a` is in `b`, case-insensitively for `$ini`. */
function isSubset(a: unknown, b: unknown, insensitive: boolean): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const fold = (v: unknown) =>
    insensitive && typeof v === "string" ? v.toLowerCase() : v;
  const bValues = b.map(fold);
  return a.every((v) => bValues.includes(fold(v)));
}

function isBoundImplied(o: string, a: unknown, n: string, b: unknown) {
  const oldBound = BOUNDS[o];
  const newBound = BOUNDS[n];
  if (
    !oldBound ||
    !newBound ||
    oldBound.lower !== newBound.lower ||
    oldBound.version !== newBound.version
  ) {
    return false;
  }
  let x: number | string;
  let y: number | string;
  if (oldBound.version) {
    x = paddedVersionString(a);
    y = paddedVersionString(b);
  } else if (typeof a === "number" && typeof b === "number") {
    x = a;
    y = b;
  } else if (isNonNumericString(a) && isNonNumericString(b)) {
    // Against a non-numeric string, only string attributes can pass, and they
    // compare as strings. Numeric strings would compare as numbers instead.
    x = a;
    y = b;
  } else {
    return false;
  }
  if (x === y) return newBound.inclusive || !oldBound.inclusive;
  return oldBound.lower ? y < x : y > x;
}

function isNonNumericString(value: unknown): value is string {
  return typeof value === "string" && Number.isNaN(Number(value));
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Same test as isOperatorObject in the SDK's mongrule.ts
function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => k[0] === "$");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    isPlainObject(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
