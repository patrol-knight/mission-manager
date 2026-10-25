import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarkerList } from "./mapMarkers";

const { FakeMarker } = vi.hoisted(() => {
  class FakeMarker {
    static instances: FakeMarker[] = [];
    element: HTMLElement;
    lngLat: [number, number] | null = null;
    removed = false;

    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
      FakeMarker.instances.push(this);
    }
    addTo() {
      return this;
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    getElement() {
      return this.element;
    }
    remove() {
      this.removed = true;
      return this;
    }
  }
  return { FakeMarker };
});

vi.mock("maplibre-gl", () => ({
  Marker: FakeMarker,
}));

interface Item {
  id: string;
  x: number;
}

describe("useMarkerList", () => {
  beforeEach(() => {
    FakeMarker.instances = [];
  });

  const fakeMap = {} as never;

  it("creates a marker per item at its projected position", async () => {
    const items: Item[] = [{ id: "a", x: 1 }, { id: "b", x: 2 }];
    renderHook(() =>
      useMarkerList(fakeMap, items, {
        keyOf: (i) => i.id,
        project: async (i) => ({ lng: i.x, lat: i.x * 10 }),
        buildElement: () => document.createElement("div"),
      }),
    );

    await vi.waitFor(() => expect(FakeMarker.instances).toHaveLength(2));
    expect(FakeMarker.instances[0].lngLat).toEqual([1, 10]);
    expect(FakeMarker.instances[1].lngLat).toEqual([2, 20]);
  });

  it("removes markers for items no longer present", async () => {
    const { rerender } = renderHook(
      ({ items }: { items: Item[] }) =>
        useMarkerList(fakeMap, items, {
          keyOf: (i) => i.id,
          project: async (i) => ({ lng: i.x, lat: 0 }),
          buildElement: () => document.createElement("div"),
        }),
      { initialProps: { items: [{ id: "a", x: 1 }, { id: "b", x: 2 }] } },
    );

    await vi.waitFor(() => expect(FakeMarker.instances).toHaveLength(2));
    const [markerA] = FakeMarker.instances;

    rerender({ items: [{ id: "a", x: 1 }] });

    // marker "a" persists (still present), marker "b" gets removed once the
    // re-projection for the new item list resolves.
    await vi.waitFor(() => expect(FakeMarker.instances.some((m) => m.removed)).toBe(true));
    expect(markerA.removed).toBe(false);
  });

  it("skips items whose projection resolves to null", async () => {
    const items: Item[] = [{ id: "a", x: 1 }, { id: "b", x: 2 }];
    renderHook(() =>
      useMarkerList(fakeMap, items, {
        keyOf: (i) => i.id,
        project: async (i) => (i.id === "b" ? null : { lng: i.x, lat: 0 }),
        buildElement: () => document.createElement("div"),
      }),
    );

    await vi.waitFor(() => expect(FakeMarker.instances).toHaveLength(1));
  });
});
