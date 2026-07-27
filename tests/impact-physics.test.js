import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { shouldShatter } from "../src/impact-model.js";

test("Rapier contact-force events classify a moving object impact as a break", async () => {
  await RAPIER.init({});
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / 120;
  const events = new RAPIER.EventQueue(true);

  world.createCollider(
    RAPIER.ColliderDesc
      .cuboid(0.02, 0.2, 0.2)
      .setTranslation(0.1, 0, 0)
  );
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0, 0)
      .setLinvel(0.6, 0, 0)
  );
  world.createCollider(
    RAPIER.ColliderDesc
      .ball(0.024)
      .setMass(0.06)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.08),
    body
  );

  let detected = false;
  let strongestForce = 0;
  for (let step = 0; step < 60; step += 1) {
    const velocity = body.linvel();
    const speedBeforeStep = Math.hypot(velocity.x, velocity.y, velocity.z);
    world.step(events);
    events.drainContactForceEvents((event) => {
      strongestForce = Math.max(
        strongestForce,
        event.totalForceMagnitude()
      );
      detected ||= shouldShatter({
        colliderKind: "wall",
        forceMagnitude: event.totalForceMagnitude(),
        speed: speedBeforeStep,
        playAge: 0.6,
      });
    });
  }

  assert.ok(strongestForce > 1.15, "wall impact should exceed the break threshold");
  assert.equal(detected, true);
  events.free();
  world.free();
});
