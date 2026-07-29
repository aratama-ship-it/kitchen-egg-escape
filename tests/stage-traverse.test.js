import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  EGG_HALF_HEIGHT,
  EGG_MAX_RADIUS,
  SHELL_MASS,
  createEggColliderPoints,
} from "../src/egg-shape.js";
import {
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  YOLK_MASS,
  YOLK_REST_OFFSET,
  YOLK_SPEED_CAP,
  YOLK_VISUAL_RADIUS,
  advanceYolk,
  rotateByInverse,
  spherePrincipalInertia,
  yolkTargetFor,
} from "../src/yolk-model.js";
import { shouldShatter } from "../src/impact-model.js";
import {
  EGG_CLEARANCE,
  STAGES,
  SURFACE_FRICTION,
  WORLD_GRAVITY,
  blockedSpansAt,
  draftForceAt,
  moverCollider,
  stageColliders,
  stageStartPosition,
  stageStartRotation,
  surfaceAt,
} from "../src/stages.js";


// 卵が止まるたびに、少し先を見ていちばん広い隙間へ狙いを定め、撞く。
// うまい人ではなく「素直に隙間を狙うだけの人」を模した基準。
function gapAiming(stage, { lookahead = 0.42 } = {}) {
  let committed = null;
  let lastShotZ = null;
  let stuck = 0;

  return (position, time) => {
    const aheadZ = Math.min(stage.length, position.z + lookahead);
    const spans = [];
    for (let step = 0; step <= 2; step += 1) {
      const z = Math.min(stage.length, position.z + (step / 2) * lookahead);
      // 撞いてから転がり終わるまでのあいだ、塞がれない隙間を選ぶ。
      for (let sample = 0; sample <= 5; sample += 1) {
        spans.push(...blockedSpansAt(stage, z, time + sample * 0.5));
      }
    }
    spans.sort((a, b) => a[0] - b[0]);

    let cursor = -stage.halfWidth;
    const gaps = [];
    const consider = (from, to) => {
      if (to - from > 0) gaps.push({ width: to - from, from, to });
    };
    for (const [start, end] of spans) {
      if (start > cursor) consider(cursor, start);
      cursor = Math.max(cursor, end);
    }
    consider(cursor, stage.halfWidth);
    gaps.sort((a, b) => b.width - a.width);

    const stillOpen = committed === null ? undefined : gaps.find(
      (gap) => committed >= gap.from && committed <= gap.to && gap.width >= EGG_CLEARANCE
    );
    const chosen = stillOpen ?? gaps[0];
    if (!chosen) return null;
    if (!stillOpen) committed = (chosen.from + chosen.to) / 2;

    // 進めていないときは、隙間の中央ではなく真横へ逃がす。
    if (lastShotZ !== null && position.z - lastShotZ < 0.05) stuck += 1;
    else stuck = 0;
    lastShotZ = position.z;

    const lateral = committed - position.x;
    if (stuck >= 2) {
      const away = Math.sign(lateral) || 1;
      return { x: away, z: 0.2, power: 0.9 };
    }

    const forward = Math.max(0.35, 1 - Math.abs(lateral) * 1.2);
    return { x: lateral * 2.2, z: forward, power: 0.85 };
  };
}

const FIXED_STEP = 1 / 120;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const YOLK_INERTIA = spherePrincipalInertia(YOLK_MASS, YOLK_VISUAL_RADIUS);

function colliderDesc(shape) {
  const desc = shape.shape === "cylinder"
    ? RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius)
    : RAPIER.ColliderDesc.cuboid(
      shape.halfExtents.x,
      shape.halfExtents.y,
      shape.halfExtents.z
    );
  return desc
    .setTranslation(shape.position.x, shape.position.y, shape.position.z)
    .setRotation(shape.rotation)
    .setFriction(shape.friction)
    .setRestitution(shape.restitution);
}

// ブラウザ側と同じ形・同じ制御則で、区画をひとつ組み立てて転がす。
function rollThroughStage(stage, {
  seconds = 12,
  aimAt = null,
  steer = null,
  startZ = null,
  withDraft = true,
} = {}) {
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  world.timestep = FIXED_STEP;
  const events = new RAPIER.EventQueue(true);
  const kinds = new Map();

  for (const shape of stageColliders(stage)) {
    const collider = world.createCollider(colliderDesc(shape));
    kinds.set(collider.handle, shape.kind);
  }

  const moverBodies = stage.movers.map((mover) => {
    const shape = moverCollider(stage, mover, 0);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc
        .kinematicPositionBased()
        .setTranslation(shape.position.x, shape.position.y, shape.position.z)
        .setRotation(shape.rotation)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc
        .cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
        .setFriction(shape.friction),
      body
    );
    kinds.set(collider.handle, mover.kind);
    return { mover, body };
  });

  const start = stageStartPosition(stage);
  if (startZ !== null) start.z = startZ;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setRotation(stageStartRotation(stage))
      .setLinearDamping(0.08)
      .setAngularDamping(0.11)
      .setCcdEnabled(true)
  );
  body.setAdditionalSolverIterations(8);

  const eggCollider = world.createCollider(
    RAPIER.ColliderDesc
      .convexHull(createEggColliderPoints())
      .setMass(SHELL_MASS)
      .setFriction(0.52)
      .setRestitution(0.035)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.08)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average),
    body
  );

  const yolk = {
    position: { x: 0, y: -YOLK_REST_OFFSET, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
  };
  const applyYolk = () => body.setAdditionalMassProperties(
    YOLK_MASS,
    yolk.position,
    { x: YOLK_INERTIA, y: YOLK_INERTIA, z: YOLK_INERTIA },
    IDENTITY_ROTATION,
    true
  );
  applyYolk();

  const steps = Math.round(seconds / FIXED_STEP);
  let playAge = 0;
  let lastShotAt = -1;
  let shots = 0;
  let furthestZ = start.z;
  let shattered = null;
  let fellOff = false;

  for (let index = 0; index < steps; index += 1) {
    playAge += FIXED_STEP;
    for (const entry of moverBodies) {
      const shape = moverCollider(stage, entry.mover, playAge);
      entry.body.setNextKinematicTranslation(shape.position);
    }

    const position = body.translation();

    // 卵が止まっていて、撞ける状態なら次の一撃を放つ。
    const velocity = body.linvel();
    const settled = Math.hypot(velocity.x, velocity.y, velocity.z) < 0.03;
    if (aimAt && settled && playAge - lastShotAt > 0.35) {
      const command = aimAt(position, playAge);
      if (command) {
        const length = Math.hypot(command.x, command.z);
        if (length > 1e-6) {
          const speed = SHOT_MIN_SPEED
            + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * command.power;
          yolk.velocity = rotateByInverse(body.rotation(), {
            x: (command.x / length) * speed,
            y: 0,
            z: (command.z / length) * speed,
          });
          lastShotAt = playAge;
          shots += 1;
        }
      }
    }

    const target = steer
      ? yolkTargetFor({
        rotation: body.rotation(),
        ...steer(position, playAge),
        strength: 0.82,
      })
      : yolkTargetFor({ rotation: body.rotation() });
    const next = advanceYolk(yolk, target, FIXED_STEP);
    yolk.position = next.position;
    yolk.velocity = next.velocity;
    const yolkSpeed = Math.hypot(
      yolk.velocity.x,
      yolk.velocity.y,
      yolk.velocity.z
    );
    if (yolkSpeed > YOLK_SPEED_CAP) {
      const scale = YOLK_SPEED_CAP / yolkSpeed;
      yolk.velocity.x *= scale;
      yolk.velocity.y *= scale;
      yolk.velocity.z *= scale;
    }
    applyYolk();

    // 黄身が内壁を蹴った分を殻へ渡し、滑りではなく転がりに変える。
    const kick = next.wallImpulse;
    if (kick.x || kick.y || kick.z) {
      const rotation = body.rotation();
      const worldKick = new THREE.Vector3(kick.x, kick.y, kick.z)
        .applyQuaternion(
          new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
        );
      body.applyImpulse(worldKick, true);
      const after = body.linvel();
      const horizontal = Math.hypot(after.x, after.z);
      if (horizontal > 1e-5) {
        // 滑る床では転がりに変わらず、そのまま滑る。
        const grip = Math.min(
          1,
          SURFACE_FRICTION[surfaceAt(stage, body.translation().z)]
            / SURFACE_FRICTION.dry
        );
        const spin = (horizontal / EGG_MAX_RADIUS) * grip;
        const angular = body.angvel();
        body.setAngvel({
          x: (after.z / horizontal) * spin,
          y: angular.y,
          z: (-after.x / horizontal) * spin,
        }, true);
      }
    }

    const draft = withDraft ? draftForceAt(stage, body.translation().z) : 0;
    if (draft) body.applyImpulse({ x: draft * FIXED_STEP, y: 0, z: 0 }, true);

    const before = body.linvel();
    const speed = Math.hypot(before.x, before.y, before.z);
    const fallSpeed = Math.max(0, -before.y);
    world.step(events);

    events.drainContactForceEvents((event) => {
      const first = event.collider1();
      const second = event.collider2();
      if (first !== eggCollider.handle && second !== eggCollider.handle) return;
      const other = first === eggCollider.handle ? second : first;
      const kind = kinds.get(other) ?? "unknown";
      if (shouldShatter({
        colliderKind: kind,
        forceMagnitude: event.totalForceMagnitude(),
        speed,
        playAge,
        fallSpeed,
      })) {
        shattered = shattered ?? { kind, at: body.translation().z };
      }
    });

    const now = body.translation();
    furthestZ = Math.max(furthestZ, now.z);
    if (now.y < -0.4 || Math.abs(now.x) > stage.halfWidth + 0.45) {
      fellOff = true;
      break;
    }
    if (shattered || now.z >= stage.length) break;
  }

  const finalPosition = body.translation();
  world.free();
  return {
    furthestZ,
    travelled: furthestZ - start.z,
    finalPosition,
    shattered,
    fellOff,
    shots,
    cleared: furthestZ >= stage.length,
  };
}

test("the shared inverse rotation matches three.js quaternion math", () => {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.4, -1.1, 0.7)
  );
  const vector = new THREE.Vector3(0.3, -1, 0.8);
  const expected = vector
    .clone()
    .applyQuaternion(quaternion.clone().invert());
  const actual = rotateByInverse(quaternion, vector);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  assert.ok(Math.abs(actual.z - expected.z) < 1e-9);
});

test("an untouched yolk settles at the low point of the shell", () => {
  const upright = yolkTargetFor({ rotation: IDENTITY_ROTATION });
  assert.ok(Math.abs(upright.x) < 1e-12);
  assert.ok(Math.abs(upright.y + YOLK_REST_OFFSET) < 1e-12);
});

test("every stage can be finished by a plainly-steered egg", async (t) => {
  await RAPIER.init({});
  for (const stage of STAGES) {
    const run = rollThroughStage(stage, { seconds: 150, aimAt: gapAiming(stage) });
    assert.equal(
      run.shattered,
      null,
      `${stage.id}: 素直に狙っても ${run.shattered?.kind} に当たって割れる`
    );
    assert.equal(run.fellOff, false, `${stage.id}: 床から落ちる`);
    assert.ok(
      run.cleared,
      `${stage.id}: ${run.shots}打かけても ${run.furthestZ.toFixed(2)} m / ${stage.length} m までしか進めない`
    );
  }
});

test("the egg starts on solid floor and does not sink or bounce away", async () => {
  await RAPIER.init({});
  for (const stage of STAGES) {
    const run = rollThroughStage(stage, {
      seconds: 1.2,
      steer: () => ({ x: 0, z: 0 }),
    });
    const restingHeight = run.finalPosition.y;
    assert.ok(
      restingHeight > -0.2 && restingHeight < EGG_HALF_HEIGHT + 0.02,
      `${stage.id}: 静止高さ ${restingHeight.toFixed(4)} m は床の上ではない`
    );
    assert.equal(run.shattered, null, `${stage.id}: 置いただけで割れた`);
  }
});

test("the extractor draft pulls the egg toward the burners", async () => {
  await RAPIER.init({});
  const range = STAGES.find((stage) => stage.id === "the-range");
  // 同じ区画・同じ撞き方で、風のあり／なしだけを変えて比べる。
  const forward = () => ({ x: 0, z: 1, power: 0.85 });
  const withoutDraft = rollThroughStage(range, {
    seconds: 20,
    aimAt: forward,
    withDraft: false,
  });
  const withDraft = rollThroughStage(range, { seconds: 20, aimAt: forward });
  assert.ok(
    withDraft.finalPosition.x < withoutDraft.finalPosition.x - 0.04,
    `風で流れず、横ずれは ${withDraft.finalPosition.x.toFixed(3)} m（風を切ると ${withoutDraft.finalPosition.x.toFixed(3)} m）だった`
  );
});

// 濡れた床の手ざわりは「撞いても転がらず、まっすぐ滑ること」。
// 乾いた床では殻の非対称で弧を描くが、滑る床ではそれが起きない。
test("a shot on the wet floor slides straight instead of curving", async () => {
  await RAPIER.init({});
  const wash = STAGES.find((stage) => stage.id === "wash-station");
  assert.equal(surfaceAt(wash, 2), "wet");
  assert.equal(surfaceAt(STAGES[0], 3.4), "dry");

  // 同じ一撃を同じ床の種類の上で放ち、転がり切った距離を比べる。
  const coastOn = (stage, startZ) => {
    let fired = false;
    const run = rollThroughStage(stage, {
      seconds: 10,
      startZ,
      aimAt: () => {
        if (fired) return null;
        fired = true;
        return { x: 0, z: 1, power: 1 };
      },
    });
    return {
      forward: run.furthestZ - startZ,
      lateral: Math.abs(run.finalPosition.x),
    };
  };

  const wet = coastOn(wash, 2);
  const dry = coastOn(STAGES[0], 3.4);
  assert.ok(wet.forward > 0.1, `濡れ床で ${wet.forward.toFixed(3)} m しか進まない`);
  assert.ok(
    wet.lateral < dry.lateral * 0.6,
    `濡れ床の横ずれ ${wet.lateral.toFixed(3)} m が、乾いた床 ${dry.lateral.toFixed(3)} m と変わらない`
  );
});
