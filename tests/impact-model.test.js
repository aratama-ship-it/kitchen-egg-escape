import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_GRACE_SECONDS,
  LANDING_BREAK_SPEED,
  OBJECT_IMPACT_FORCE_THRESHOLD,
  OBJECT_IMPACT_SPEED_THRESHOLD,
  mulberry32,
  shouldShatter,
} from "../src/impact-model.js";

test("rolling along the floor never shatters the egg", () => {
  // 転がっているあいだ、床とはずっと接触している。落下していなければ割れない。
  assert.equal(shouldShatter({
    colliderKind: "floor",
    forceMagnitude: OBJECT_IMPACT_FORCE_THRESHOLD * 4,
    speed: OBJECT_IMPACT_SPEED_THRESHOLD * 4,
    playAge: IMPACT_GRACE_SECONDS + 1,
    fallSpeed: 0.29,
  }), false);
});

// 連打で跳ね続けて無理やり直進する打ち方を止めるための規則。
// 実測では通常の転がりで0.29 m/s、速い連打でも0.67 m/s どまり。
test("landing hard on the floor shatters the egg", () => {
  assert.equal(shouldShatter({
    colliderKind: "floor",
    forceMagnitude: 0,
    speed: 0,
    playAge: IMPACT_GRACE_SECONDS + 1,
    fallSpeed: LANDING_BREAK_SPEED + 0.2,
  }), true);
});

test("the landing limit leaves room for fast but honest shot chaining", () => {
  assert.ok(LANDING_BREAK_SPEED > 0.67 * 1.3, "速い連打の実測値に近すぎる");
  assert.equal(shouldShatter({
    colliderKind: "floor",
    forceMagnitude: 0,
    speed: 0,
    playAge: IMPACT_GRACE_SECONDS + 1,
    fallSpeed: 0.67,
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
