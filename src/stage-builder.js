import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import {
  SHOE,
  bankRotation,
  beltAt,
  floorRibsOf,
  floorSpans,
  moverCenterX,
  stageColliders,
  toWorld,
  walkerFeetAt,
} from "./stages.js";

export function colliderDescFrom(RapierApi, shape) {
  const desc = shape.shape === "cylinder"
    ? RapierApi.ColliderDesc.cylinder(shape.halfHeight, shape.radius)
    : RapierApi.ColliderDesc.cuboid(
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

const SURFACE_LOOK = {
  dry: { color: 0x3e4a46, roughness: 0.58, metalness: 0.08 },
  wet: { color: 0x2b3a40, roughness: 0.1, metalness: 0.42 },
  grease: { color: 0x413a2d, roughness: 0.28, metalness: 0.26 },
};

const PROP_LOOK = {
  steel: { color: 0x69746f, roughness: 0.26, metalness: 0.72 },
  darkMetal: { color: 0x262d2b, roughness: 0.4, metalness: 0.46 },
  wood: { color: 0x6a5842, roughness: 0.74, metalness: 0.04 },
  hot: {
    color: 0x33211c,
    roughness: 0.52,
    metalness: 0.3,
    emissive: 0xff5a1e,
    emissiveIntensity: 0.42,
  },
};

// ステージのローカル座標（傾いた床の上）で組み立て、
// 描画はグループの回転で、剛体は座標変換で、同じ傾きへ揃える。
export function buildStage(stage, { scene, world }) {
  const group = new THREE.Group();
  const rotation = bankRotation(stage);
  group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  scene.add(group);

  const disposables = [];
  const beltSlats = [];
  const staticColliders = [];
  const movers = [];
  const feetEntries = [];
  const footIndexByHandle = new Map();
  const kinds = new Map();

  const track = (item) => {
    disposables.push(item);
    return item;
  };

  const material = (spec) => track(new THREE.MeshStandardMaterial(spec));

  for (const shape of stageColliders(stage)) {
    const collider = world.createCollider(colliderDescFrom(RAPIER, shape));
    staticColliders.push(collider);
    kinds.set(collider.handle, shape.kind);
  }

  buildFloor();
  buildWalls();
  buildCounters();
  buildCeilingLights();
  buildProps();
  buildMovers();
  buildGate();
  buildBelts();
  buildWalkers();
  buildShelters();
  if (stage.bank) buildBankHint();

  function buildFloor() {
    for (const section of floorSpans(stage)) {
      const depth = section.toZ - section.fromZ;
      const centerZ = (section.fromZ + section.toZ) / 2;
      const look = SURFACE_LOOK[section.surface];

      // 床が抜けている区間は、残っている桟だけを描く。
      for (const [fromX, toX] of floorRibsOf(section, stage.halfWidth)) {
        const plane = new THREE.Mesh(
          track(new THREE.PlaneGeometry(toX - fromX, depth)),
          material(look)
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set((fromX + toX) / 2, section.level, centerZ);
        plane.receiveShadow = true;
        group.add(plane);
      }

      // 段差の立ち上がり。落差があることを side から見せる。
      if (section.level < 0) {
        const riser = new THREE.Mesh(
          track(new THREE.BoxGeometry(stage.halfWidth * 2, -section.level, 0.02)),
          material({ color: 0x232b2a, roughness: 0.7, metalness: 0.1 })
        );
        riser.position.set(0, section.level / 2, section.fromZ);
        riser.receiveShadow = true;
        group.add(riser);
      }

      // 抜けている部分の底。暗い穴として見せる。
      for (const [fromX, toX] of section.slots) {
        const pit = new THREE.Mesh(
          track(new THREE.PlaneGeometry(toX - fromX, depth)),
          track(new THREE.MeshBasicMaterial({ color: 0x080b0c }))
        );
        pit.rotation.x = -Math.PI / 2;
        pit.position.set((fromX + toX) / 2, section.level - 0.09, centerZ);
        group.add(pit);
      }

      if (section.surface === "wet") buildPuddles(section);
      if (section.surface === "grease") buildSheen(section, 0x6d5c33, 0.16);
    }

    // 大きい卵ではカメラが後ろへ下がるので、手前の床が切れて見える。
    // 見た目だけ手前へ伸ばしておく（剛体は区画の範囲のまま）。
    const firstSection = floorSpans(stage)[0];
    const approach = new THREE.Mesh(
      track(new THREE.PlaneGeometry(stage.halfWidth * 2, 2.4)),
      material(SURFACE_LOOK[firstSection.surface])
    );
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(0, -0.0004, -1.2);
    approach.receiveShadow = true;
    group.add(approach);

    const grid = new THREE.GridHelper(
      Math.max(stage.halfWidth * 2, stage.length),
      Math.round(stage.length * 4),
      0x85918b,
      0x5a6661
    );
    grid.position.set(0, 0.0006, stage.length / 2);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    disposables.push(grid.geometry, grid.material);
    group.add(grid);
  }

  // 濡れた区画は色だけでは伝わらないため、水膜の縁を薄い楕円で描いて
  // 「ここから滑る」境界が床の模様として読めるようにする。
  function buildPuddles(section) {
    const filmMaterial = track(new THREE.MeshPhysicalMaterial({
      color: 0xa9c6cd,
      roughness: 0.05,
      metalness: 0.1,
      transmission: 0.55,
      thickness: 0.001,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }));
    const geometry = track(new THREE.CircleGeometry(1, 40));
    const seeds = [
      [-0.42, 0.18, 0.62, 0.9],
      [0.5, 0.46, 0.74, 0.62],
      [-0.1, 0.78, 0.9, 0.7],
      [0.3, 0.94, 0.5, 1.05],
    ];
    for (const [x, atDepth, scaleX, scaleZ] of seeds) {
      const puddle = new THREE.Mesh(geometry, filmMaterial);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(
        x,
        0.0012,
        section.fromZ + (section.toZ - section.fromZ) * atDepth
      );
      puddle.scale.set(scaleX, scaleZ, 1);
      puddle.renderOrder = 1;
      group.add(puddle);
    }
  }

  function buildSheen(section, color, opacity) {
    const sheen = new THREE.Mesh(
      track(new THREE.PlaneGeometry(stage.halfWidth * 1.7, section.toZ - section.fromZ)),
      track(new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }))
    );
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(0, 0.001, (section.fromZ + section.toZ) / 2);
    sheen.renderOrder = 1;
    group.add(sheen);
  }

  function buildWalls() {
    const wallMaterial = material({
      color: 0x293330,
      roughness: 0.65,
      metalness: 0.16,
    });
    const geometry = track(new THREE.BoxGeometry(0.04, 0.26, stage.length + 1.2));
    [-1, 1].forEach((side) => {
      const wall = new THREE.Mesh(geometry, wallMaterial);
      wall.position.set(side * (stage.halfWidth + 0.02), 0.1, stage.length / 2);
      wall.receiveShadow = true;
      group.add(wall);
    });
  }

  function buildCounters() {
    const counterMaterial = material({
      color: 0x69746f,
      roughness: 0.26,
      metalness: 0.72,
    });
    const geometry = track(new THREE.BoxGeometry(0.55, 0.07, stage.length + 1.4));
    [-1, 1].forEach((side) => {
      const counter = new THREE.Mesh(geometry, counterMaterial);
      counter.position.set(side * (stage.halfWidth + 0.3), 0.82, stage.length / 2);
      counter.castShadow = true;
      counter.receiveShadow = true;
      group.add(counter);
    });
  }

  function buildCeilingLights() {
    const lightMaterial = track(new THREE.MeshBasicMaterial({ color: 0xf4efd4 }));
    const geometry = track(new THREE.BoxGeometry(0.72, 0.018, 0.16));
    for (let z = 1; z <= stage.length; z += 2.8) {
      const light = new THREE.Mesh(geometry, lightMaterial);
      light.position.set(0, 1.65, z);
      group.add(light);
    }
  }

  function buildProps() {
    for (const prop of stage.props) {
      const look = material(PROP_LOOK[prop.look] ?? PROP_LOOK.steel);
      if (prop.shape === "cylinder") {
        const mesh = new THREE.Mesh(
          track(new THREE.CylinderGeometry(prop.radius, prop.radius, prop.height, 18)),
          look
        );
        mesh.position.set(prop.x, prop.height / 2, prop.z);
        mesh.castShadow = true;
        group.add(mesh);
      } else {
        const mesh = new THREE.Mesh(
          track(new THREE.BoxGeometry(prop.width, prop.height, prop.depth)),
          look
        );
        mesh.position.set(prop.x, prop.height / 2, prop.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  }

  function buildMovers() {
    for (const mover of stage.movers) {
      const mesh = buildCartMesh(mover);
      group.add(mesh);

      const start = toWorld(stage, moverCenterX(mover, 0), mover.height / 2, mover.z);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc
          .kinematicPositionBased()
          .setTranslation(start.x, start.y, start.z)
          .setRotation(rotation)
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc
          .cuboid(mover.width / 2, mover.height / 2, mover.depth / 2)
          .setFriction(0.5),
        body
      );
      kinds.set(collider.handle, mover.kind);

      movers.push({ definition: mover, mesh, body });
      positionMover(movers[movers.length - 1], 0);
    }
  }

  // 床すれすれの視点では単色の箱が黒い壁にしか見えないため、
  // 天板とキャスターを足して「押されている台車」だと分かる形にする。
  function buildCartMesh(mover) {
    const cart = new THREE.Group();
    const bodyHeight = mover.height * 0.74;

    const body = new THREE.Mesh(
      track(new THREE.BoxGeometry(mover.width, bodyHeight, mover.depth)),
      material({ color: 0x8d968f, roughness: 0.34, metalness: 0.64 })
    );
    body.position.y = mover.height - bodyHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    cart.add(body);

    const top = new THREE.Mesh(
      track(new THREE.BoxGeometry(mover.width * 1.06, 0.022, mover.depth * 1.15)),
      material({ color: 0xb3bcb4, roughness: 0.22, metalness: 0.78 })
    );
    top.position.y = mover.height + 0.012;
    top.castShadow = true;
    cart.add(top);

    const casterMaterial = material({
      color: 0x1c2321,
      roughness: 0.5,
      metalness: 0.3,
    });
    const casterGeometry = track(
      new THREE.CylinderGeometry(0.026, 0.026, 0.016, 12)
    );
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        const caster = new THREE.Mesh(casterGeometry, casterMaterial);
        caster.rotation.z = Math.PI / 2;
        caster.position.set(
          sideX * (mover.width / 2 - 0.05),
          0.026,
          sideZ * (mover.depth / 2 - 0.05)
        );
        caster.castShadow = true;
        cart.add(caster);
      }
    }

    // 支柱は車体と床のあいだを埋める。ここに隙間があると卵が下をくぐれてしまう。
    const post = new THREE.Mesh(
      track(new THREE.BoxGeometry(mover.width * 0.92, mover.height - bodyHeight, mover.depth * 0.6)),
      casterMaterial
    );
    post.position.y = (mover.height - bodyHeight) / 2;
    cart.add(post);

    return cart;
  }

  function positionMover(entry, time) {
    const centerX = moverCenterX(entry.definition, time);
    // 描画は床に立つ台車、剛体は同じ体積の直方体。基準の高さが違う。
    entry.mesh.position.set(centerX, 0, entry.definition.z);
    entry.body.setNextKinematicTranslation(
      toWorld(stage, centerX, entry.definition.height / 2, entry.definition.z)
    );
  }

  function buildGate() {
    const frameMaterial = material({
      color: 0x17211e,
      roughness: 0.4,
      metalness: 0.3,
    });
    const glowMaterial = track(new THREE.MeshStandardMaterial({
      color: 0xcdddc9,
      emissive: 0xbad4b7,
      emissiveIntensity: 1.8,
      roughness: 0.5,
    }));

    const gate = new THREE.Group();
    const top = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.9, 0.08, 0.06)),
      frameMaterial
    );
    top.position.y = 0.92;
    gate.add(top);
    const postGeometry = track(new THREE.BoxGeometry(0.08, 0.96, 0.06));
    [-0.46, 0.46].forEach((x) => {
      const post = new THREE.Mesh(postGeometry, frameMaterial);
      post.position.set(x, 0.46, 0);
      gate.add(post);
    });
    const glow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.82, 0.84)),
      glowMaterial
    );
    glow.position.set(0, 0.47, 0.025);
    gate.add(glow);
    gate.position.z = stage.length + 0.35;
    group.add(gate);

    // 通過線そのものを床に引く。ゲートの奥行きではなく、この線が判定と一致する。
    const line = new THREE.Mesh(
      track(new THREE.PlaneGeometry(stage.halfWidth * 2, 0.035)),
      track(new THREE.MeshBasicMaterial({
        color: 0xf0c94b,
        transparent: true,
        opacity: 0.66,
      }))
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.0018, stage.length);
    line.renderOrder = 2;
    group.add(line);
  }

  // ベルトコンベア。動いていることが一目で分かるよう、
  // 帯の表面に横桟を並べて流す。桟の動きがそのまま流れの向きと速さになる。
  function buildBelts() {
    for (const belt of stage.belts ?? []) {
      const width = belt.toX - belt.fromX;
      const depth = belt.toZ - belt.fromZ;
      const centerX = (belt.fromX + belt.toX) / 2;
      const centerZ = (belt.fromZ + belt.toZ) / 2;

      const deck = new THREE.Mesh(
        track(new THREE.PlaneGeometry(width, depth)),
        material({ color: 0x2f3a3d, roughness: 0.5, metalness: 0.35 })
      );
      deck.rotation.x = -Math.PI / 2;
      deck.position.set(centerX, 0.0035, centerZ);
      deck.receiveShadow = true;
      group.add(deck);

      const slatGeometry = track(new THREE.BoxGeometry(width - 0.02, 0.012, 0.05));
      const slatMaterial = material({
        color: 0x525f63,
        roughness: 0.42,
        metalness: 0.5,
      });
      const spacing = 0.22;
      const count = Math.ceil(depth / spacing) + 1;
      for (let index = 0; index < count; index += 1) {
        const slat = new THREE.Mesh(slatGeometry, slatMaterial);
        slat.position.set(centerX, 0.008, belt.fromZ + index * spacing);
        slat.castShadow = true;
        group.add(slat);
        beltSlats.push({ slat, belt, spacing, count });
      }
    }
  }

  function positionBeltSlats(time) {
    for (const entry of beltSlats) {
      const { belt, spacing } = entry;
      const span = belt.toZ - belt.fromZ;
      // 流れる向きへ動かし、端まで行ったら反対の端へ戻す。
      const drift = ((belt.speedZ * time) % span + span) % span;
      const base = entry.slat.userData.baseZ ?? entry.slat.position.z;
      entry.slat.userData.baseZ = base;
      let z = base + drift;
      if (z > belt.toZ) z -= span;
      if (z < belt.fromZ) z += span;
      entry.slat.position.z = z;
    }
  }

  // 行き交う人の足。床の視点では靴しか見えないので、靴と脚だけを作る。
  function buildWalkers() {
    const feet = walkerFeetAt(stage, 0);
    const shoeMaterial = material({ color: 0x23272a, roughness: 0.55, metalness: 0.08 });
    const trouserMaterial = material({ color: 0x46505a, roughness: 0.8, metalness: 0 });
    const shadowMaterial = track(new THREE.MeshBasicMaterial({
      color: 0x0a0d0c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    const shadowGeometry = track(new THREE.CircleGeometry(0.15, 24));

    feet.forEach((foot, index) => {
      const group2 = new THREE.Group();
      const shoe = new THREE.Mesh(
        track(new THREE.BoxGeometry(SHOE.width, SHOE.height, SHOE.depth)),
        shoeMaterial
      );
      shoe.position.y = SHOE.height / 2;
      shoe.castShadow = true;
      group2.add(shoe);
      const leg = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.052, 0.062, 1.15, 12)),
        trouserMaterial
      );
      leg.position.set(0, SHOE.height + 0.55, -SHOE.depth * 0.18);
      leg.castShadow = true;
      group2.add(leg);
      group.add(group2);

      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial.clone());
      disposables.push(shadow.material);
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 3;
      shadow.visible = false;
      group.add(shadow);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc
          .kinematicPositionBased()
          .setTranslation(...Object.values(toWorld(stage, foot.x, SHOE.height / 2, foot.z)))
          .setRotation(rotation)
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc
          .cuboid(SHOE.width / 2, SHOE.height / 2, SHOE.depth / 2)
          .setFriction(0.6),
        body
      );
      kinds.set(collider.handle, "shoe");
      footIndexByHandle.set(collider.handle, index);
      feetEntries.push({ group: group2, shadow, body });
    });
  }

  function positionFeet(time) {
    if (feetEntries.length === 0) return;
    const feet = walkerFeetAt(stage, time);
    feet.forEach((foot, index) => {
      const entry = feetEntries[index];
      entry.group.position.set(foot.x, foot.lift, foot.z);
      const world3 = toWorld(stage, foot.x, SHOE.height / 2 + foot.lift, foot.z);
      entry.body.setNextKinematicTranslation(world3);

      // 影は次に降りる場所。濃くなるほど着地が近い。
      const telegraph = foot.landingZ !== null && foot.lift > 0.01;
      entry.shadow.visible = telegraph;
      if (telegraph) {
        entry.shadow.position.set(foot.x, 0.0028, foot.landingZ);
        entry.shadow.material.opacity = 0.1 + foot.progress * 0.42;
      }
    });
  }

  // 猫の前足が届かない隙間。床の色と縁で「ここは安全」と読めるようにする。
  function buildShelters() {
    for (const shelter of stage.shelters ?? []) {
      const width = shelter.toX - shelter.fromX;
      const depth = shelter.toZ - shelter.fromZ;
      const centerX = (shelter.fromX + shelter.toX) / 2;
      const centerZ = (shelter.fromZ + shelter.toZ) / 2;

      const floorPatch = new THREE.Mesh(
        track(new THREE.PlaneGeometry(width, depth)),
        track(new THREE.MeshBasicMaterial({
          color: 0x9ccfa8,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        }))
      );
      floorPatch.rotation.x = -Math.PI / 2;
      floorPatch.position.set(centerX, 0.0022, centerZ);
      floorPatch.renderOrder = 2;
      group.add(floorPatch);

      // 縁だけを明るくして、境目がどこかをはっきりさせる。
      const edgeMaterial = track(new THREE.MeshBasicMaterial({
        color: 0xbfe6c6,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }));
      const edges = [
        [width, 0.018, centerX, shelter.fromZ],
        [width, 0.018, centerX, shelter.toZ],
        [0.018, depth, shelter.fromX, centerZ],
        [0.018, depth, shelter.toX, centerZ],
      ];
      for (const [w, d, x, z] of edges) {
        const edge = new THREE.Mesh(
          track(new THREE.PlaneGeometry(w, d)),
          edgeMaterial
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(x, 0.0026, z);
        edge.renderOrder = 3;
        group.add(edge);
      }
    }
  }

  // 傾きは視界の中では気づきにくいので、床の低い側に水の流れる筋を引く。
  function buildBankHint() {
    const stream = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.18, stage.length * 0.86)),
      track(new THREE.MeshBasicMaterial({
        color: 0x9fb6b3,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }))
    );
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(
      -Math.sign(stage.bank) * (stage.halfWidth - 0.16),
      0.0014,
      stage.length / 2
    );
    stream.renderOrder = 1;
    group.add(stream);
  }

  return {
    stage,
    kinds,
    update(time) {
      for (const entry of movers) positionMover(entry, time);
      positionFeet(time);
      positionBeltSlats(time);
    },
    footIndexFor(handle) {
      return footIndexByHandle.get(handle);
    },
    dispose() {
      // 剛体を消すと、それに付いたコライダーも一緒に消える。
      for (const entry of movers) world.removeRigidBody(entry.body);
      for (const entry of feetEntries) world.removeRigidBody(entry.body);
      for (const collider of staticColliders) world.removeCollider(collider, false);
      scene.remove(group);
      group.traverse((child) => {
        if (child.isMesh) child.geometry?.dispose?.();
      });
      for (const item of disposables) item.dispose?.();
      kinds.clear();
    },
  };
}
