import { describe, it, expect } from "vitest";
import { sortTowers, visibleTiles } from "./towers";
import type { Device } from "../../types/domain";

const tower = (id: string, connected = true) => ({ deviceId: id, name: null, connected }) as Device;

describe("sortTowers", () => {
  it("puts alerts first (most first), then offline, then the rest by name", () => {
    const towers = [tower("c"), tower("b", false), tower("a"), tower("d"), tower("e")];
    const sorted = sortTowers(towers, { d: 1, e: 3 }).map((t) => t.deviceId);
    expect(sorted).toEqual(["e", "d", "b", "a", "c"]);
  });
});

describe("visibleTiles", () => {
  it("shows everything that fits", () => {
    expect(visibleTiles(6, 8)).toEqual({ shown: 6, hidden: 0 });
    expect(visibleTiles(8, 8)).toEqual({ shown: 8, hidden: 0 });
  });

  it("gives up the last slot to a '+N more' tile when it doesn't", () => {
    expect(visibleTiles(13, 8)).toEqual({ shown: 7, hidden: 6 });
  });
});
