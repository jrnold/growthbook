/// <reference types="jest" />

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
