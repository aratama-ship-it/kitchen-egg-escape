// 重力を1/3にした分、接触力も速度も小さくなる。割れる境目を同じ縮尺で合わせる。
// 力は重力に比例して1/3、速度は√3分の1になる。
export const OBJECT_IMPACT_FORCE_THRESHOLD = 1.15 / 3;
export const OBJECT_IMPACT_SPEED_THRESHOLD = 0.14 / Math.sqrt(3);
export const IMPACT_GRACE_SECONDS = 0.45;

// 床へ落ちてきた速さがこれを超えると割れる。実測では、普通に撞いて転がるあいだの
// 落下速度は0.29 m/s、速い連打でも0.67 m/sどまり。連打で跳ね続けて無理やり
// 直進する打ち方だけがこの値を大きく超える。
export const LANDING_BREAK_SPEED = 1;

export function shouldShatter({
  colliderKind,
  forceMagnitude,
  speed,
  playAge,
  fallSpeed = 0,
  landingBreakSpeed = LANDING_BREAK_SPEED,
  forceThreshold = OBJECT_IMPACT_FORCE_THRESHOLD,
  speedThreshold = OBJECT_IMPACT_SPEED_THRESHOLD,
}) {
  if (colliderKind === "unknown") return false;
  if (playAge < IMPACT_GRACE_SECONDS) return false;
  // 床は転がっているあいだずっと触れているので、落ちてきた速さだけを見る。
  if (colliderKind === "floor") return fallSpeed >= landingBreakSpeed;
  return forceMagnitude >= forceThreshold && speed >= speedThreshold;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
