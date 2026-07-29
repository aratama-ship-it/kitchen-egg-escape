import { EGG_MAX_RADIUS } from "./egg-shape.js";
import { eggProfile } from "./egg-types.js";

// 卵の最大幅は47 mm。重心移動だけで操作するため直進誤差が大きく、
// 通り抜けを要求する隙間は実寸の倍以上を最低値とする。
export const EGG_WIDTH = EGG_MAX_RADIUS * 2;
export const EGG_CLEARANCE = 0.1;

// この高さ以下の段差は転がったまま乗り上げられるため、通路を塞ぐ扱いにしない。
export const PASSABLE_HEIGHT = 0.02;

export const DEFAULT_HALF_WIDTH = 1.15;

// 実物大の卵は、転がると毎秒3回以上まわってしまい、一回転ずつ見えない。
// 形はそのままに重力を1/3にすると、3倍の大きさの世界と同じ運動になる
// （見え方は変わらず、動きだけ大きなものらしくゆっくりになる）。
export const WORLD_SCALE = 3;
export const WORLD_GRAVITY = 9.81 / WORLD_SCALE;

// 猫はときどき現れて、卵を不規則な向きへ弾く。理不尽だが、逃げ場はある。
// shelter（隙間）の中にいるあいだは前足が届かない。
export const CAT_WARNING_SECONDS = 1.1;

export function shelterAt(stage, x, z) {
  for (const shelter of stage.shelters ?? []) {
    if (
      z >= shelter.fromZ && z <= shelter.toZ
      && x >= shelter.fromX && x <= shelter.toX
    ) return shelter;
  }
  return null;
}

export function isSheltered(stage, x, z) {
  return shelterAt(stage, x, z) !== null;
}

// 猫が次に手を出す時刻。区画ごとに間隔を決め、そこから決まった順で来る。
export function catStrikeTimes(stage, until) {
  const cat = stage.cat;
  if (!cat) return [];
  const times = [];
  for (let t = cat.firstAt; t <= until; t += cat.every) times.push(t);
  return times;
}

export const SURFACE_FRICTION = {
  dry: 0.66,
  wet: 0.13,
  grease: 0.3,
};

const counterLegs = (positions, halfWidth = DEFAULT_HALF_WIDTH) =>
  positions.flatMap((z) => [-1, 1].map((side) => ({
    shape: "cylinder",
    kind: "counter-leg",
    look: "darkMetal",
    x: side * (halfWidth - 0.11),
    z,
    radius: 0.035,
    height: 0.82,
  })));

export const STAGES = [
  {
    id: "prep-counter",
    egg: "ostrich",
    name: "仕込み台の下",
    subtitle: "PREP COUNTER",
    brief: "前へ振り出すと、中の黄身が殻を蹴る。まず、まっすぐ転がしてみる。",
    length: 4,
    halfWidth: DEFAULT_HALF_WIDTH,
    bank: 0,
    atmosphere: { fog: 0x63706b, key: 0xfff2d0, ambient: 0xdde4dd },
    floor: [{ toZ: 4, surface: "dry" }],
    props: [
      ...counterLegs([1.1, 3]),
      {
        shape: "cylinder",
        kind: "pot",
        look: "steel",
        x: 0.52,
        z: 1.8,
        radius: 0.15,
        height: 0.3,
      },
      {
        shape: "box",
        kind: "crate",
        look: "wood",
        x: -0.72,
        z: 3,
        width: 0.5,
        depth: 0.3,
        height: 0.24,
      },
    ],
    movers: [],
    clear: {
      title: "抜けた。",
      message: "まだ、床の上にいる。",
    },
  },
  {
    id: "wash-station",
    egg: "goose",
    name: "洗い場",
    subtitle: "WASH STATION",
    brief: "床が濡れている。撞いても転がらず、まっすぐ滑るだけ。曲がってはくれない。",
    length: 4.6,
    halfWidth: DEFAULT_HALF_WIDTH,
    bank: 0,
    atmosphere: { fog: 0x53666c, key: 0xdfeaf2, ambient: 0xcfdde4 },
    floor: [
      { toZ: 1.2, surface: "dry" },
      { toZ: 3.6, surface: "wet" },
      { toZ: 4.6, surface: "dry" },
    ],
    props: [
      ...counterLegs([0.8, 2.4, 4.1]),
      {
        shape: "cylinder",
        kind: "sink-leg",
        look: "steel",
        x: -0.62,
        z: 1.9,
        radius: 0.05,
        height: 0.7,
      },
      {
        shape: "cylinder",
        kind: "sink-leg",
        look: "steel",
        x: 0.24,
        z: 1.9,
        radius: 0.05,
        height: 0.7,
      },
      {
        shape: "cylinder",
        kind: "sink-leg",
        look: "steel",
        x: -0.24,
        z: 3,
        radius: 0.05,
        height: 0.7,
      },
      {
        shape: "cylinder",
        kind: "sink-leg",
        look: "steel",
        x: 0.62,
        z: 3,
        radius: 0.05,
        height: 0.7,
      },
      {
        shape: "box",
        kind: "drain",
        look: "darkMetal",
        decorative: true,
        x: 0,
        z: 2.5,
        width: 1.5,
        depth: 0.16,
        height: 0.008,
      },
    ],
    movers: [],
    // 洗い場ではじめて猫が出る。流し台の脚の奥が逃げ場になる。
    cat: { firstAt: 9, every: 11, strength: 0.05 },
    shelters: [
      { fromX: -1.15, toX: -0.72, fromZ: 1.6, toZ: 2.4, label: "流し台の下" },
      { fromX: 0.72, toX: 1.15, fromZ: 2.7, toZ: 3.5, label: "洗い桶の陰" },
    ],
    clear: {
      title: "濡れた床を渡った。",
      message: "床が、また卵を掴みはじめる。",
    },
  },
  {
    id: "service-aisle",
    egg: "duck",
    name: "配膳通路",
    subtitle: "SERVICE AISLE",
    brief: "配膳カートが通路を横切る。撞いたら止まれない。渡るなら通り過ぎた直後。",
    length: 5,
    halfWidth: DEFAULT_HALF_WIDTH,
    bank: 0,
    atmosphere: { fog: 0x6a6f68, key: 0xfff0d6, ambient: 0xe0e2d8 },
    floor: [{ toZ: 5, surface: "dry" }],
    props: [...counterLegs([0.8, 2.9])],
    movers: [
      {
        id: "cart-a",
        kind: "cart",
        look: "steel",
        z: 1.9,
        width: 0.55,
        depth: 0.34,
        height: 0.55,
        travel: 0.55,
        period: 12,
        phase: Math.PI / 2,
      },
      {
        id: "cart-b",
        kind: "cart",
        look: "steel",
        z: 3.8,
        width: 0.55,
        depth: 0.34,
        height: 0.55,
        travel: 0.55,
        period: 9.5,
        phase: -Math.PI / 2,
      },
    ],
    cat: { firstAt: 7, every: 9, strength: 0.055 },
    shelters: [
      { fromX: -1.15, toX: -0.78, fromZ: 2.2, toZ: 3.1, label: "台車の陰" },
      { fromX: 0.78, toX: 1.15, fromZ: 2.2, toZ: 3.1, label: "壁ぎわ" },
    ],
    clear: {
      title: "通した。",
      message: "カートは、こちらを見ていない。",
    },
  },
  {
    id: "the-range",
    egg: "chicken",
    name: "火口の前",
    subtitle: "THE RANGE",
    brief: "換気扇が横から吸っている。放っておくと、火口の脚の側へ持っていかれる。",
    length: 4.6,
    halfWidth: DEFAULT_HALF_WIDTH,
    bank: 0.06,
    draft: { fromZ: 1, toZ: 4, force: -0.018 },
    atmosphere: { fog: 0x6d5a4a, key: 0xffd3a0, ambient: 0xe8d3bd },
    floor: [
      { toZ: 1.4, surface: "dry" },
      { toZ: 3.2, surface: "grease" },
      { toZ: 4.6, surface: "dry" },
    ],
    props: [
      ...counterLegs([1.2, 3.6]),
      {
        shape: "cylinder",
        kind: "range-leg",
        look: "hot",
        x: -0.54,
        z: 1.4,
        radius: 0.055,
        height: 0.62,
      },
      {
        shape: "cylinder",
        kind: "range-leg",
        look: "hot",
        x: -0.66,
        z: 2.6,
        radius: 0.055,
        height: 0.62,
      },
      {
        shape: "cylinder",
        kind: "range-leg",
        look: "hot",
        x: -0.48,
        z: 3.8,
        radius: 0.055,
        height: 0.62,
      },
    ],
    movers: [],
    cat: { firstAt: 6, every: 8, strength: 0.05 },
    shelters: [
      { fromX: 0.7, toX: 1.15, fromZ: 1.8, toZ: 2.8, label: "冷蔵庫の隙間" },
    ],
    clear: {
      title: "火口の前を過ぎた。",
      message: "傾いた床が、まだ体に残っている。",
    },
  },
  {
    id: "back-door",
    egg: "quail",
    name: "裏口",
    subtitle: "BACK DOOR",
    brief: "扉の下は、通路の八分の一しか開いていない。最後は、速さより正確さ。",
    length: 3.6,
    halfWidth: DEFAULT_HALF_WIDTH,
    bank: 0,
    atmosphere: { fog: 0x46534e, key: 0xe8f0dc, ambient: 0xccd8cd },
    floor: [
      { toZ: 0.9, surface: "dry" },
      { toZ: 1.9, surface: "grease" },
      { toZ: 3.6, surface: "dry" },
    ],
    props: [
      ...counterLegs([0.8]),
      {
        shape: "box",
        kind: "door-frame",
        look: "darkMetal",
        x: -0.665,
        z: 2.6,
        width: 0.97,
        depth: 0.12,
        height: 0.5,
      },
      {
        shape: "box",
        kind: "door-frame",
        look: "darkMetal",
        x: 0.665,
        z: 2.6,
        width: 0.97,
        depth: 0.12,
        height: 0.5,
      },
    ],
    movers: [],
    cat: { firstAt: 5, every: 7, strength: 0.04 },
    shelters: [
      { fromX: -1.15, toX: -0.75, fromZ: 1.0, toZ: 1.9, label: "扉のくぼみ" },
      { fromX: 0.75, toX: 1.15, fromZ: 1.0, toZ: 1.9, label: "壁のくぼみ" },
    ],
    clear: {
      title: "外。",
      message: "厨房の音が、うしろで続いている。",
    },
  },
];

export function stageAt(index) {
  return STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
}

export function floorSpans(stage) {
  let fromZ = 0;
  return stage.floor.map((section) => {
    const span = {
      fromZ,
      toZ: section.toZ,
      surface: section.surface,
      friction: SURFACE_FRICTION[section.surface],
    };
    fromZ = section.toZ;
    return span;
  });
}

export function surfaceAt(stage, z) {
  const span = floorSpans(stage).find(
    (section) => z >= section.fromZ && z < section.toZ
  );
  return span?.surface ?? stage.floor[stage.floor.length - 1].surface;
}

// 床はz軸まわりに傾く。ステージ定義の座標は傾いた床の上のローカル座標で、
// 描画・剛体へ渡す前にこの回転でワールド座標へ移す。
export function bankRotation(stage) {
  const half = (stage.bank ?? 0) / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

export function toWorld(stage, x, y, z) {
  const bank = stage.bank ?? 0;
  if (!bank) return { x, y, z };
  const cos = Math.cos(bank);
  const sin = Math.sin(bank);
  return { x: x * cos - y * sin, y: x * sin + y * cos, z };
}

export const START_Z = 0.3;

// 卵は横倒しで置く。立てて置くと倒れたあと長軸が進行方向を向き、
// 重心を偏らせても転がらずその場で止まってしまう。
export function stageStartPosition(stage) {
  const egg = eggProfile(stage.egg);
  return toWorld(stage, 0, egg.maxRadius + 0.001, START_Z);
}

export function stageStartRotation(stage) {
  const half = ((stage.bank ?? 0) + Math.PI / 2) / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

// 換気扇が横から吸う力。傾きだけでは卵はほとんど流れないと実測で分かったため、
// 「押し戻し続ける」感触はこの力で作る。単位はニュートン、正が+x方向。
export function draftForceAt(stage, z) {
  const draft = stage.draft;
  if (!draft) return 0;
  return z >= draft.fromZ && z <= draft.toZ ? draft.force : 0;
}

export function moverCenterX(mover, time) {
  return mover.travel * Math.sin((time / mover.period) * Math.PI * 2 + mover.phase);
}

// 指定zで通路を塞いでいるx区間。乗り上げられる低い段差は含めない。
export function blockedSpansAt(stage, z, time = 0) {
  const spans = [];

  for (const prop of stage.props) {
    if (prop.height <= PASSABLE_HEIGHT) continue;
    if (prop.shape === "cylinder") {
      const dz = Math.abs(z - prop.z);
      if (dz >= prop.radius) continue;
      const halfWidth = Math.sqrt(prop.radius * prop.radius - dz * dz);
      spans.push([prop.x - halfWidth, prop.x + halfWidth]);
    } else {
      if (Math.abs(z - prop.z) > prop.depth / 2) continue;
      spans.push([prop.x - prop.width / 2, prop.x + prop.width / 2]);
    }
  }

  for (const mover of stage.movers) {
    if (mover.height <= PASSABLE_HEIGHT) continue;
    if (Math.abs(z - mover.z) > mover.depth / 2) continue;
    const centerX = moverCenterX(mover, time);
    spans.push([centerX - mover.width / 2, centerX + mover.width / 2]);
  }

  return spans.sort((a, b) => a[0] - b[0]);
}

export function widestGapAt(stage, z, time = 0) {
  const spans = blockedSpansAt(stage, z, time);
  let cursor = -stage.halfWidth;
  let widest = 0;

  for (const [start, end] of spans) {
    if (start > cursor) widest = Math.max(widest, start - cursor);
    cursor = Math.max(cursor, end);
  }
  return Math.max(widest, stage.halfWidth - cursor);
}

// 動く障害物は位相によって塞ぐ位置が変わるため、
// 「どこかの時刻で通れる」ことを通過可能とみなす。
export function bestGapAt(stage, z, samples = 24) {
  if (stage.movers.length === 0) return widestGapAt(stage, z);
  const period = Math.max(...stage.movers.map((mover) => mover.period));
  let best = 0;
  for (let index = 0; index < samples; index += 1) {
    best = Math.max(best, widestGapAt(stage, z, (index / samples) * period));
  }
  return best;
}

// 剛体が触る形だけを、描画から切り離して書き出す。
// ブラウザの組み立てもNodeの通過検証も、必ずこの一覧を読む。
export function stageColliders(stage) {
  const rotation = bankRotation(stage);
  const shapes = [];

  const place = (shape, kind, localX, localY, localZ, friction, restitution) => {
    shapes.push({
      ...shape,
      kind,
      friction,
      restitution: restitution ?? 0,
      position: toWorld(stage, localX, localY, localZ),
      rotation,
    });
  };

  for (const section of floorSpans(stage)) {
    const depth = section.toZ - section.fromZ;
    place(
      { shape: "cuboid", halfExtents: { x: stage.halfWidth, y: 0.025, z: depth / 2 } },
      "floor",
      0,
      -0.025,
      (section.fromZ + section.toZ) / 2,
      section.friction,
      0.02
    );
  }

  [-1, 1].forEach((side) => {
    place(
      {
        shape: "cuboid",
        halfExtents: { x: 0.02, y: 0.13, z: stage.length / 2 + 0.6 },
      },
      "wall",
      side * (stage.halfWidth + 0.02),
      0.1,
      stage.length / 2,
      0.44
    );
  });

  for (const prop of stage.props) {
    if (prop.decorative) continue;
    const shape = prop.shape === "cylinder"
      ? { shape: "cylinder", halfHeight: prop.height / 2, radius: prop.radius }
      : {
        shape: "cuboid",
        halfExtents: {
          x: prop.width / 2,
          y: prop.height / 2,
          z: prop.depth / 2,
        },
      };
    place(shape, prop.kind, prop.x, prop.height / 2, prop.z, 0.5);
  }

  return shapes;
}

export function moverCollider(stage, mover, time) {
  return {
    shape: "cuboid",
    kind: mover.kind,
    friction: 0.5,
    restitution: 0,
    halfExtents: {
      x: mover.width / 2,
      y: mover.height / 2,
      z: mover.depth / 2,
    },
    position: toWorld(
      stage,
      moverCenterX(mover, time),
      mover.height / 2,
      mover.z
    ),
    rotation: bankRotation(stage),
  };
}

export function validateStage(stage) {
  const problems = [];

  if (!(stage.length > 0)) problems.push(`${stage.id}: 長さが正の値ではない`);
  const egg = eggProfile(stage.egg);
  if (!(stage.halfWidth > egg.clearance)) {
    problems.push(`${stage.id}: ${egg.name}には通路が狭すぎる`);
  }

  const spans = floorSpans(stage);
  if (spans.length === 0 || spans[spans.length - 1].toZ !== stage.length) {
    problems.push(`${stage.id}: 床がステージ全長を覆っていない`);
  }
  spans.forEach((section) => {
    if (section.toZ <= section.fromZ) {
      problems.push(`${stage.id}: 床区間の順序が逆転している`);
    }
    if (!(section.friction > 0)) {
      problems.push(`${stage.id}: 未定義の床面 ${section.surface}`);
    }
  });

  [...stage.props, ...stage.movers].forEach((item) => {
    const reach = item.shape === "cylinder"
      ? item.radius
      : (item.width ?? 0) / 2 + Math.abs(item.travel ?? 0);
    if (Math.abs(item.x ?? 0) + reach > stage.halfWidth + 0.4) {
      problems.push(`${stage.id}: 障害物が床の外へ大きくはみ出している`);
    }
    if (item.z < 0 || item.z > stage.length) {
      problems.push(`${stage.id}: 障害物がステージ範囲の外にある`);
    }
  });

  for (const shelter of stage.shelters ?? []) {
    if (shelter.fromX >= shelter.toX || shelter.fromZ >= shelter.toZ) {
      problems.push(`${stage.id}: 逃げ場の範囲が逆さま`);
    }
    if (Math.abs(shelter.fromX) > stage.halfWidth + 0.01
      || Math.abs(shelter.toX) > stage.halfWidth + 0.01) {
      problems.push(`${stage.id}: 逃げ場が床の外にある`);
    }
    if (shelter.toZ > stage.length || shelter.fromZ < 0) {
      problems.push(`${stage.id}: 逃げ場が区画の外にある`);
    }
    const width = Math.min(shelter.toX - shelter.fromX, shelter.toZ - shelter.fromZ);
    if (width < egg.width * 1.5) {
      problems.push(`${stage.id}: 逃げ場が${egg.name}には狭い`);
    }
  }
  if (stage.cat && (stage.shelters ?? []).length === 0) {
    problems.push(`${stage.id}: 猫がいるのに逃げ場がない`);
  }

  for (let z = 0; z <= stage.length + 0.001; z += 0.05) {
    const gap = bestGapAt(stage, Math.min(z, stage.length));
    if (gap < egg.clearance) {
      problems.push(
        `${stage.id}: ${egg.name}が z=${z.toFixed(2)} を通れない`
        + `（隙間 ${gap.toFixed(3)} m、必要 ${egg.clearance.toFixed(3)} m）`
      );
      break;
    }
  }

  return problems;
}

export function totalCourseLength() {
  return STAGES.reduce((sum, stage) => sum + stage.length, 0);
}
