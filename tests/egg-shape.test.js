import test from "node:test";
import assert from "node:assert/strict";
import {
  EGG_HALF_HEIGHT,
  createEggColliderPoints,
  eggAsymmetryFactor,
  eggRadiusAt,
} from "../src/egg-shape.js";

test("egg profile closes at both poles", () => {
  assert.equal(eggRadiusAt(-1), 0);
  assert.equal(eggRadiusAt(1), 0);
});

test("egg has a broader lower half and a narrower upper half", () => {
  assert.ok(eggRadiusAt(-0.45) > eggRadiusAt(0.45));
});

test("egg has a small physical radial asymmetry", () => {
  assert.notEqual(
    eggAsymmetryFactor(0, 0),
    eggAsymmetryFactor(0, Math.PI)
  );
});

test("convex-hull samples use real egg dimensions and finite coordinates", () => {
  const points = createEggColliderPoints();
  assert.ok(points.length > 1500);
  assert.equal(points.length % 3, 0);
  assert.ok(Array.from(points).every(Number.isFinite));

  const ys = [];
  for (let index = 1; index < points.length; index += 3) ys.push(points[index]);
  assert.ok(Math.abs(Math.min(...ys) + EGG_HALF_HEIGHT) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - EGG_HALF_HEIGHT) < 1e-6);
});
