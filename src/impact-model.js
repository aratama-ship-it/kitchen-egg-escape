export const OBJECT_IMPACT_FORCE_THRESHOLD = 1.15;
export const OBJECT_IMPACT_SPEED_THRESHOLD = 0.14;
export const IMPACT_GRACE_SECONDS = 0.45;

export function shouldShatter({
  colliderKind,
  forceMagnitude,
  speed,
  playAge,
}) {
  if (colliderKind === "floor" || colliderKind === "unknown") return false;
  if (playAge < IMPACT_GRACE_SECONDS) return false;
  return (
    forceMagnitude >= OBJECT_IMPACT_FORCE_THRESHOLD &&
    speed >= OBJECT_IMPACT_SPEED_THRESHOLD
  );
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
