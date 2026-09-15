import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function neutralLightness(section, token) {
  const value = section.match(new RegExp(`--${token}: oklch\\((0?\\.\\d+|1) 0 0\\)`))?.[1];
  assert.ok(value, `${token} must use a neutral oklch color`);
  return Number(value);
}

function contrast(first, second) {
  const brighter = Math.max(first ** 3, second ** 3);
  const darker = Math.min(first ** 3, second ** 3);
  return (brighter + 0.05) / (darker + 0.05);
}

test("muted text meets WCAG AA contrast on light and dark surfaces", () => {
  const light = css.split(":root {")[1].split("\n}")[0];
  const dark = css.split(".dark {")[1].split("\n}")[0];
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    const text = neutralLightness(palette, "muted-foreground");
    for (const surface of ["background", "card", "muted"]) {
      const ratio = contrast(text, neutralLightness(palette, surface));
      assert.ok(ratio >= 4.5, `${name} muted text on ${surface} has only ${ratio.toFixed(2)}:1 contrast`);
    }
  }
});

test("input borders remain visible on cards in both themes", () => {
  const light = css.split(":root {")[1].split("\n}")[0];
  const dark = css.split(".dark {")[1].split("\n}")[0];
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    const ratio = contrast(neutralLightness(palette, "input"), neutralLightness(palette, "card"));
    assert.ok(ratio >= 3, `${name} input border has only ${ratio.toFixed(2)}:1 contrast`);
  }
});
