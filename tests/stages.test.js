import test from "node:test";
import assert from "node:assert/strict";
import {
  EGG_CLEARANCE,
  EGG_WIDTH,
  STAGES,
  bestGapAt,
  blockedSpansAt,
  draftForceAt,
  floorSpans,
  moverCenterX,
  stageStartPosition,
  surfaceAt,
  toWorld,
  stageStartRotation,
  validateStage,
  widestGapAt,
} from "../src/stages.js";
import { EGG_TYPES, eggProfile } from "../src/egg-types.js";
import { rotateByInverse } from "../src/yolk-model.js";

test("every stage is internally consistent and can be completed", () => {
  for (const stage of STAGES) {
    assert.deepEqual(validateStage(stage), [], `${stage.id} に設計上の問題がある`);
  }
});

test("each stage names an egg, and they shrink as the course goes on", () => {
  const known = new Set(EGG_TYPES.map((type) => type.id));
  const scales = STAGES.map((stage) => {
    assert.ok(known.has(stage.egg), `${stage.id}: 知らない卵 ${stage.egg}`);
    return eggProfile(stage.egg).scale;
  });
  for (let index = 1; index < scales.length; index += 1) {
    assert.ok(
      scales[index] < scales[index - 1],
      `${STAGES[index].id}: 前の区画より卵が小さくなっていない`
    );
  }
});

test("a bigger egg needs a wider gap than a smaller one", () => {
  assert.ok(eggProfile("ostrich").clearance > eggProfile("quail").clearance * 2);
});

test("stage ids and names are unique", () => {
  assert.equal(new Set(STAGES.map((stage) => stage.id)).size, STAGES.length);
  assert.equal(new Set(STAGES.map((stage) => stage.name)).size, STAGES.length);
});

test("required clearance is wider than the egg itself", () => {
  assert.ok(EGG_CLEARANCE > EGG_WIDTH);
});

test("floor sections tile the stage without gaps or overlaps", () => {
  for (const stage of STAGES) {
    const spans = floorSpans(stage);
    assert.equal(spans[0].fromZ, 0);
    spans.forEach((section, index) => {
      if (index > 0) assert.equal(section.fromZ, spans[index - 1].toZ);
      assert.ok(section.friction > 0);
    });
    assert.equal(spans[spans.length - 1].toZ, stage.length);
  }
});

test("the wash station really is slippery in its middle section", () => {
  const wash = STAGES.find((stage) => stage.id === "wash-station");
  assert.equal(surfaceAt(wash, 0.5), "dry");
  assert.equal(surfaceAt(wash, 2.4), "wet");
  assert.equal(surfaceAt(wash, 4.2), "dry");
});

test("the back door slit is tight but passable", () => {
  const door = STAGES.find((stage) => stage.id === "back-door");
  const doorZ = door.props.find((prop) => prop.kind === "door-frame").z;
  const gap = widestGapAt(door, doorZ);
  assert.ok(gap >= EGG_CLEARANCE, `隙間 ${gap} が狭すぎる`);
  assert.ok(gap < 0.45, `隙間 ${gap} では最終ステージとして易しすぎる`);
});

test("a service-aisle cart blocks one side at a time, never the whole aisle", () => {
  const aisle = STAGES.find((stage) => stage.id === "service-aisle");
  const cart = aisle.movers[0];
  const atRest = widestGapAt(aisle, cart.z, 0);
  const shifted = widestGapAt(aisle, cart.z, cart.period / 4);
  assert.ok(bestGapAt(aisle, cart.z) >= EGG_CLEARANCE);
  assert.notEqual(atRest.toFixed(3), shifted.toFixed(3));
});

test("carts start parked to one side and sweep symmetrically", () => {
  const aisle = STAGES.find((stage) => stage.id === "service-aisle");
  for (const cart of aisle.movers) {
    // 開始時に通路の真ん中を塞いでいると、最初の一画面で道が見えない。
    assert.ok(
      Math.abs(moverCenterX(cart, 0)) > cart.travel * 0.9,
      `${cart.id}: 開始時に通路の中央にいる`
    );
    const samples = Array.from(
      { length: 24 },
      (unused, index) => moverCenterX(cart, (index / 24) * cart.period)
    );
    assert.ok(Math.max(...samples) > cart.travel * 0.99);
    assert.ok(Math.min(...samples) < -cart.travel * 0.99);
  }

  // 壁ぎわには、カートが最も寄ってきても残る待避場所がある。
  const [cart] = aisle.movers;
  const shelter = aisle.halfWidth - (cart.travel + cart.width / 2);
  assert.ok(shelter > 0.2, `待避できる幅が ${shelter.toFixed(3)} m しかない`);
});

test("low props such as the drain cover do not count as a blockage", () => {
  const wash = STAGES.find((stage) => stage.id === "wash-station");
  const drain = wash.props.find((prop) => prop.kind === "drain");
  assert.equal(blockedSpansAt(wash, drain.z).length, 0);
});

test("the range floor slopes down toward the hot side it threatens you with", () => {
  const range = STAGES.find((stage) => stage.id === "the-range");
  const rightEdge = toWorld(range, range.halfWidth, 0, 0);
  const leftEdge = toWorld(range, -range.halfWidth, 0, 0);
  assert.ok(leftEdge.y < -0.05, "-x側が低くなっていない");
  assert.ok(rightEdge.y > 0.05, "+x側が高くなっていない");

  // 床の傾き、換気扇の風、火口の脚がすべて同じ側を向いていること。
  const hotLegs = range.props.filter((prop) => prop.kind === "range-leg");
  assert.ok(hotLegs.length > 0);
  for (const leg of hotLegs) {
    assert.ok(leg.x < 0, "熱い脚が坂の低い側にない");
  }
  assert.ok(range.draft.force < 0, "風が火口と反対側へ吹いている");
  assert.ok(
    draftForceAt(range, (range.draft.fromZ + range.draft.toZ) / 2) < 0,
    "風の帯の中で力がかからない"
  );
  assert.equal(draftForceAt(range, 0.2), 0, "風の帯の外でも力がかかっている");
  assert.equal(draftForceAt(STAGES[0], 2), 0, "風のない区画で力がかかっている");
});

test("each stage starts the egg lying on its side on its own floor", () => {
  for (const stage of STAGES) {
    const start = stageStartPosition(stage);
    const local = toWorld({ bank: -(stage.bank ?? 0) }, start.x, start.y, start.z);
    assert.ok(Math.abs(local.y - (eggProfile(stage.egg).maxRadius + 0.001)) < 1e-9);
    assert.ok(start.z > 0 && start.z < stage.length);

    // 横倒し：殻の長軸が進行方向と直交していないと転がり出せない。
    const rotation = stageStartRotation(stage);
    const longAxis = rotateByInverse(
      { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w },
      { x: 0, y: 1, z: 0 }
    );
    assert.ok(Math.abs(longAxis.z) < 0.05, `${stage.id}: 長軸が進行方向を向いている`);
    assert.ok(Math.abs(longAxis.x) > 0.9, `${stage.id}: 卵が横倒しになっていない`);
  }
});
