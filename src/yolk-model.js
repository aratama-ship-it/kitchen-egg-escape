// 実物の卵は殻が全体の約1割で、残りは中身。殻を重く見積もっていたころは
// 重心を偏らせても転がり出せず、その場で止まることが多かった。
export const YOLK_MASS = 0.052;
export const YOLK_VISUAL_RADIUS = 0.01;
export const YOLK_MAX_OFFSET = 0.013;
export const YOLK_REST_OFFSET = 0.0045;

export function spherePrincipalInertia(mass, radius) {
  return (2 / 5) * mass * radius * radius;
}

export function clampVector3(vector, maxLength) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= maxLength || length === 0) return { ...vector };
  const scale = maxLength / length;
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

// ワールド向きのベクトルを、殻の姿勢から見たローカル向きへ移す。
export function rotateByInverse(rotation, vector) {
  const { x, y, z, w } = rotation;
  const ix = w * vector.x - y * vector.z + z * vector.y;
  const iy = w * vector.y - z * vector.x + x * vector.z;
  const iz = w * vector.z - x * vector.y + y * vector.x;
  const iw = x * vector.x + y * vector.y + z * vector.z;
  return {
    x: ix * w + iw * x - iy * -z + iz * -y,
    y: iy * w + iw * y - iz * -x + ix * -z,
    z: iz * w + iw * z - ix * -y + iy * -x,
  };
}

// 黄身の狙う位置。無操作なら常に真下（＝殻の中で低いところ）へ落ち着き、
// 操作があればその向きへ寄る。この一点だけが操作の入口になっている。
export function yolkTargetFor({
  rotation,
  commandX = 0,
  commandZ = 0,
  strength = 0,
}) {
  const localDown = rotateByInverse(rotation, { x: 0, y: -1, z: 0 });
  const target = {
    x: localDown.x * YOLK_REST_OFFSET,
    y: localDown.y * YOLK_REST_OFFSET,
    z: localDown.z * YOLK_REST_OFFSET,
  };

  if (strength > 0 && (commandX !== 0 || commandZ !== 0)) {
    const control = rotateByInverse(rotation, { x: commandX, y: 0, z: commandZ });
    const scale = YOLK_MAX_OFFSET * strength;
    target.x += control.x * scale;
    target.y += control.y * scale;
    target.z += control.z * scale;
  }

  return clampVector3(target, YOLK_MAX_OFFSET);
}

// 黄身が指の動きへ追いつく速さ。柔らかすぎると、ドラッグしてから
// 卵が向きを変えるまでが遅く、操作が効いていないように感じる。
const YOLK_SPRING = 184;
const YOLK_DAMPING = 23;

export function advanceYolk(state, target, dt) {
  const spring = YOLK_SPRING;
  const damping = YOLK_DAMPING;
  const acceleration = {
    x: (target.x - state.position.x) * spring - state.velocity.x * damping,
    y: (target.y - state.position.y) * spring - state.velocity.y * damping,
    z: (target.z - state.position.z) * spring - state.velocity.z * damping,
  };

  const velocity = {
    x: state.velocity.x + acceleration.x * dt,
    y: state.velocity.y + acceleration.y * dt,
    z: state.velocity.z + acceleration.z * dt,
  };
  const position = clampVector3({
    x: state.position.x + velocity.x * dt,
    y: state.position.y + velocity.y * dt,
    z: state.position.z + velocity.z * dt,
  }, YOLK_MAX_OFFSET);

  if (Math.hypot(position.x, position.y, position.z) >= YOLK_MAX_OFFSET * 0.999) {
    const normalLength = Math.max(1e-9, Math.hypot(position.x, position.y, position.z));
    const nx = position.x / normalLength;
    const ny = position.y / normalLength;
    const nz = position.z / normalLength;
    const outwardSpeed = velocity.x * nx + velocity.y * ny + velocity.z * nz;
    if (outwardSpeed > 0) {
      velocity.x -= nx * outwardSpeed;
      velocity.y -= ny * outwardSpeed;
      velocity.z -= nz * outwardSpeed;
    }
  }

  return { position, velocity, acceleration };
}
