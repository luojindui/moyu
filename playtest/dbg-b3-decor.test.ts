import { describe, it } from "vitest";
import { initialState, gain } from "../src/engine/state";
import { DECOR, buyDecor, decorEffects } from "../src/engine/decor";
import { serialize, restore, type SaveAdapter, SAVE_KEY } from "../src/engine/save";

describe("dbg", () => {
  it("decor product", () => {
    let s = gain(initialState(), 1e11);
    for (const d of DECOR) s = buyDecor(s, d.id)!;
    console.log("built decor:", JSON.stringify(s.decor), "len", s.decor.length, "eff", decorEffects(s).idleMult);
    const store = new Map<string, string>();
    const mem: SaveAdapter = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
    serialize(s, mem, Date.now());
    const raw = JSON.parse(store.get(SAVE_KEY)!);
    console.log("serialized decor:", JSON.stringify(raw.decor));
    const back = restore(mem, Date.now()).state!;
    console.log("restored decor:", JSON.stringify(back.decor), "len", back.decor.length, "eff", decorEffects(back).idleMult);
    console.log("breakdown:", JSON.stringify(back.decor.map((id) => [id, DECOR.find((d) => d.id === id)?.effects])));
  });
});
