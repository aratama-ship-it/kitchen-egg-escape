import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  EGG_HALF_HEIGHT,
  SHELL_MASS,
  createEggColliderPoints,
} from "../src/egg-shape.js";
import {
  YOLK_MASS,
  YOLK_REST_OFFSET,
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
  blockedSpansAt,
  draftForceAt,
  moverCollider,
  stageColliders,
  stageStartPosition,
  stageStartRotation,
  surfaceAt,
} from "../src/stages.js";

// おおよその巡航速度。先読み地点へ到達する時刻の見積もりに使う。
// 黄身のばねを強めた分だけ速くなっているので、実測に合わせてある。
const CRUISE_SPEED = 0.155;

// 少し先を見て、いちばん広い隙間の中央へ寄りながら進む操作モデル。
// うまい人の再現ではなく「素直に狙えば通れる道があるか」を測るための基準。
function gapSeeking(stage, { lookahead = 0.55, gain = 3.4 } = {}) {
  let checkedAt = 0;
  let checkedZ = null;
  let unstickUntil = 0;
  let committed = null;
  // 殻の非対称でいつも同じ側へ流れるため、比例だけだと狙いが片側へずれたまま
  // 釣り合ってしまう。人が「まだ寄っている」と足していくぶんを積分で表す。
  let bias = 0;

  return (position, time) => {
    // 角に噛んで止まったときだけ、指を左右に振って外しにかかる。
    // 判定は一定時間ごとの前進量で行う。1ステップの移動量は巡航中でも
    // 1 mm ほどしかなく、そこを基準にすると常に「止まっている」ことになる。
    if (checkedZ === null) { checkedZ = position.z; checkedAt = time; }
    if (time - checkedAt >= 0.6) {
      if (position.z - checkedZ < 0.02) unstickUntil = time + 1.6;
      checkedZ = position.z;
      checkedAt = time;
    }
    const unstick = time < unstickUntil ? Math.sin(time * 2.2) : 0;

    const aheadZ = Math.min(stage.length, position.z + lookahead);
    const arrival = time + lookahead / CRUISE_SPEED;
    // 到着した瞬間だけでなく、渡り終えるまでのあいだ塞がれない隙間を選ぶ。
    const crossing = 3.5;
    const spans = [];
    for (let step = 0; step <= 2; step += 1) {
      // いま自分がいる帯も見る。通り抜けている最中に横から来る物を見落とさない。
      const z = Math.min(stage.length, position.z + (step / 2) * lookahead);
      for (let sample = 0; sample <= 6; sample += 1) {
        spans.push(...blockedSpansAt(stage, z, arrival + (sample / 6) * crossing));
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

    // 一度どちら側を通ると決めたら、そこが塞がるまで乗り換えない。
    // 毎回いちばん広い隙間へ乗り換えると、左右に迷って前へ進めなくなる。
    const stillOpen = committed === null ? undefined : gaps.find(
      (gap) => committed >= gap.from && committed <= gap.to && gap.width >= EGG_CLEARANCE
    );
    const chosen = stillOpen ?? gaps[0];
    if (!chosen) return { x: 0, z: 0 };
    if (!stillOpen) committed = (chosen.from + chosen.to) / 2;
    const best = { width: chosen.width, center: committed };

    const error = best.center - position.x;
    bias = Math.max(-0.5, Math.min(0.5, bias * 0.998 + error * 0.012));
    const lateral = Math.max(
      -1,
      Math.min(1, error * gain + bias + unstick)
    );
    // 通れる隙間がないあいだは前へ出ず、カートが通り過ぎるのを待つ。
    let forward = best.width < EGG_CLEARANCE ? 0 : 1;
    if (unstick) forward = Math.cos(time * 2.2) * 0.5 + 0.5;
    const magnitude = Math.hypot(lateral, forward) || 1;
    return { x: lateral / magnitude, z: forward / magnitude };
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
function rollThroughStage(stage, { seconds = 12, steer = () => ({ x: 0, z: 1 }) } = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
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
    const command = steer(position, playAge);
    const next = advanceYolk(
      yolk,
      yolkTargetFor({
        rotation: body.rotation(),
        commandX: command.x,
        commandZ: command.z,
        strength: 0.82,
      }),
      FIXED_STEP
    );
    yolk.position = next.position;
    yolk.velocity = next.velocity;
    applyYolk();

    const draft = draftForceAt(stage, body.translation().z);
    if (draft) body.applyImpulse({ x: draft * FIXED_STEP, y: 0, z: 0 }, true);

    const before = body.linvel();
    const speed = Math.hypot(before.x, before.y, before.z);
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
    const run = rollThroughStage(stage, { seconds: 90, steer: gapSeeking(stage) });
    assert.equal(
      run.shattered,
      null,
      `${stage.id}: 素直に狙っても ${run.shattered?.kind} に当たって割れる`
    );
    assert.equal(run.fellOff, false, `${stage.id}: 床から落ちる`);
    assert.ok(
      run.cleared,
      `${stage.id}: 90秒でも ${run.furthestZ.toFixed(2)} m / ${stage.length} m までしか進めない`
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
  const forward = () => ({ x: 0, z: 1 });
  const still = rollThroughStage(STAGES[0], { seconds: 9, steer: forward });
  const drawn = rollThroughStage(range, { seconds: 9, steer: forward });
  assert.ok(
    drawn.finalPosition.x < still.finalPosition.x - 0.05,
    `風で流れず、横ずれは ${drawn.finalPosition.x.toFixed(3)} m（風のない区画は ${still.finalPosition.x.toFixed(3)} m）だった`
  );
});

// 濡れた床の手ざわりは「止まれないこと」。入力を切ってからの惰走で測る。
test("letting go on the wet floor coasts further than on a dry floor", async () => {
  await RAPIER.init({});
  const wash = STAGES.find((stage) => stage.id === "wash-station");
  assert.equal(surfaceAt(wash, 2.4), "wet");
  assert.equal(surfaceAt(STAGES[0], 2.4), "dry");

  const coastFrom = (stage, releaseAt) => {
    let releaseZ = null;
    const run = rollThroughStage(stage, {
      seconds: releaseAt + 6,
      steer: (position, time) => {
        if (time < releaseAt) return { x: 0, z: 1 };
        if (releaseZ === null) releaseZ = position.z;
        return { x: 0, z: 0 };
      },
    });
    return run.furthestZ - (releaseZ ?? run.furthestZ);
  };

  const wetCoast = coastFrom(wash, 22);
  const dryCoast = coastFrom(STAGES[0], 22);
  assert.ok(
    wetCoast > dryCoast,
    `濡れ床の惰走 ${wetCoast.toFixed(3)} m が乾いた床 ${dryCoast.toFixed(3)} m を超えない`
  );
});
