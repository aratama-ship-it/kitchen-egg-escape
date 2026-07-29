import { EGG_HALF_HEIGHT, EGG_MAX_RADIUS, SHELL_MASS } from "./egg-shape.js";
import {
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  YOLK_MASS,
  YOLK_MAX_OFFSET,
  YOLK_REST_OFFSET,
  YOLK_SPEED_CAP,
  YOLK_VISUAL_RADIUS,
} from "./yolk-model.js";
import {
  LANDING_BREAK_SPEED,
  OBJECT_IMPACT_FORCE_THRESHOLD,
  OBJECT_IMPACT_SPEED_THRESHOLD,
} from "./impact-model.js";

// 卵の種類は見た目の違いではなく、転がり方そのものを決める。
// 大きい卵ほど1 mあたりの回転数が減り、ゆっくり重く転がる。
// 小さい卵は速く回り、軽く、狭いところを通れる。
//
// 寸法は倍率、質量は密度一定として倍率の3乗、速度は√倍率で決まる
// （大きなものほど、自分の大きさに対してはゆっくり動く）。
export const EGG_TYPES = [
  {
    id: "ostrich",
    name: "ダチョウの卵",
    scale: 3,
    shell: 0xefe4cc,
    yolk: 0xe0a41a,
    note: "重い。多少ぶつけても割れないが、狭いところは通れない。",
  },
  {
    id: "goose",
    name: "ガチョウの卵",
    scale: 1.8,
    shell: 0xf2ebd8,
    yolk: 0xe6a616,
    note: "まだ余裕がある。転がりは落ち着いている。",
  },
  {
    id: "duck",
    name: "アヒルの卵",
    scale: 1.3,
    shell: 0xeaf0e6,
    yolk: 0xeaa412,
    note: "手に馴染む大きさ。ここから神経を使いはじめる。",
  },
  {
    id: "chicken",
    name: "ニワトリの卵",
    scale: 1,
    shell: 0xf6efdd,
    yolk: 0xe8a411,
    note: "見慣れた卵。速く回り、思ったより止まらない。",
  },
  {
    id: "quail",
    name: "ウズラの卵",
    scale: 0.62,
    shell: 0xeee7d2,
    yolk: 0xefa30e,
    note: "小さく脆い。狭い隙間を通れるのはこの卵だけ。",
  },
];

export function eggTypeById(id) {
  return EGG_TYPES.find((type) => type.id === id) ?? EGG_TYPES[3];
}

// 倍率から、その卵で使う値をすべて出す。ここが唯一の換算表になる。
export function eggProfile(id) {
  const type = eggTypeById(id);
  const scale = type.scale;
  const cube = scale * scale * scale;
  const root = Math.sqrt(scale);

  return {
    ...type,
    scale,
    maxRadius: EGG_MAX_RADIUS * scale,
    halfHeight: EGG_HALF_HEIGHT * scale,
    width: EGG_MAX_RADIUS * 2 * scale,
    shellMass: SHELL_MASS * cube,
    yolkMass: YOLK_MASS * cube,
    restOffset: YOLK_REST_OFFSET * scale,
    maxOffset: YOLK_MAX_OFFSET * scale,
    visualRadius: YOLK_VISUAL_RADIUS * scale,
    shotMinSpeed: SHOT_MIN_SPEED * root,
    shotMaxSpeed: SHOT_MAX_SPEED * root,
    yolkSpeedCap: YOLK_SPEED_CAP * root,
    // 割れる境目も同じ縮尺で動かす。大きい卵は殻も厚く、実際に丈夫。
    landingBreakSpeed: LANDING_BREAK_SPEED * root,
    impactForceThreshold: OBJECT_IMPACT_FORCE_THRESHOLD * cube,
    impactSpeedThreshold: OBJECT_IMPACT_SPEED_THRESHOLD * root,
    // 通り抜けに必要な幅。卵の幅の2倍を最低限とする。
    clearance: Math.max(0.1, EGG_MAX_RADIUS * 2 * scale * 2),
  };
}
