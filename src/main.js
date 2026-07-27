import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import {
  EGG_MAX_RADIUS,
  SHELL_MASS,
  createEggColliderPoints,
  createEggGeometry,
} from "./egg-shape.js";
import {
  YOLK_MASS,
  YOLK_REST_OFFSET,
  YOLK_VISUAL_RADIUS,
  advanceYolk,
  rotateByInverse,
  spherePrincipalInertia,
  yolkTargetFor,
} from "./yolk-model.js";
import {
  mulberry32,
  shouldShatter,
} from "./impact-model.js";
import {
  STAGES,
  SURFACE_FRICTION,
  draftForceAt,
  stageStartPosition,
  stageStartRotation,
  surfaceAt,
} from "./stages.js";
import { buildStage } from "./stage-builder.js";

const gameShell = document.getElementById("game-shell");
const canvas = document.getElementById("game-canvas");
const intro = document.getElementById("intro");
const result = document.getElementById("result");
const startButton = document.getElementById("start-button");
const retryButton = document.getElementById("retry-button");
const resultKicker = document.getElementById("result-kicker");
const resultTitle = document.getElementById("result-title");
const resultMessage = document.getElementById("result-message");
const progressFill = document.getElementById("progress-fill");
const distanceLabel = document.getElementById("distance-label");
const physicsReadout = document.getElementById("physics-readout");
const zoneName = document.getElementById("zone-name");
const attemptCount = document.getElementById("attempt-count");
const stageDots = document.getElementById("stage-dots");
const stallHint = document.getElementById("stall-hint");
const stageBrief = document.getElementById("stage-brief");
const introBrief = document.getElementById("intro-brief");
const dragHint = document.getElementById("drag-hint");
const srStatus = document.getElementById("sr-status");

const FIXED_STEP = 1 / 120;
// 実物大の卵は、そのままの速さで見せると止まって見えるほど遅い。
// 物理はそのままに、時間だけ速く進める。衝突の強さの関係は変わらない。
const TIME_SCALE = 1.7;
const MAX_STEPS_PER_FRAME = 40;
// 撞く強さ。黄身へ与える速度で、1.8 m/sを超えると重心が動きすぎて計算が荒れる。
const SHOT_MIN_SPEED = 0.75;
const SHOT_MAX_SPEED = 1.8;
const YOLK_SPEED_CAP = 1.8;
const SHOT_COOLDOWN = 0.28;
// 引いた距離がこの画素数で最大の力になる。
const AIM_FULL_PULL = 132;
const AIM_DEAD_ZONE = 10;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const YOLK_INERTIA = spherePrincipalInertia(YOLK_MASS, YOLK_VISUAL_RADIUS);
const NORMAL_EXPOSURE = 1.08;
const SHATTER_RESULT_DELAY = 1.45;
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let mode = "loading";
let attempt = 1;
let firstInputMade = false;
let accumulator = 0;
let previousTime = performance.now();
let lastHudUpdate = 0;
let playAge = 0;
let audioContext = null;
let stageIndex = 0;
let stageHandle = null;
let stageTime = 0;
let clearedCount = 0;
let shotCooldown = 0;
let shotsTaken = 0;
// 角に噛んだときは横へ狙えば必ず外れる。何度撞いても進めないときだけ伝える。
let stuckShots = 0;
let progressMark = 0;
let settledNoted = true;

// 狙い。撞く向き（進みたい向き）と、引いた量から決まる力。
const aim = {
  active: false,
  pointerId: null,
  originX: 0,
  originY: 0,
  x: 0,
  z: 1,
  power: 0,
};

const currentStage = () => STAGES[stageIndex];

const yolkState = {
  position: { x: 0, y: -YOLK_REST_OFFSET, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  acceleration: { x: 0, y: 0, z: 0 },
};

const breakState = {
  active: false,
  age: 0,
  resultShown: false,
  distanceRemaining: 0,
  position: new THREE.Vector3(),
  fragments: [],
  group: new THREE.Group(),
  albumen: null,
  yolk: null,
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = NORMAL_EXPOSURE;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x63706b);
scene.fog = new THREE.Fog(0x63706b, 2.4, 13.5);

const camera = new THREE.PerspectiveCamera(58, 1, 0.008, 30);
camera.position.set(0, 0.13, -0.34);

const hemisphere = new THREE.HemisphereLight(0xdde4dd, 0x26302d, 1.4);
scene.add(hemisphere);

const keyLight = new THREE.DirectionalLight(0xfff2d0, 3.5);
keyLight.position.set(-1.8, 3.5, -1.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -3;
keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -2;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 9;
scene.add(keyLight);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = FIXED_STEP;
const eventQueue = new RAPIER.EventQueue(true);

scene.add(breakState.group);

// 狙いは床の上に置く。低い視点なので、空中の矢印より床の帯のほうが読みやすい。
const aimGeometry = new THREE.PlaneGeometry(1, 1);
aimGeometry.translate(0, 0.5, 0);
const aimMaterial = new THREE.MeshBasicMaterial({
  color: 0xf0c94b,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const aimMesh = new THREE.Mesh(aimGeometry, aimMaterial);
aimMesh.rotation.x = -Math.PI / 2;
aimMesh.renderOrder = 4;
aimMesh.visible = false;
scene.add(aimMesh);

// 動かしているのは黄身なので、それが見えないと何をしているのか分からない。
// 殻を薄い磁器のように透かし、中の白身と黄身を主役として見せる。
const eggGeometry = createEggGeometry();
const shellMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xf6efdd,
  roughness: 0.26,
  metalness: 0,
  transparent: true,
  opacity: 0.34,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const shellMesh = new THREE.Mesh(eggGeometry, shellMaterial);
shellMesh.castShadow = true;
shellMesh.receiveShadow = true;
shellMesh.renderOrder = 3;
scene.add(shellMesh);

// 白身。黄身より一回り大きく、ほとんど透明。黄身が動くとき遅れて揺れる。
const albumenMesh = new THREE.Mesh(
  new THREE.SphereGeometry(YOLK_VISUAL_RADIUS * 1.85, 24, 16),
  new THREE.MeshPhysicalMaterial({
    color: 0xdfe7dc,
    roughness: 0.1,
    transmission: 0.6,
    thickness: 0.004,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  })
);
albumenMesh.scale.set(1.05, 0.78, 1.02);
albumenMesh.renderOrder = 1;
shellMesh.add(albumenMesh);

const yolkGeometry = new THREE.SphereGeometry(YOLK_VISUAL_RADIUS, 32, 20);
const yolkMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8a411,
  roughness: 0.34,
  metalness: 0,
  emissive: 0xd07d0a,
  emissiveIntensity: 0.28,
});
const yolkMesh = new THREE.Mesh(yolkGeometry, yolkMaterial);
yolkMesh.scale.set(1.06, 0.88, 1.02);
yolkMesh.renderOrder = 2;
shellMesh.add(yolkMesh);

const firstStart = stageStartPosition(STAGES[0]);
const eggBodyDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(firstStart.x, firstStart.y, firstStart.z)
  .setRotation(stageStartRotation(STAGES[0]))
  .setLinearDamping(0.08)
  .setAngularDamping(0.11)
  .setCcdEnabled(true);
const eggBody = world.createRigidBody(eggBodyDesc);
eggBody.setAdditionalSolverIterations(8);

const eggColliderDesc = RAPIER.ColliderDesc.convexHull(createEggColliderPoints());
if (!eggColliderDesc) throw new Error("卵形状の凸包を作成できませんでした。");
eggColliderDesc
  .setMass(SHELL_MASS)
  .setFriction(0.52)
  .setRestitution(0.035)
  .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
  .setContactForceEventThreshold(0.08)
  .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
const eggCollider = world.createCollider(eggColliderDesc, eggBody);
applyYolkMassProperties();
loadStage(openingStageIndex());
syncEggVisual();

mode = "intro";
startButton.disabled = false;
startButton.textContent = "厨房へ出る";
introBrief.textContent = currentStage().brief;
physicsReadout.textContent = "剛体 120 Hz · 凸形状 590点 · 質量 60 g";
renderer.setAnimationLoop(frame);

// 開発時に `?stage=3` で途中の区画から開けるようにする。後ろの区画を
// 何度も通し直さずに確認できる。
function openingStageIndex() {
  if (!import.meta.env.DEV) return 0;
  const requested = Number(new URLSearchParams(location.search).get("stage"));
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(STAGES.length - 1, Math.round(requested) - 1));
}

// ステージは1区画ずつ作り直す。前の区画の剛体と描画をすべて破棄してから
// 次を組み立てるため、世界には常に現在の区画だけが存在する。
function loadStage(index) {
  stageIndex = Math.max(0, Math.min(STAGES.length - 1, index));
  stageHandle?.dispose();
  stageHandle = buildStage(currentStage(), { scene, world });
  applyAtmosphere(currentStage());
  buildStageDots();
  placeEggAtStart();
  stageTime = 0;
}

function applyAtmosphere(stage) {
  const atmosphere = stage.atmosphere ?? {};
  const fogColor = atmosphere.fog ?? 0x63706b;
  scene.background = new THREE.Color(fogColor);
  scene.fog.color = new THREE.Color(fogColor);
  keyLight.color = new THREE.Color(atmosphere.key ?? 0xfff2d0);
  hemisphere.color = new THREE.Color(atmosphere.ambient ?? 0xdde4dd);
}

function placeEggAtStart() {
  const stage = currentStage();
  eggBody.setEnabled(true);
  eggBody.setTranslation(stageStartPosition(stage), true);
  eggBody.setRotation(stageStartRotation(stage), true);
  eggBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  eggBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function applyYolkMassProperties() {
  eggBody.setAdditionalMassProperties(
    YOLK_MASS,
    yolkState.position,
    { x: YOLK_INERTIA, y: YOLK_INERTIA, z: YOLK_INERTIA },
    IDENTITY_ROTATION,
    true
  );
}

// 狙いをつけているあいだ、黄身は撞く向きと反対側へ引かれて溜まる。
// 放つと、その溜めが速度になって内壁へ向かう。
function currentYolkTarget() {
  if (!aim.active || aim.power <= 0) {
    return yolkTargetFor({ rotation: eggBody.rotation() });
  }
  return yolkTargetFor({
    rotation: eggBody.rotation(),
    commandX: -aim.x,
    commandZ: -aim.z,
    strength: aim.power,
  });
}

function isEggSettled() {
  const velocity = eggBody.linvel();
  return Math.hypot(velocity.x, velocity.y, velocity.z) < 0.03;
}

function capYolkSpeed() {
  const speed = Math.hypot(
    yolkState.velocity.x,
    yolkState.velocity.y,
    yolkState.velocity.z
  );
  if (speed <= YOLK_SPEED_CAP) return;
  const scale = YOLK_SPEED_CAP / speed;
  yolkState.velocity.x *= scale;
  yolkState.velocity.y *= scale;
  yolkState.velocity.z *= scale;
}

// 蹴られた勢いを転がりに変える。卵が「ゴロン」と回るのはここ。
// ただし床が滑るほど転がりには変わらず、そのまま滑っていく。
function rollWithKick() {
  const velocity = eggBody.linvel();
  const horizontal = Math.hypot(velocity.x, velocity.z);
  if (horizontal < 1e-5) return;
  const stage = currentStage();
  const friction = SURFACE_FRICTION[surfaceAt(stage, eggBody.translation().z)];
  const grip = THREE.MathUtils.clamp(friction / SURFACE_FRICTION.dry, 0, 1);
  const spin = (horizontal / EGG_MAX_RADIUS) * grip;
  const angular = eggBody.angvel();
  eggBody.setAngvel(
    {
      x: (velocity.z / horizontal) * spin,
      y: angular.y,
      z: (-velocity.x / horizontal) * spin,
    },
    true
  );
}

// 撞く。黄身へ狙った向きの速度を与えるだけで、殻には直接触れない。
function fireShot(dirX, dirZ, power) {
  if (mode !== "playing" || shotCooldown > 0) return;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6) return;

  const speed = SHOT_MIN_SPEED + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * power;
  const rotation = eggBody.rotation();
  const local = rotateByInverse(rotation, {
    x: (dirX / length) * speed,
    y: 0,
    z: (dirZ / length) * speed,
  });
  yolkState.velocity = local;
  shotCooldown = SHOT_COOLDOWN;
  shotsTaken += 1;
  settledNoted = false;
  playShotSound(power);
  dragHint.classList.add("is-hidden");
  firstInputMade = true;
}

function physicsStep() {
  playAge += FIXED_STEP;
  stageTime += FIXED_STEP;
  stageHandle.update(stageTime);
  shotCooldown = Math.max(0, shotCooldown - FIXED_STEP);
  if (shotCooldown === 0 && shotsTaken > 0 && !aim.active && isEggSettled()) {
    if (!settledNoted) {
      settledNoted = true;
      noteShotOutcome();
    }
  }

  const nextYolk = advanceYolk(yolkState, currentYolkTarget(), FIXED_STEP);
  yolkState.position = nextYolk.position;
  yolkState.velocity = nextYolk.velocity;
  yolkState.acceleration = nextYolk.acceleration;
  capYolkSpeed();
  applyYolkMassProperties();

  // 黄身が内壁を蹴った分を殻へ渡す。卵が動く力はここだけから来る。
  const kick = nextYolk.wallImpulse;
  if (kick.x || kick.y || kick.z) {
    const rotation = eggBody.rotation();
    const worldKick = new THREE.Vector3(kick.x, kick.y, kick.z).applyQuaternion(
      new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
    );
    eggBody.applyImpulse(worldKick, true);
    rollWithKick();
  }
  const draft = draftForceAt(currentStage(), eggBody.translation().z);
  if (draft) eggBody.applyImpulse({ x: draft * FIXED_STEP, y: 0, z: 0 }, true);

  const velocityBeforeStep = eggBody.linvel();
  const speedBeforeStep = Math.hypot(
    velocityBeforeStep.x,
    velocityBeforeStep.y,
    velocityBeforeStep.z
  );
  world.step(eventQueue);

  const impact = strongestObjectImpact(speedBeforeStep);
  if (impact) {
    shatterEgg(impact);
    return;
  }

  const stage = currentStage();
  const position = eggBody.translation();
  if (
    position.y < -0.4 ||
    Math.abs(position.x) > stage.halfWidth + 0.45 ||
    position.z < -1.2
  ) {
    lose("床の外へ転がり落ちました。");
  } else if (position.z >= stage.length) {
    clearStage();
  }
}

// 何度撞いても進めないときだけ、横へ狙うよう伝える。
// 角に噛んだ卵は、横（障害物と反対側）へ撞けば必ず外れる。
function noteShotOutcome() {
  const advanced = eggBody.translation().z - progressMark;
  progressMark = eggBody.translation().z;
  stuckShots = advanced < 0.05 ? stuckShots + 1 : 0;
  const shouldShow = stuckShots >= 2;
  if (shouldShow === stallHint.classList.contains("is-visible")) return;
  stallHint.classList.toggle("is-visible", shouldShow);
  if (shouldShow) {
    srStatus.textContent = "進めていません。障害物と反対の横へ狙ってください。";
  }
}

function strongestObjectImpact(speed) {
  let strongest = null;

  eventQueue.drainContactForceEvents((event) => {
    const first = event.collider1();
    const second = event.collider2();
    if (first !== eggCollider.handle && second !== eggCollider.handle) return;

    const otherHandle = first === eggCollider.handle ? second : first;
    const colliderKind = stageHandle.kinds.get(otherHandle) ?? "unknown";
    const forceMagnitude = event.totalForceMagnitude();
    if (!shouldShatter({
      colliderKind,
      forceMagnitude,
      speed,
      playAge,
    })) return;

    if (!strongest || forceMagnitude > strongest.forceMagnitude) {
      const direction = event.maxForceDirection();
      strongest = {
        colliderKind,
        forceMagnitude,
        speed,
        direction: { x: direction.x, y: direction.y, z: direction.z },
      };
    }
  });

  return strongest;
}

// フレームの中で例外が出ると、これまでは何も起きないまま固まって見えていた。
// 原因が画面に出れば、遊んでいる側からも何が起きたか伝えられる。
function frame(time) {
  try {
    frameBody(time);
  } catch (error) {
    reportFatal(error);
  }
}

function reportFatal(error) {
  renderer.setAnimationLoop(null);
  mode = "error";
  const message = error && error.message ? error.message : String(error);
  console.error("[厨房脱出] フレーム処理で停止しました", error);
  result.classList.remove("is-shatter-result", "is-stage-clear");
  resultKicker.textContent = "STOPPED";
  resultTitle.textContent = "動作が止まりました。";
  resultMessage.textContent = message;
  stageBrief.textContent = "この文言を伝えてもらえれば原因を追えます。";
  retryButton.textContent = "読み込み直す";
  retryButton.onclick = () => location.reload();
  result.classList.add("is-visible");
  srStatus.textContent = `動作が止まりました。${message}`;
}

function frameBody(time) {
  const elapsed = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
  previousTime = time;

  if (mode === "playing") {
    accumulator += elapsed * TIME_SCALE;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      physicsStep();
      accumulator -= FIXED_STEP;
      steps += 1;
      if (mode !== "playing") break;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
  }
  if (breakState.active) updateBreakEffect(elapsed);

  syncEggVisual();
  updateAimIndicator();
  updateCamera(elapsed);
  if (time - lastHudUpdate > 80) {
    updateHud();
    lastHudUpdate = time;
  }
  renderer.render(scene, camera);
}

function syncEggVisual() {
  if (breakState.active) return;
  const position = eggBody.translation();
  const rotation = eggBody.rotation();
  shellMesh.position.set(position.x, position.y, position.z);
  shellMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  yolkMesh.position.set(
    yolkState.position.x,
    yolkState.position.y,
    yolkState.position.z
  );
  albumenMesh.position.lerp(yolkMesh.position, 0.18);
  yolkMaterial.emissiveIntensity = aim.active ? 0.5 + aim.power * 0.5 : 0.28;
}

// 引いた量がそのまま床の帯の長さになる。撞く前に飛距離の見当がつく。
function updateAimIndicator() {
  const showing = aim.active && aim.power > 0 && mode === "playing";
  aimMesh.visible = showing;

  // 床の帯を見落としても、指が効いていることだけは分かるようにする。
  if (aim.active) {
    dragHint.classList.remove("is-hidden");
    dragHint.firstElementChild.textContent = aim.power > 0
      ? `引いている　力 ${Math.round(aim.power * 100)}%`
      : "もう少し引く";
  } else if (shotsTaken > 0) {
    dragHint.classList.add("is-hidden");
  } else {
    dragHint.firstElementChild.textContent = "引いて放つ。黄身が殻を蹴る";
  }

  if (!showing) return;

  const position = eggBody.translation();
  const reach = 0.09 + aim.power * 0.34;
  aimMesh.position.set(position.x, 0.0026, position.z);
  aimMesh.scale.set(0.028 + aim.power * 0.022, reach, 1);
  aimMesh.rotation.set(-Math.PI / 2, 0, Math.atan2(aim.x, aim.z));
  aimMaterial.opacity = 0.3 + aim.power * 0.45;
}

function updateCamera(dt) {
  const position = breakState.active
    ? breakState.position
    : eggBody.translation();
  const shakeLife = breakState.active
    ? Math.max(0, 1 - breakState.age / 0.16)
    : 0;
  const shake = REDUCE_MOTION ? 0 : shakeLife * 0.0055;
  const targetPosition = new THREE.Vector3(
    position.x * 0.82 + Math.sin(breakState.age * 128) * shake,
    Math.max(0.105, position.y + 0.075),
    position.z - 0.34 + Math.cos(breakState.age * 91) * shake * 0.45
  );
  const smoothing = 1 - Math.exp(-7.5 * Math.max(dt, 1 / 120));
  camera.position.lerp(targetPosition, smoothing);
  camera.lookAt(position.x, Math.max(0.035, position.y), position.z + 0.24);
}

function shatterEgg(impact) {
  if (mode !== "playing") return;
  mode = "breaking";
  endAim(null, null, { fire: false });
  dragHint.classList.add("is-hidden");
  stuckShots = 0;
  settledNoted = true;
  stallHint.classList.remove("is-visible");

  const position = eggBody.translation();
  const linearVelocity = eggBody.linvel();
  breakState.active = true;
  breakState.age = 0;
  breakState.resultShown = false;
  breakState.distanceRemaining = Math.max(0, currentStage().length - position.z);
  breakState.position.set(position.x, position.y, position.z);

  shellMesh.visible = false;
  yolkMesh.visible = false;
  eggBody.setEnabled(false);
  createBreakEffect(position, linearVelocity, impact);
  gameShell.classList.add("is-broken");
  playCrackSound();
  srStatus.textContent = "何かにぶつかり、殻が割れました。";
}

function createBreakEffect(position, linearVelocity, impact) {
  clearBreakEffect();
  const random = mulberry32(
    attempt * 7919 +
    Math.round(Math.abs(position.x) * 10000) +
    Math.round(Math.abs(position.z) * 1000)
  );
  const floorY = 0.0022;

  const albumenMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe8eadf,
    roughness: 0.18,
    metalness: 0,
    transmission: 0.42,
    thickness: 0.002,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const albumen = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    albumenMaterial
  );
  albumen.rotation.x = -Math.PI / 2;
  albumen.position.set(position.x, floorY, position.z);
  albumen.scale.setScalar(0.004);
  albumen.renderOrder = 1;
  breakState.group.add(albumen);
  breakState.albumen = albumen;

  const spilledYolkMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe0a11b,
    roughness: 0.32,
    clearcoat: 0.22,
    transparent: true,
    opacity: 0.96,
  });
  const spilledYolk = new THREE.Mesh(
    new THREE.SphereGeometry(YOLK_VISUAL_RADIUS * 1.08, 32, 18),
    spilledYolkMaterial
  );
  spilledYolk.position.set(
    position.x + linearVelocity.x * 0.025,
    floorY + 0.003,
    position.z + linearVelocity.z * 0.025
  );
  spilledYolk.scale.set(0.45, 0.28, 0.45);
  spilledYolk.castShadow = true;
  spilledYolk.renderOrder = 2;
  breakState.group.add(spilledYolk);
  breakState.yolk = spilledYolk;

  const shardMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xeee5ce,
    roughness: 0.48,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const fragmentCount = REDUCE_MOTION ? 8 : 17;
  const impactDirection = new THREE.Vector3(
    impact.direction?.x ?? -linearVelocity.x,
    Math.max(0.08, Math.abs(impact.direction?.y ?? 0)),
    impact.direction?.z ?? -linearVelocity.z
  );
  if (impactDirection.lengthSq() < 0.001) impactDirection.set(0, 0.25, -1);
  impactDirection.normalize();

  for (let index = 0; index < fragmentCount; index += 1) {
    const width = 0.007 + random() * 0.012;
    const height = 0.008 + random() * 0.014;
    const shard = new THREE.Mesh(
      createShardGeometry(width, height, (random() - 0.5) * 0.7),
      shardMaterial
    );
    const radial = new THREE.Vector3(
      random() - 0.5,
      0.18 + random() * 0.72,
      random() - 0.5
    ).normalize();
    radial.lerp(impactDirection, 0.24).normalize();
    shard.position.set(
      position.x + radial.x * (0.006 + random() * 0.013),
      Math.max(floorY + 0.004, position.y + radial.y * 0.012),
      position.z + radial.z * (0.006 + random() * 0.013)
    );
    shard.rotation.set(
      random() * Math.PI,
      random() * Math.PI,
      random() * Math.PI
    );
    shard.castShadow = true;
    breakState.group.add(shard);

    const burst = 0.12 + random() * 0.24;
    breakState.fragments.push({
      mesh: shard,
      velocity: new THREE.Vector3(
        linearVelocity.x * 0.38 + radial.x * burst,
        Math.abs(linearVelocity.y) * 0.2 + radial.y * burst + 0.035,
        linearVelocity.z * 0.38 + radial.z * burst
      ),
      spin: new THREE.Vector3(
        (random() - 0.5) * 18,
        (random() - 0.5) * 18,
        (random() - 0.5) * 18
      ),
      floorY: floorY + 0.001 + random() * 0.0015,
      settled: false,
    });
  }
}

function createShardGeometry(width, height, skew) {
  const thickness = 0.00065;
  const half = thickness / 2;
  const points = [
    -width * 0.55, -height * 0.35, half,
    width * 0.52, -height * 0.25, half,
    width * skew, height * 0.65, half,
    -width * 0.55, -height * 0.35, -half,
    width * 0.52, -height * 0.25, -half,
    width * skew, height * 0.65, -half,
  ];
  const indices = [
    0, 1, 2,
    5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function updateBreakEffect(dt) {
  breakState.age += dt;
  const spread = 1 - Math.exp(-breakState.age * 7.5);
  if (breakState.albumen) {
    breakState.albumen.scale.set(
      THREE.MathUtils.lerp(0.004, 0.055, spread),
      THREE.MathUtils.lerp(0.004, 0.039, spread),
      1
    );
  }
  if (breakState.yolk) {
    breakState.yolk.scale.set(
      THREE.MathUtils.lerp(0.45, 1.28, spread),
      THREE.MathUtils.lerp(0.28, 0.24, spread),
      THREE.MathUtils.lerp(0.45, 1.08, spread)
    );
  }

  for (const fragment of breakState.fragments) {
    if (fragment.settled) continue;
    fragment.velocity.y -= 9.81 * dt;
    fragment.mesh.position.addScaledVector(fragment.velocity, dt);
    fragment.mesh.rotation.x += fragment.spin.x * dt;
    fragment.mesh.rotation.y += fragment.spin.y * dt;
    fragment.mesh.rotation.z += fragment.spin.z * dt;

    if (fragment.mesh.position.y <= fragment.floorY) {
      fragment.mesh.position.y = fragment.floorY;
      fragment.velocity.y = Math.abs(fragment.velocity.y) * 0.16;
      fragment.velocity.x *= 0.72;
      fragment.velocity.z *= 0.72;
      fragment.spin.multiplyScalar(0.56);
      if (
        fragment.velocity.lengthSq() < 0.0012 &&
        fragment.spin.lengthSq() < 2
      ) {
        fragment.settled = true;
      }
    }
  }

  const dim = THREE.MathUtils.smoothstep(breakState.age, 0.08, 0.9);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(
    NORMAL_EXPOSURE,
    0.82,
    dim
  );
  if (
    !breakState.resultShown &&
    breakState.age >= (REDUCE_MOTION ? 0.55 : SHATTER_RESULT_DELAY)
  ) {
    showShatterResult();
  }
}

function showShatterResult() {
  breakState.resultShown = true;
  mode = "lost";
  resultKicker.textContent =
    `${currentStage().name}　この先 ${breakState.distanceRemaining.toFixed(1)} m`;
  resultTitle.textContent = "割れた。";
  resultMessage.textContent = "厨房は、止まらない。";
  stageBrief.textContent = "";
  retryButton.textContent = "次の卵";
  result.classList.remove("is-stage-clear");
  result.classList.add("is-shatter-result", "is-visible");
  attempt += 1;
  retryButton.focus();
}

function clearBreakEffect() {
  for (const child of [...breakState.group.children]) {
    breakState.group.remove(child);
    child.geometry?.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else {
      child.material?.dispose();
    }
  }
  breakState.fragments = [];
  breakState.albumen = null;
  breakState.yolk = null;
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === "suspended") audioContext.resume();
  return audioContext;
}

function playCrackSound() {
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const length = Math.floor(context.sampleRate * 0.16);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const decay = Math.exp(-index / (context.sampleRate * 0.026));
    samples[index] = (Math.random() * 2 - 1) * decay;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1250;
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(0.16, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  noise.connect(highpass).connect(crackGain).connect(context.destination);
  noise.start(now);

  const thud = context.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(92, now);
  thud.frequency.exponentialRampToValueAtTime(54, now + 0.12);
  const thudGain = context.createGain();
  thudGain.gain.setValueAtTime(0.09, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  thud.connect(thudGain).connect(context.destination);
  thud.start(now);
  thud.stop(now + 0.14);
}

const SURFACE_LABEL = {
  dry: "乾いた床",
  wet: "濡れた床",
  grease: "油の膜",
};

function buildStageDots() {
  stageDots.replaceChildren(...STAGES.map((stage, index) => {
    const dot = document.createElement("span");
    dot.className = "stage-dot";
    if (index < clearedCount) dot.classList.add("is-cleared");
    if (index === stageIndex) dot.classList.add("is-current");
    dot.title = stage.name;
    return dot;
  }));
}

// 撞いた瞬間の音。強さで高さと長さが変わる、短い打撃音。
function playShotSound(power) {
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(210 + power * 120, now);
  oscillator.frequency.exponentialRampToValueAtTime(96, now + 0.09);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.03 + power * 0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.13);
}

// 区画を抜けた合図。達成音で盛り上げず、扉が開く程度の短い二音にする。
function playClearSound() {
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  [
    [392, 0, 0.36],
    [587.33, 0.09, 0.5],
  ].forEach(([frequency, delay, length]) => {
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.055, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + length + 0.02);
  });
}

function updateHud() {
  const stage = currentStage();
  const position = eggBody.translation();
  const linearVelocity = eggBody.linvel();
  const angularVelocity = eggBody.angvel();
  const speed = Math.hypot(linearVelocity.x, linearVelocity.y, linearVelocity.z);
  const angularSpeed = Math.hypot(
    angularVelocity.x,
    angularVelocity.y,
    angularVelocity.z
  );
  const offsetMm = Math.hypot(
    yolkState.position.x,
    yolkState.position.y,
    yolkState.position.z
  ) * 1000;
  const progress = THREE.MathUtils.clamp((position.z / stage.length) * 100, 0, 100);
  progressFill.style.width = `${progress.toFixed(1)}%`;
  const surface = SURFACE_LABEL[surfaceAt(stage, Math.max(0, position.z))] ?? "";
  distanceLabel.textContent =
    `この区画の残り ${Math.max(0, stage.length - position.z).toFixed(1)} m　／　${surface}`;
  physicsReadout.textContent =
    `重心 ${offsetMm.toFixed(1)} mm · 横ずれ ${(position.x * 100).toFixed(1)} cm · 速度 ${speed.toFixed(2)} m/s · 角速度 ${angularSpeed.toFixed(1)} rad/s`;
  zoneName.textContent = `${stageIndex + 1}　${stage.name}`;
  attemptCount.textContent = `${shotsTaken}打　${attempt}個目`;
}

function startGame() {
  ensureAudioContext();
  beginPlay();
  intro.classList.remove("is-visible");
  srStatus.textContent =
    `${currentStage().name}。引いて放つと、黄身が殻を蹴って卵が転がります。`;
}

// 卵と入力と演出だけを再開状態へ戻す。区画そのものは呼び出し側が用意する。
function beginPlay() {
  clearBreakEffect();
  stuckShots = 0;
  settledNoted = true;
  stallHint.classList.remove("is-visible");
  breakState.active = false;
  breakState.age = 0;
  breakState.resultShown = false;
  shellMesh.visible = true;
  yolkMesh.visible = true;
  yolkState.position = { x: 0, y: -YOLK_REST_OFFSET, z: 0 };
  yolkState.velocity = { x: 0, y: 0, z: 0 };
  yolkState.acceleration = { x: 0, y: 0, z: 0 };
  aim.active = false;
  aim.pointerId = null;
  aim.power = 0;
  aim.x = 0;
  aim.z = 1;
  shotCooldown = 0;
  shotsTaken = 0;
  stuckShots = 0;
  progressMark = 0;
  settledNoted = true;
  stallHint.classList.remove("is-visible");
  applyYolkMassProperties();
  mode = "playing";
  playAge = 0;
  accumulator = 0;
  previousTime = performance.now();
  renderer.toneMappingExposure = NORMAL_EXPOSURE;
  gameShell.classList.remove("is-broken");
  result.classList.remove("is-shatter-result", "is-stage-clear", "is-visible");
}

function restartStage() {
  loadStage(stageIndex);
  beginPlay();
  srStatus.textContent = `${currentStage().name}をやり直します。`;
}

function advanceStage() {
  loadStage(stageIndex + 1);
  beginPlay();
  srStatus.textContent = `${currentStage().name}に入りました。`;
}

function restartCourse() {
  attempt = 1;
  clearedCount = 0;
  loadStage(0);
  beginPlay();
  srStatus.textContent = "最初の区画から始めます。";
}

function clearStage() {
  if (mode !== "playing") return;
  const stage = currentStage();
  clearedCount = Math.max(clearedCount, stageIndex + 1);
  buildStageDots();
  playClearSound();

  if (stageIndex >= STAGES.length - 1) {
    win(stage);
    return;
  }

  const next = STAGES[stageIndex + 1];
  mode = "stage-clear";
  result.classList.remove("is-shatter-result");
  result.classList.add("is-stage-clear");
  resultKicker.textContent =
    `${stageIndex + 1} / ${STAGES.length}　${stage.subtitle}　${shotsTaken}打`;
  resultTitle.textContent = stage.clear.title;
  resultMessage.textContent = stage.clear.message;
  stageBrief.textContent = `次は「${next.name}」。${next.brief}`;
  retryButton.textContent = `${next.name}へ`;
  result.classList.add("is-visible");
  retryButton.focus();
  srStatus.textContent = `${stage.name}を抜けました。`;
}

function lose(message) {
  if (mode !== "playing") return;
  mode = "lost";
  attempt += 1;
  result.classList.remove("is-shatter-result", "is-stage-clear");
  resultKicker.textContent = currentStage().name;
  resultTitle.textContent = "転落。";
  resultMessage.textContent = message;
  stageBrief.textContent = "";
  retryButton.textContent = "立て直す";
  result.classList.add("is-visible");
  retryButton.focus();
  srStatus.textContent = message;
}

function win(stage) {
  mode = "won";
  result.classList.remove("is-shatter-result", "is-stage-clear");
  resultKicker.textContent =
    `ESCAPED　${STAGES.length}区画　割れた卵 ${attempt - 1}個`;
  resultTitle.textContent = stage.clear.title;
  resultMessage.textContent = stage.clear.message;
  stageBrief.textContent = "";
  retryButton.textContent = "最初から";
  result.classList.add("is-visible");
  retryButton.focus();
  srStatus.textContent = "厨房から脱出しました。";
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

// 撞く向きは「引いた向きの反対」。ビリヤードのキューを引く感覚に合わせる。
function updateAimFrom(point) {
  const pullX = point.x - aim.originX;
  const pullY = point.y - aim.originY;
  const pull = Math.hypot(pullX, pullY);
  if (pull < AIM_DEAD_ZONE) {
    aim.power = 0;
    return;
  }
  aim.x = -pullX / pull;
  aim.z = pullY / pull;
  aim.power = THREE.MathUtils.clamp(
    (pull - AIM_DEAD_ZONE) / (AIM_FULL_PULL - AIM_DEAD_ZONE),
    0,
    1
  );
}

// 狙いは座標だけで組み立て、ポインタ／タッチのどちらの経路からでも同じ処理へ入る。
// iOS Safari はポインタイベントの取りこぼしが起きやすいため、
// タッチのある端末では touch 系を正として扱う。
function startAim(x, y) {
  if (mode !== "playing") return;
  aim.active = true;
  aim.originX = x;
  aim.originY = y;
  aim.power = 0;
  canvas.classList.add("is-dragging");
}

function dragAim(x, y) {
  if (!aim.active) return;
  updateAimFrom({ x, y });
}

function endAim(x, y, { fire = true } = {}) {
  if (!aim.active) return;
  if (fire && x !== null) updateAimFrom({ x, y });
  const power = aim.power;
  aim.active = false;
  aim.pointerId = null;
  aim.power = 0;
  canvas.classList.remove("is-dragging");
  if (fire && power > 0) fireShot(aim.x, aim.z, power);
}

// 指の操作は touch 系で、マウスとペンは pointer 系で受ける。
// 端末で切り替えるとタッチ対応のノートPCでマウスが効かなくなるため、
// 同じ端末でも「その入力が指かどうか」で振り分ける。
const isTouchPointer = (event) => event.pointerType === "touch";

function touchPoint(touch) {
  const rect = canvas.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function onTouchStart(event) {
  if (mode !== "playing") return;
  event.preventDefault();
  const point = touchPoint(event.changedTouches[0]);
  aim.pointerId = event.changedTouches[0].identifier;
  startAim(point.x, point.y);
}

function findTouch(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === aim.pointerId) return touch;
  }
  return null;
}

function onTouchMove(event) {
  if (!aim.active) return;
  event.preventDefault();
  const touch = findTouch(event);
  if (!touch) return;
  const point = touchPoint(touch);
  dragAim(point.x, point.y);
}

function onTouchEnd(event) {
  if (!aim.active) return;
  event.preventDefault();
  const touch = findTouch(event);
  if (!touch) return;
  const point = touchPoint(touch);
  endAim(point.x, point.y, { fire: event.type === "touchend" });
}

function beginAim(event) {
  if (mode !== "playing" || isTouchPointer(event)) return;
  const point = pointerPosition(event);
  aim.pointerId = event.pointerId;
  startAim(point.x, point.y);
  // 取得できない端末があるので、失敗しても操作は続けられるようにする。
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    /* 取得できなくても、以降のイベントは canvas に届く */
  }
}

function moveAim(event) {
  if (isTouchPointer(event) || !aim.active || event.pointerId !== aim.pointerId) return;
  const point = pointerPosition(event);
  dragAim(point.x, point.y);
}

function releaseAim(event) {
  if (isTouchPointer(event) || !aim.active || event.pointerId !== aim.pointerId) return;
  const point = pointerPosition(event);
  endAim(point.x, point.y, { fire: event.type !== "pointercancel" });
}

function shootWithKey(code) {
  const direction = {
    ArrowUp: [0, 1], KeyW: [0, 1],
    ArrowDown: [0, -1], KeyS: [0, -1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  }[code];
  if (!direction) return false;
  fireShot(direction[0], direction[1], 0.75);
  return true;
}

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

startButton.addEventListener("click", startGame);
retryButton.addEventListener("click", () => {
  if (mode === "won") restartCourse();
  else if (mode === "stage-clear") advanceStage();
  else restartStage();
});
canvas.addEventListener("pointerdown", beginAim);
canvas.addEventListener("pointermove", moveAim);
canvas.addEventListener("pointerup", releaseAim);
canvas.addEventListener("pointercancel", releaseAim);
canvas.addEventListener("touchstart", onTouchStart, { passive: false });
canvas.addEventListener("touchmove", onTouchMove, { passive: false });
canvas.addEventListener("touchend", onTouchEnd, { passive: false });
canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
window.addEventListener("keydown", (event) => {
  if ((event.code === "Space" || event.code === "Enter") && mode === "intro") {
    event.preventDefault();
    startGame();
    return;
  }
  if (event.code === "Enter" && (mode === "stage-clear" || mode === "won")) {
    event.preventDefault();
    if (mode === "won") restartCourse();
    else advanceStage();
    return;
  }
  if (event.code === "KeyR" && mode !== "intro") {
    event.preventDefault();
    restartStage();
    return;
  }
  if (import.meta.env.DEV && event.code === "KeyN" && mode === "playing") {
    event.preventDefault();
    clearStage();
    return;
  }
  if (import.meta.env.DEV && event.code === "KeyB" && mode === "playing") {
    event.preventDefault();
    shatterEgg({
      colliderKind: "debug",
      forceMagnitude: 2,
      speed: 0.5,
      direction: { x: 0.4, y: 0.25, z: -0.8 },
    });
    return;
  }
  if (mode === "playing" && shootWithKey(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  previousTime = performance.now();
  accumulator = 0;
});

window.__EGG_ESCAPE_TEST__ = {
  getState: () => ({
    mode,
    attempt,
    firstInputMade,
    stageId: currentStage().id,
    stageIndex,
    stageCount: STAGES.length,
    clearedCount,
    shotsTaken,
    aimPower: aim.power,
    position: { ...eggBody.translation() },
    rotation: { ...eggBody.rotation() },
    linearVelocity: { ...eggBody.linvel() },
    angularVelocity: { ...eggBody.angvel() },
    yolkPosition: { ...yolkState.position },
    mass: eggBody.mass(),
    localCenterOfMass: { ...eggBody.localCom() },
    breakEffect: {
      active: breakState.active,
      age: breakState.age,
      fragmentCount: breakState.fragments.length,
      resultShown: breakState.resultShown,
    },
  }),
  reset: restartStage,
  goToStage: (index) => {
    loadStage(index);
    beginPlay();
  },
};

resize();
updateHud();
