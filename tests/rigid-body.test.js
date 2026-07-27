import test from "node:test";
import assert from "node:assert/strict";
// The browser build uses Rapier's separate WASM file. The compatibility build
// is limited to Node tests because Node cannot resolve that browser-oriented
// package directly.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  EGG_HALF_HEIGHT,
  SHELL_MASS,
  createEggColliderPoints,
} from "../src/egg-shape.js";
import {
  YOLK_MASS,
  YOLK_VISUAL_RADIUS,
  spherePrincipalInertia,
} from "../src/yolk-model.js";

test("shifted yolk center of mass makes the egg tip and roll", async () => {
  await RAPIER.init({});
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.createCollider(
    RAPIER.ColliderDesc
      .cuboid(1, 0.025, 2)
      .setTranslation(0, -0.025, 1)
      .setFriction(0.66)
  );

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc
      .dynamic()
      .setTranslation(0, EGG_HALF_HEIGHT + 0.0015, 0)
      .setLinearDamping(0.08)
      .setAngularDamping(0.11)
  );
  const collider = RAPIER.ColliderDesc.convexHull(createEggColliderPoints());
  assert.ok(collider);
  collider.setMass(SHELL_MASS).setFriction(0.52);
  world.createCollider(collider, body);

  const inertia = spherePrincipalInertia(YOLK_MASS, YOLK_VISUAL_RADIUS);
  let maxAngularSpeed = 0;
  let maxForwardSpeed = 0;
  for (let step = 0; step < 360; step += 1) {
    body.setAdditionalMassProperties(
      YOLK_MASS,
      { x: 0, y: -0.003, z: 0.009 },
      { x: inertia, y: inertia, z: inertia },
      { x: 0, y: 0, z: 0, w: 1 },
      true
    );
    world.step();
    const angularVelocity = body.angvel();
    const linearVelocity = body.linvel();
    maxAngularSpeed = Math.max(
      maxAngularSpeed,
      Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z)
    );
    maxForwardSpeed = Math.max(maxForwardSpeed, linearVelocity.z);
  }

  const position = body.translation();
  const rotation = body.rotation();
  const centerOfMass = body.localCom();
  assert.ok(
    Math.abs(body.mass() - (SHELL_MASS + YOLK_MASS)) < 0.001,
    "shell and yolk mass should total about 60 g"
  );
  assert.ok(centerOfMass.z > 0.005, "yolk shift should move the combined center of mass");
  assert.ok(position.y > -0.01, "egg must remain above the floor");
  assert.ok(position.z > 0.02, "shifted COM should create forward travel");
  assert.ok(
    Math.abs(position.x) > 0.0001,
    "asymmetric contact shape should create measurable lateral drift"
  );
  assert.ok(maxForwardSpeed > 0.02, "egg should gain measurable forward speed");
  assert.ok(maxAngularSpeed > 0.5, "egg should gain measurable angular speed");
  assert.ok(
    Math.hypot(rotation.x, rotation.y, rotation.z) > 0.05,
    "egg should rotate away from its initial upright pose"
  );
});
