import test from "node:test";
import assert from "node:assert/strict";
import {
  YOLK_MAX_OFFSET,
  advanceYolk,
  spherePrincipalInertia,
} from "../src/yolk-model.js";

test("yolk inertia matches a solid-sphere reduced model", () => {
  assert.ok(
    Math.abs(spherePrincipalInertia(0.04, 0.012) - 0.000002304) < 1e-15
  );
});

test("yolk spring moves toward target without leaving the shell", () => {
  let state = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const target = { x: 0, y: 0, z: YOLK_MAX_OFFSET };
  for (let step = 0; step < 240; step += 1) {
    state = advanceYolk(state, target, 1 / 120);
  }

  const length = Math.hypot(state.position.x, state.position.y, state.position.z);
  assert.ok(state.position.z > YOLK_MAX_OFFSET * 0.9);
  assert.ok(length <= YOLK_MAX_OFFSET + 1e-9);
});
