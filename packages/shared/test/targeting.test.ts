/// <reference types="jest" />

import { createHash } from "crypto";
import { ConditionInterface, evalCondition } from "@growthbook/growthbook";
import type { SDKAttributeSchema } from "shared/types/organization";
import {
  hasAttributeCondition,
  hasTargetingConfigured,
  isConditionMoreRestrictive,
} from "../src/experiments/targeting";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
};

describe("hasAttributeCondition", () => {
  it("returns false for empty / missing conditions", () => {
    expect(hasAttributeCondition(undefined)).toBe(false);
    expect(hasAttributeCondition("")).toBe(false);
    expect(hasAttributeCondition("{}")).toBe(false);
  });

  it("returns true for a non-empty condition", () => {
    expect(hasAttributeCondition('{"country":"US"}')).toBe(true);
  });
});

describe("hasTargetingConfigured", () => {
  it("returns false when nothing is configured", () => {
    expect(hasTargetingConfigured(undefined)).toBe(false);
    expect(hasTargetingConfigured({})).toBe(false);
    expect(
      hasTargetingConfigured({
        condition: "{}",
        savedGroups: [],
        prerequisites: [],
      }),
    ).toBe(false);
  });

  it("returns true when an attribute condition is set", () => {
    expect(
      hasTargetingConfigured({
        condition: '{"country":{"$in":["US","CA"]},"age":{"$gte":18}}',
      }),
    ).toBe(true);
  });

  it("returns true when saved groups are set", () => {
    expect(
      hasTargetingConfigured({
        savedGroups: [{ match: "all", ids: ["grp_1"] }],
      }),
    ).toBe(true);
  });

  it("returns true when prerequisites are set", () => {
    expect(
      hasTargetingConfigured({
        prerequisites: [{ id: "prereq_1", condition: '{"value":true}' }],
      }),
    ).toBe(true);
  });
});

describe("isConditionMoreRestrictive", () => {
  const check = (last: unknown, next: unknown) =>
    isConditionMoreRestrictive(
      typeof last === "string" ? last : JSON.stringify(last),
      typeof next === "string" ? next : JSON.stringify(next),
    );

  it("allows removing an ANDed clause", () => {
    expect(check({ country: "US", browser: "chrome" }, { country: "US" })).toBe(
      false,
    );
  });

  it("allows removing a clause from $and or from a field's operators", () => {
    expect(check({ $and: [{ a: 1 }, { b: 2 }] }, { a: 1 })).toBe(false);
    expect(check({ a: 1, b: 2 }, { $and: [{ b: 2 }] })).toBe(false);
    expect(check({ age: { $gte: 18, $lt: 65 } }, { age: { $lt: 65 } })).toBe(
      false,
    );
  });

  it("allows removing the whole condition", () => {
    expect(check({ country: "US" }, "{}")).toBe(false);
    expect(check({ country: "US" }, "")).toBe(false);
  });

  it("ignores formatting and key order", () => {
    expect(
      check(
        '{"country": "US", "age": {"$gte": 18}}',
        '{"age":{"$gte":18},"country":"US"}',
      ),
    ).toBe(false);
  });

  it("flags unwrapping a $not", () => {
    // The old substring test missed this: "country":"US" appears in the old text
    expect(check({ $not: { country: "US" } }, { country: "US" })).toBe(true);
  });

  it("flags dropping a branch of an $or", () => {
    expect(
      check({ $or: [{ country: "US" }, { plan: "pro" }] }, { country: "US" }),
    ).toBe(true);
  });

  it("flags adding or changing a clause", () => {
    expect(check({ country: "US" }, { country: "US", plan: "pro" })).toBe(true);
    expect(check({ country: "US" }, { country: "CA" })).toBe(true);
    expect(
      check({ country: { $in: ["US", "CA"] } }, { country: { $in: ["US"] } }),
    ).toBe(true);
    expect(check("{}", { country: "US" })).toBe(true);
  });

  it("treats conditions that don't parse as more restrictive", () => {
    expect(check({ country: "US" }, "{not json")).toBe(true);
    expect(check("{not json", { country: "US" })).toBe(true);
    expect(check({ country: "US" }, { $and: { country: "US" } })).toBe(true);
  });
});

describe("isConditionMoreRestrictive with widened clauses", () => {
  const schema: SDKAttributeSchema = [
    { property: "country", datatype: "string" },
    { property: "age", datatype: "number" },
    { property: "email", datatype: "secureString" },
  ];
  const check = (last: unknown, next: unknown, attributes = schema) =>
    isConditionMoreRestrictive(
      JSON.stringify(last),
      JSON.stringify(next),
      attributes,
    );

  it("allows adding values to $in or removing them from $nin", () => {
    expect(
      check({ plan: { $in: ["pro"] } }, { plan: { $in: ["pro", "a"] } }),
    ).toBe(false);
    expect(
      check({ plan: { $nin: ["a", "b"] } }, { plan: { $nin: ["a"] } }),
    ).toBe(false);
    expect(check({ plan: { $in: ["Pro"] } }, { plan: { $ini: ["pro"] } })).toBe(
      false,
    );
  });

  it("flags removing values from $in or adding them to $nin", () => {
    expect(
      check({ plan: { $in: ["pro", "a"] } }, { plan: { $in: ["pro"] } }),
    ).toBe(true);
    expect(
      check({ plan: { $nin: ["a"] } }, { plan: { $nin: ["a", "b"] } }),
    ).toBe(true);
  });

  it("allows loosening a numeric, string or version bound", () => {
    expect(check({ age: { $gte: 21 } }, { age: { $gte: 18 } })).toBe(false);
    expect(check({ age: { $gt: 18 } }, { age: { $gte: 18 } })).toBe(false);
    expect(check({ age: { $lt: 65 } }, { age: { $lte: 70 } })).toBe(false);
    expect(check({ name: { $gte: "m" } }, { name: { $gte: "c" } })).toBe(false);
    expect(check({ v: { $vgte: "1.10.0" } }, { v: { $vgte: "1.9.0" } })).toBe(
      false,
    );
    expect(check({ v: { $veq: "2.0.0" } }, { v: { $vgt: "2.0.0-beta" } })).toBe(
      false,
    );
  });

  it("flags tightening a bound, or bounds that compare differently", () => {
    expect(check({ age: { $gte: 18 } }, { age: { $gte: 21 } })).toBe(true);
    expect(check({ age: { $gte: 18 } }, { age: { $gt: 18 } })).toBe(true);
    // "9" < "10" as numbers but not as strings
    expect(check({ x: { $gte: "10" } }, { x: { $gte: "9" } })).toBe(true);
    expect(check({ x: { $gte: 10 } }, { x: { $gte: "9" } })).toBe(true);
  });

  it("doesn't split on an empty $or, which matches everyone", () => {
    expect(check({ $or: [] }, { country: "US" })).toBe(true);
  });

  it("allows adding a branch to an $or", () => {
    expect(
      check(
        { $or: [{ country: "US" }, { plan: "pro" }] },
        { $or: [{ country: "US" }, { plan: "pro" }, { beta: true }] },
      ),
    ).toBe(false);
    expect(
      check({ country: "US" }, { $or: [{ country: "US" }, { beta: true }] }),
    ).toBe(false);
  });

  it("allows widening every branch of an $or into one clause", () => {
    expect(
      check(
        { $or: [{ age: { $gte: 30 } }, { age: { $gte: 21 } }] },
        { age: { $gte: 18 } },
      ),
    ).toBe(false);
    expect(
      check(
        { $or: [{ age: { $gte: 30 } }, { plan: "pro" }] },
        { age: { $gte: 18 } },
      ),
    ).toBe(true);
  });

  it("widens a literal into $in only for a declared scalar attribute", () => {
    const widened = { country: { $in: ["US", "CA"] } };
    expect(check({ country: "US" }, widened)).toBe(false);
    // Without a datatype, {"country": "US"} also matches ["US"] nested in an
    // array, which $in doesn't
    expect(check({ country: "US" }, widened, [])).toBe(true);
    expect(check({ country: "US" }, { country: { $ne: "CA" } })).toBe(false);
    expect(check({ age: 21 }, { age: { $gte: 18 } })).toBe(false);
  });

  it('keeps the missing value that a literal 0 or "null" matches', () => {
    // A missing age is null, and null * 1 === 0
    expect(check({ age: 0 }, { age: { $in: [0] } })).toBe(true);
    expect(check({ age: 0 }, { age: { $in: [0, null] } })).toBe(false);
    expect(check({ country: "null" }, { country: { $in: ["null"] } })).toBe(
      true,
    );
  });

  it("only compares hashed attributes by equality", () => {
    expect(
      check(
        { email: { $in: ["a@x.io"] } },
        { email: { $in: ["a@x.io", "b"] } },
      ),
    ).toBe(false);
    expect(check({ email: { $gte: "m" } }, { email: { $gte: "c" } })).toBe(
      true,
    );
  });

  it("allows narrowing a field to values the new clause accepts", () => {
    expect(check({ plan: { $eq: "pro" } }, { plan: { $regex: "^p" } })).toBe(
      false,
    );
    expect(check({ plan: { $in: ["a"] } }, { plan: { $exists: true } })).toBe(
      false,
    );
    expect(check({ plan: { $nin: ["a"] } }, { plan: { $ne: "a" } })).toBe(
      false,
    );
  });

  it("flags moving pinned values into a saved group clause", () => {
    // The values may be in the group, which can't be checked here
    expect(
      check({ id: { $eq: "abc" } }, { id: { $notInGroup: "grp_1" } }),
    ).toBe(true);
    expect(
      check({ country: "US" }, { country: { $notInGroup: "grp_1" } }),
    ).toBe(true);
    expect(
      check(
        { country: { $in: ["US", "CA"] } },
        { country: { $notInGroup: "grp_1" } },
      ),
    ).toBe(true);
    expect(
      check({ id: { $eq: "abc" } }, { id: { $not: { $inGroup: "grp_1" } } }),
    ).toBe(true);
    expect(
      check(
        { tags: { $eq: "a" } },
        { tags: { $not: { $elemMatch: { $savedGroup: { id: "grp_1" } } } } },
      ),
    ).toBe(true);
  });
});

// Soundness: whenever a change counts as not more restrictive, no user that
// the old condition matches may fail the new one.
describe("isConditionMoreRestrictive soundness", () => {
  // Small deterministic PRNG so failures reproduce
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const subset = <T>(items: T[]): T[] => items.filter(() => random() < 0.3);

  const strings = ["US", "CA", "us", "0", "5", "10", "9", "null", "m", "c"];
  const numbers = [0, 1, 5, 9, 10, 18];
  const versions = ["1.9.0", "1.10.0", "2.0.0-beta", "2.0.0", "v2.0.0"];
  const constants = [...strings, ...numbers, null, true];

  const schema: SDKAttributeSchema = [
    { property: "s", datatype: "string" },
    { property: "n", datatype: "number" },
    { property: "h", datatype: "secureString" },
    { property: "a", datatype: "string[]" },
  ];
  // Values a user can have, per attribute. Typed attributes keep to their
  // datatype; the untyped one has coercion edge cases.
  const fieldValues: Record<string, unknown[]> = {
    u: [...constants, false, "", ["US"], [["US"]], [5], ["5", "CA"], [], {}],
    s: [...strings, ""],
    n: numbers,
    h: strings,
    a: [[], ["US"], ["US", "CA"], ["us"], ["5"]],
    v: [...versions, 2, ""],
  };
  const constantsFor = (field: string) =>
    field === "u" ? constants : field === "n" ? numbers : strings;

  const EQUALITY = [
    "literal",
    "$eq",
    "$ne",
    "$in",
    "$nin",
    "$ini",
    "$nini",
    "$exists",
    "$type",
    "$regex",
  ];
  const BOUNDS = ["$gt", "$gte", "$lt", "$lte"];
  const VERSIONS = ["$veq", "$vne", "$vgt", "$vgte", "$vlt", "$vlte"];

  // An operation from `family`, with constants drawn partly from `seeds` so
  // that it often relates to the operation it replaces
  const operation = (field: string, family: string[], seeds: unknown[]) => {
    const pool = field === "v" ? versions : constantsFor(field);
    const constant = () =>
      seeds.length && random() < 0.6 ? pick(seeds) : pick(pool);
    const op = pick(family);
    if (op === "literal") return constant();
    if (["$in", "$nin", "$ini", "$nini"].includes(op)) {
      return {
        [op]: [
          ...new Set([...seeds.filter(() => random() < 0.7), ...subset(pool)]),
        ],
      };
    }
    if (op === "$exists") return { $exists: pick([true, false]) };
    if (op === "$type") return { $type: pick(["string", "number", "null"]) };
    if (op === "$regex") return { $regex: pick(["^U", "S$", "5", "^$"]) };
    return { [op]: constant() };
  };

  const randomClause = (field: string) =>
    operation(
      field,
      pick([EQUALITY, BOUNDS, field === "v" ? VERSIONS : BOUNDS]),
      [],
    );

  const randomCondition = (depth = 0): Record<string, unknown> => {
    const condition: Record<string, unknown> = {};
    const count = 1 + Math.floor(random() * 2);
    for (let i = 0; i < count; i++) {
      if (depth < 1 && random() < 0.2) {
        condition.$or = [
          randomCondition(depth + 1),
          randomCondition(depth + 1),
        ];
      } else {
        const field = pick(Object.keys(fieldValues));
        condition[field] = randomClause(field);
      }
    }
    return condition;
  };

  // A nearby clause: same operator family, related constants
  const nearby = (field: string, value: unknown) => {
    const isOps = isOperators(value);
    const [op, arg] = isOps ? Object.entries(value)[0] : ["literal", value];
    const family = BOUNDS.includes(op)
      ? BOUNDS
      : VERSIONS.includes(op)
        ? VERSIONS
        : EQUALITY;
    return operation(field, family, Array.isArray(arg) ? arg : [arg]);
  };

  // New conditions are mostly small edits of the old one
  const mutate = (
    condition: Record<string, unknown>,
  ): Record<string, unknown> => {
    const next = { ...condition };
    const key = pick(Object.keys(next));
    const roll = random();
    if (key === "$or") {
      const branches = condition.$or as Record<string, unknown>[];
      if (roll < 0.4) next.$or = [...branches, randomCondition(1)];
      else if (roll < 0.8)
        next.$or = branches.map((b) => (random() < 0.5 ? mutate(b) : b));
      else delete next.$or;
    } else if (roll < 0.7) next[key] = nearby(key, next[key]);
    else if (roll < 0.8) next.$or = [{ [key]: next[key] }, randomCondition(1)];
    else if (roll < 0.9) delete next[key];
    else return randomCondition();
    return next;
  };

  const users = Array.from({ length: 1000 }, () => {
    const user: Record<string, unknown> = {};
    for (const [field, values] of Object.entries(fieldValues)) {
      // Leave each attribute missing sometimes
      if (random() < 0.85) user[field] = pick(values);
    }
    return [user, hashAttribute(user) as Record<string, unknown>] as const;
  });

  // Every pair of single-field clauses from a catalog, against every value
  it("never misses a dropped user between two clauses on one field", () => {
    let safe = 0;
    for (const [field, values] of Object.entries(fieldValues)) {
      const pool = field === "v" ? versions : constantsFor(field);
      const pairs = pool.slice(1).map((c, i) => [pool[i], c]);
      const lists = [[], ...pool.map((c) => [c]), ...pairs];
      const clauses: unknown[] = [
        ...pool.flatMap((c) => [c, { $eq: c }, { $ne: c }]),
        ...lists.flatMap((l) =>
          ["$in", "$nin", "$ini", "$nini"].map((op) => ({ [op]: l })),
        ),
        ...BOUNDS.flatMap((op) => pool.map((c) => ({ [op]: c }))),
        ...(field === "v" || field === "u"
          ? VERSIONS.flatMap((op) => versions.map((c) => ({ [op]: c })))
          : []),
        { $exists: true },
        { $exists: false },
        ...["string", "number", "null"].map((t) => ({ $type: t })),
        ...["^U", "S$", "5", "^$"].map((r) => ({ $regex: r })),
      ];
      const fieldUsers = [{}, ...values.map((v) => ({ [field]: v }))];
      for (const oldClause of clauses) {
        const last = { [field]: oldClause };
        const lastJson = JSON.stringify(last);
        const matched = fieldUsers.filter((u) => sdkEval(u, last));
        for (const newClause of clauses) {
          const next = { [field]: newClause };
          const nextJson = JSON.stringify(next);
          if (isConditionMoreRestrictive(lastJson, nextJson, schema)) continue;
          safe++;
          const user = matched.find((u) => !sdkEval(u, next));
          if (user) {
            throw new Error(
              `${lastJson} -> ${nextJson} drops ${JSON.stringify(user)}`,
            );
          }
        }
      }
    }
    expect(safe > 10000).toBe(true);
  });

  // Random multi-clause conditions, for $or, $and and clauses on several fields
  it("never misses a dropped user", () => {
    let safe = 0;
    for (let i = 0; i < 6000; i++) {
      const last = randomCondition();
      const next = mutate(last);
      const lastJson = JSON.stringify(last);
      const nextJson = JSON.stringify(next);
      if (isConditionMoreRestrictive(lastJson, nextJson, schema)) continue;
      safe++;
      const lastSdk = hashAttribute(last) as ConditionInterface;
      const nextSdk = hashAttribute(next) as ConditionInterface;
      for (const [user, userSdk] of users) {
        const dropped =
          evalCondition(userSdk, lastSdk) && !evalCondition(userSdk, nextSdk);
        if (dropped) {
          throw new Error(
            `${lastJson} -> ${nextJson} drops ${JSON.stringify(user)}`,
          );
        }
      }
    }
    // Enough safe verdicts that the check means something
    expect(safe > 500).toBe(true);
  });
});

// What the SDK sees: values of the secureString attribute "h" are hashed, in
// conditions and in users
function sdkEval(user: Record<string, unknown>, condition: unknown): boolean {
  return evalCondition(
    hashAttribute(user) as Record<string, unknown>,
    hashAttribute(condition) as ConditionInterface,
  );
}

function hashAttribute(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hashAttribute);
  if (!isOperators(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      k === "h" ? hashStrings(v) : hashAttribute(v),
    ]),
  );
}

function hashStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return createHash("sha256").update(value).digest("hex").slice(0, 8);
  }
  if (Array.isArray(value)) return value.map(hashStrings);
  if (!isOperators(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, hashStrings(v)]),
  );
}

function isOperators(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
