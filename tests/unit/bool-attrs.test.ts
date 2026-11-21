import { describe, expect, it } from "vitest";
import { on } from "../../app/components/bool-attrs";

describe("on()", () => {
  it("keeps only truthy boolean attributes so false never renders as disabled=\"false\"", () => {
    expect(on({ disabled: false, required: undefined, checked: true })).toEqual({ checked: true });
    expect(on({ disabled: false })).toEqual({});
  });
});
