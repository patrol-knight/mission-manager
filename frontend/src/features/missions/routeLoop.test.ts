import { describe, it, expect } from "vitest";
import { withLoopClosure } from "./routeLoop";

describe("withLoopClosure", () => {
  it("appends the first item again for 2+ items", () => {
    expect(withLoopClosure([1, 2, 3])).toEqual([1, 2, 3, 1]);
    expect(withLoopClosure(["a", "b"])).toEqual(["a", "b", "a"]);
  });

  it("is a no-op below 2 items", () => {
    expect(withLoopClosure([1])).toEqual([1]);
    expect(withLoopClosure([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2];
    const result = withLoopClosure(input);
    expect(input).toEqual([1, 2]);
    expect(result).not.toBe(input);
  });
});
