import { describe, expect, it } from "vitest";
import { ORDER_KEY_START, isOrderKey, orderKeyBetween, orderKeysAfter } from "./order.js";

describe("orderKeyBetween", () => {
  it("starts an empty group mid-range, so prepending is as cheap as appending", () => {
    const first = orderKeyBetween(null, null);
    expect(first).toBe(ORDER_KEY_START);
    expect(orderKeyBetween(null, first) < first).toBe(true);
    expect(orderKeyBetween(first, null) > first).toBe(true);
  });

  it("keeps appends and prepends at six characters", () => {
    let last = orderKeyBetween(null, null);
    for (let i = 0; i < 500; i++) last = orderKeyBetween(last, null);
    expect(last).toHaveLength(6);

    let first = orderKeyBetween(null, null);
    for (let i = 0; i < 500; i++) first = orderKeyBetween(null, first);
    expect(first).toHaveLength(6);
  });

  it("produces a key strictly between two neighbours", () => {
    const a = orderKeyBetween(null, null);
    const b = orderKeyBetween(a, null);
    const mid = orderKeyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it("survives repeatedly inserting into the same gap", () => {
    const low = orderKeyBetween(null, null);
    const high = orderKeyBetween(low, null);
    let previous = low;
    for (let i = 0; i < 200; i++) {
      const next = orderKeyBetween(previous, high);
      expect(previous < next).toBe(true);
      expect(next < high).toBe(true);
      previous = next;
    }
    // One character per split, not one per insert.
    expect(previous.length).toBeLessThan(50);
  });

  it("never emits a key that ends in the zero digit", () => {
    // Two spellings of one position would break the between-ness invariant.
    let a = orderKeyBetween(null, null);
    const b = orderKeyBetween(a, null);
    for (let i = 0; i < 100; i++) {
      a = orderKeyBetween(a, b);
      expect(a.endsWith("0")).toBe(false);
      expect(isOrderKey(a)).toBe(true);
    }
  });

  it("refuses neighbours that are not in order", () => {
    const a = orderKeyBetween(null, null);
    const b = orderKeyBetween(a, null);
    expect(() => orderKeyBetween(b, a)).toThrow(RangeError);
    expect(() => orderKeyBetween(a, a)).toThrow(RangeError);
  });

  it("refuses input that is not an order key", () => {
    expect(() => orderKeyBetween("nope", null)).toThrow(TypeError);
    expect(() => orderKeyBetween("V00000.", null)).toThrow(TypeError);
    expect(() => orderKeyBetween("V00000.10", null)).toThrow(TypeError);
  });

  it("orders a randomly shuffled sequence of inserts", () => {
    // The property that matters: whatever order rows are inserted in, sorting
    // by key reproduces the intended sequence.
    const list = [orderKeyBetween(null, null)];
    const seed = [7, 3, 11, 1, 5, 2, 13, 0, 9, 4];
    for (let round = 0; round < 20; round++) {
      const at = seed[round % seed.length] % (list.length + 1);
      const before = at === 0 ? null : list[at - 1];
      const after = at === list.length ? null : list[at];
      const key = orderKeyBetween(before, after);
      list.splice(at, 0, key);
    }
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("orderKeysAfter", () => {
  it("hands out a batch in order without growing the keys", () => {
    const keys = orderKeysAfter(null, 1000);
    expect(keys).toHaveLength(1000);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every((key) => key.length === 6)).toBe(true);
  });

  it("continues from an existing key", () => {
    const first = orderKeyBetween(null, null);
    const keys = orderKeysAfter(first, 3);
    expect(keys[0] > first).toBe(true);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("isOrderKey", () => {
  it("accepts an integer key and an integer+fraction key", () => {
    expect(isOrderKey("V00000")).toBe(true);
    expect(isOrderKey("V00000.V")).toBe(true);
    expect(isOrderKey("V00000.zzV")).toBe(true);
  });

  it("rejects the shapes a caller could otherwise store", () => {
    expect(isOrderKey("")).toBe(false);
    expect(isOrderKey("V0000")).toBe(false);
    expect(isOrderKey("V000000")).toBe(false);
    expect(isOrderKey("V00000.")).toBe(false);
    expect(isOrderKey("V00000.0")).toBe(false);
    expect(isOrderKey("V00000.V0")).toBe(false);
    expect(isOrderKey("V00000-V")).toBe(false);
  });
});
