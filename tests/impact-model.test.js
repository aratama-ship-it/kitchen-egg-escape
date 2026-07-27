import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_GRACE_SECONDS,
  OBJECT_IMPACT_FORCE_THRESHOLD,
  OBJECT_IMPACT_SPEED_THRESHOLD,
  mulberry32,
  shouldShatter,
} from "../src/impact-model.js";

test("ordinary floor contact never shatters the egg", () => {
  assert.equal(shouldShatter({
    colliderKind: "floor",
    forceMagnitude: OBJECT_IMPACT_FORCE_THRESHOLD * 4,
    speed: OBJECT_IMPACT_SPEED_THRESHOLD * 4,
    playAge: IMPACT_GRACE_SECONDS + 1,
  }), false);
});

test("a meaningful object impact shatters after the start grace period", () => {
  assert.equal(shouldShatter({
    colliderKind: "counter-leg",
    forceMagnitude: OBJECT_IMPACT_FORCE_THRESHOLD + 0.2,
    speed: OBJECT_IMPACT_SPEED_THRESHOLD + 0.05,
    playAge: IMPACT_GRACE_SECONDS + 0.1,
  }), true);
});

test("gentle rubbing against an object does not shatter the egg", () => {
  assert.equal(shouldShatter({
    colliderKind: "wall",
    forceMagnitude: OBJECT_IMPACT_FORCE_THRESHOLD + 0.2,
    speed: OBJECT_IMPACT_SPEED_THRESHOLD * 0.4,
    playAge: IMPACT_GRACE_SECONDS + 1,
  }), false);
});

test("fragment random sequence is deterministic for repeatable effects", () => {
  const first = mulberry32(17);
  const second = mulberry32(17);
  assert.deepEqual(
    [first(), first(), first()],
    [second(), second(), second()]
  );
});
