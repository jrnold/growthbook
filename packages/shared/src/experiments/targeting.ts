import type {
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/validators";

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
 * that must all hold. Removing clauses can only include more users. The change
 * counts as not more restrictive only when every clause of `next` is also a
 * clause of `last` (compared as JSON with sorted object keys). Anything else,
 * including a condition that doesn't parse, counts as more restrictive.
 *
 * This is conservative: changes that only widen a clause (lowering a `$gte`
 * threshold, adding values to an `$in` list) or rewrite it into an equivalent
 * form still count as more restrictive. Telling those apart needs a semantic
 * comparison of the clauses rather than a syntactic one.
 */
export function isConditionMoreRestrictive(
  last?: string,
  next?: string,
): boolean {
  const nextClauses = conditionClauses(next);
  if (nextClauses === null) return true;
  if (!nextClauses.length) return false;
  const lastClauses = conditionClauses(last);
  if (lastClauses === null) return true;
  const lastSet = new Set(lastClauses);
  return !nextClauses.every((clause) => lastSet.has(clause));
}

/** The ANDed clauses of a condition string, or null if it isn't valid. */
function conditionClauses(condition?: string): string[] | null {
  if (!hasAttributeCondition(condition)) return [];
  try {
    const parsed: unknown = JSON.parse(condition as string);
    return isPlainObject(parsed) ? splitClauses(parsed) : null;
  } catch (e) {
    return null;
  }
}

function splitClauses(condition: Record<string, unknown>): string[] | null {
  const clauses: string[] = [];
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
        clauses.push(canonicalJson({ [key]: { [op]: arg } }));
      }
    } else {
      clauses.push(canonicalJson({ [key]: value }));
    }
  }
  return clauses;
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
