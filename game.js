(function startKitchenEggEscape() {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const intro = document.getElementById("intro");
  const result = document.getElementById("result");
  const startButton = document.getElementById("start-button");
  const retryButton = document.getElementById("retry-button");
  const resultKicker = document.getElementById("result-kicker");
  const resultTitle = document.getElementById("result-title");
  const resultMessage = document.getElementById("result-message");
  const progressFill = document.getElementById("progress-fill");
  const distanceLabel = document.getElementById("distance-label");
  const zoneName = document.getElementById("zone-name");
  const attemptCount = document.getElementById("attempt-count");
  const dragHint = document.getElementById("drag-hint");
  const srStatus = document.getElementById("sr-status");
  const physics = window.EggPhysics;

  const WORLD_END = 160;
  const CORRIDOR_HALF_WIDTH = 8;
  const EGG_RADIUS = 0.47;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const checkpoints = [
    { z: 0, x: 0, name: "調理台の下" },
    { z: 56, x: -1.8, name: "洗い場" },
    { z: 108, x: 1.6, name: "配膳通路" },
  ];

  const staticObstacles = [
    { x: -5.3, z: 22, radius: 0.7, type: "leg" },
    { x: 4.7, z: 33, radius: 0.7, type: "leg" },
    { x: -4.8, z: 67, radius: 0.72, type: "leg" },
    { x: 5.2, z: 116, radius: 0.72, type: "leg" },
    { x: -4.6, z: 136, radius: 0.72, type: "leg" },
  ];

  const crossings = [
    { type: "chef", z: 43, period: 7.4, offset: 0.8, direction: 1, speedLabel: "normal" },
    { type: "cart", z: 79, period: 9.8, offset: 4.1, direction: -1, speedLabel: "slow" },
    { type: "chef", z: 101, period: 6.2, offset: 2.6, direction: -1, speedLabel: "quick" },
    { type: "chef", z: 134, period: 5.5, offset: 0.4, direction: 1, speedLabel: "quick" },
    { type: "cart", z: 148, period: 8.2, offset: 5.2, direction: 1, speedLabel: "normal" },
  ];

  const wetZones = [
    { x: -1.5, z: 59, width: 7.5, depth: 16 },
    { x: 3.8, z: 119, width: 5.8, depth: 12 },
  ];

  let width = 960;
  let height = 720;
  let dpr = 1;
  let lastTime = performance.now();
  let elapsed = 0;
  let mode = "intro";
  let attempt = 1;
  let checkpointIndex = 0;
  let cameraShake = 0;
  let splatAmount = 0;
  let firstInputMade = false;
  let audioContext = null;
  let lastFootBeat = -1;

  let egg = freshEgg(checkpoints[0]);
  let drag = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
  };

  function freshEgg(checkpoint) {
    return {
      x: checkpoint.x,
      z: checkpoint.z,
      vx: 0,
      vz: 0,
      shellPhase: checkpoint.z * 0.83 + 0.35,
      curveBias: 0.27,
      visualRoll: 0,
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(320, Math.round(rect.width));
    height = Math.max(420, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) audioContext = new AudioCtor();
    }
    if (audioContext && audioContext.state === "suspended") audioContext.resume();
  }

  function tone(frequency, duration, volume, type, slideTo) {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function startGame() {
    ensureAudio();
    mode = "playing";
    intro.classList.remove("is-visible");
    result.classList.remove("is-visible");
    srStatus.textContent = "脱出開始。画面をドラッグして離すと卵が転がります。";
    canvas.focus();
  }

  function restartFromCheckpoint() {
    mode = "playing";
    result.classList.remove("is-visible");
    splatAmount = 0;
    egg = freshEgg(checkpoints[checkpointIndex]);
    drag.active = false;
    canvas.classList.remove("is-dragging");
    srStatus.textContent = checkpoints[checkpointIndex].name + "から再開しました。";
  }

  function lose(reason) {
    if (mode !== "playing") return;
    mode = "splat";
    splatAmount = 0;
    attempt += 1;
    cameraShake = 12;
    tone(180, 0.16, 0.09, "triangle", 62);
    setTimeout(() => {
      if (mode !== "splat") return;
      resultKicker.textContent = "SPLAT / " + checkpoints[checkpointIndex].name;
      resultTitle.textContent = "ぺしゃ。";
      resultMessage.textContent = reason + "　同じ区画からすぐ再開できます。";
      retryButton.textContent = "すぐ再開";
      result.classList.add("is-visible");
      retryButton.focus();
    }, reducedMotion ? 80 : 620);
    srStatus.textContent = "卵が潰れました。" + reason;
  }

  function win() {
    if (mode !== "playing") return;
    mode = "won";
    tone(392, 0.18, 0.06, "sine", 523);
    setTimeout(() => tone(523, 0.24, 0.05, "sine", 659), 120);
    resultKicker.textContent = "ESCAPED / " + attempt + "個目";
    resultTitle.textContent = "厨房脱出！";
    resultMessage.textContent = "裏口の冷たい空気。卵は、まだ卵のままです。";
    retryButton.textContent = "もう一度逃げる";
    result.classList.add("is-visible");
    retryButton.focus();
    srStatus.textContent = "厨房から脱出しました。";
  }

  function currentSurface() {
    const inWetZone = wetZones.some((zone) =>
      Math.abs(egg.x - zone.x) <= zone.width * 0.5 &&
      Math.abs(egg.z - zone.z) <= zone.depth * 0.5
    );
    return inWetZone
      ? { grip: 0.42, irregularity: 1.38 }
      : { grip: 1, irregularity: 1 };
  }

  function movingHazards(time) {
    const hazards = [];
    crossings.forEach((crossing, crossingIndex) => {
      let progress = ((time + crossing.offset) % crossing.period) / crossing.period;
      if (crossing.direction < 0) progress = 1 - progress;
      const centerX = -12 + progress * 24;
      const gait = Math.sin((time + crossing.offset) * Math.PI * 2.2);

      if (crossing.type === "chef") {
        hazards.push({
          type: "shoe",
          x: centerX - crossing.direction * 0.7,
          z: crossing.z - 0.55,
          radius: 0.9,
          lift: Math.max(0, gait) * 0.36,
          crossingIndex,
        });
        hazards.push({
          type: "shoe",
          x: centerX + crossing.direction * 0.72,
          z: crossing.z + 0.58,
          radius: 0.9,
          lift: Math.max(0, -gait) * 0.36,
          crossingIndex,
        });
      } else {
        hazards.push({
          type: "cart",
          x: centerX,
          z: crossing.z,
          radius: 1.5,
          direction: crossing.direction,
          crossingIndex,
        });
      }
    });
    return hazards;
  }

  function update(dt) {
    elapsed += dt;
    cameraShake *= Math.exp(-8 * dt);

    if (mode === "splat") {
      splatAmount = Math.min(1, splatAmount + dt * 3.3);
      return;
    }
    if (mode !== "playing") return;

    const previous = egg;
    egg = physics.stepEgg(egg, dt, currentSurface());
    const speed = Math.hypot(egg.vx, egg.vz);
    egg.visualRoll += speed * dt * 2.1;

    if (egg.x < -CORRIDOR_HALF_WIDTH + EGG_RADIUS) {
      egg.x = -CORRIDOR_HALF_WIDTH + EGG_RADIUS;
      egg.vx = Math.abs(egg.vx) * 0.42;
      tone(110, 0.05, 0.025, "square");
    } else if (egg.x > CORRIDOR_HALF_WIDTH - EGG_RADIUS) {
      egg.x = CORRIDOR_HALF_WIDTH - EGG_RADIUS;
      egg.vx = -Math.abs(egg.vx) * 0.42;
      tone(110, 0.05, 0.025, "square");
    }
    if (egg.z < checkpoints[checkpointIndex].z - 8) {
      egg.z = checkpoints[checkpointIndex].z - 8;
      egg.vz = Math.abs(egg.vz) * 0.35;
    }

    staticObstacles.forEach((obstacle) => {
      if (physics.circlesOverlap(egg.x, egg.z, EGG_RADIUS, obstacle.x, obstacle.z, obstacle.radius)) {
        const dx = egg.x - obstacle.x;
        const dz = egg.z - obstacle.z;
        const distance = Math.max(0.001, Math.hypot(dx, dz));
        egg.x = obstacle.x + (dx / distance) * (EGG_RADIUS + obstacle.radius);
        egg.z = obstacle.z + (dz / distance) * (EGG_RADIUS + obstacle.radius);
        egg.vx = (dx / distance) * Math.max(2.2, speed * 0.36);
        egg.vz = (dz / distance) * Math.max(2.2, speed * 0.36);
        cameraShake = Math.max(cameraShake, 2.8);
      }
    });

    const hazards = movingHazards(elapsed);
    hazards.forEach((hazard) => {
      if (
        Math.abs(hazard.x) < 10.5 &&
        physics.circlesOverlap(egg.x, egg.z, EGG_RADIUS, hazard.x, hazard.z, hazard.radius)
      ) {
        lose(hazard.type === "cart" ? "配膳ワゴンは止まってくれません。" : "大きな靴が真上から。");
      }
    });

    const closestChef = hazards
      .filter((hazard) => hazard.type === "shoe")
      .sort((a, b) =>
        Math.hypot(egg.x - a.x, egg.z - a.z) -
        Math.hypot(egg.x - b.x, egg.z - b.z)
      )[0];
    if (closestChef) {
      const distance = Math.hypot(egg.x - closestChef.x, egg.z - closestChef.z);
      if (distance < 7) cameraShake = Math.max(cameraShake, (7 - distance) * 0.2);
      const beat = Math.floor((elapsed + closestChef.crossingIndex) * 2.2);
      if (distance < 10 && beat !== lastFootBeat) {
        lastFootBeat = beat;
        tone(54, 0.12, 0.018 + Math.max(0, 10 - distance) * 0.002, "sine", 42);
      }
    }

    if (egg.z > checkpoints[1].z + 2 && checkpointIndex < 1) {
      checkpointIndex = 1;
      srStatus.textContent = "洗い場へ到達。ここが再開地点になりました。";
    }
    if (egg.z > checkpoints[2].z + 2 && checkpointIndex < 2) {
      checkpointIndex = 2;
      srStatus.textContent = "配膳通路へ到達。ここが再開地点になりました。";
    }
    if (egg.z >= WORLD_END) win();

    if (Math.abs(previous.z - egg.z) > 0.03 || Math.abs(previous.x - egg.x) > 0.03) {
      updateHud();
    }
  }

  function updateHud() {
    const progress = physics.clamp((egg.z / WORLD_END) * 100, 0, 100);
    progressFill.style.width = progress.toFixed(1) + "%";
    distanceLabel.textContent = "裏口まで " + Math.max(0, Math.ceil(WORLD_END - egg.z));
    zoneName.textContent =
      egg.z < 52 ? "調理台の下" :
      egg.z < 104 ? "洗い場" :
      egg.z < 144 ? "配膳通路" : "裏口";
    attemptCount.textContent = attempt + "個目";
  }

  function project(x, z, y) {
    const cameraX = egg.x * 0.74;
    const cameraZ = egg.z - 6.4;
    const cameraHeight = 2.7;
    const relZ = Math.max(0.12, z - cameraZ);
    const focal = width * 0.93;
    const horizon = height * 0.245;
    return {
      x: width * 0.5 + ((x - cameraX) * focal) / relZ,
      y: horizon + ((cameraHeight - (y || 0)) * focal) / relZ,
      scale: focal / relZ,
      depth: relZ,
    };
  }

  function polygon(points, fill, stroke, lineWidth) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawKitchen() {
    const horizon = height * 0.245;
    const ceiling = ctx.createLinearGradient(0, 0, 0, horizon + 40);
    ceiling.addColorStop(0, "#7e8983");
    ceiling.addColorStop(0.58, "#404c48");
    ceiling.addColorStop(1, "#1f2927");
    ctx.fillStyle = ceiling;
    ctx.fillRect(0, 0, width, horizon + 55);

    ctx.fillStyle = "rgba(241, 234, 200, 0.38)";
    const lightWidth = Math.max(80, width * 0.15);
    for (let i = -1; i < 6; i += 1) {
      ctx.fillRect(i * width * 0.23 + elapsed * 4 % (width * 0.23), 18, lightWidth, 8);
    }

    const nearZ = egg.z - 3.2;
    const farZ = egg.z + 128;
    const floor = ctx.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, "#3c4844");
    floor.addColorStop(0.42, "#26312f");
    floor.addColorStop(1, "#111817");
    polygon([
      project(-CORRIDOR_HALF_WIDTH, nearZ, 0),
      project(-CORRIDOR_HALF_WIDTH, farZ, 0),
      project(CORRIDOR_HALF_WIDTH, farZ, 0),
      project(CORRIDOR_HALF_WIDTH, nearZ, 0),
    ], floor);

    ctx.save();
    polygon([
      project(-CORRIDOR_HALF_WIDTH, nearZ, 0),
      project(-CORRIDOR_HALF_WIDTH, farZ, 0),
      project(CORRIDOR_HALF_WIDTH, farZ, 0),
      project(CORRIDOR_HALF_WIDTH, nearZ, 0),
    ]);
    ctx.clip();

    ctx.strokeStyle = "rgba(206, 218, 211, 0.12)";
    ctx.lineWidth = 1;
    [-8, -4, 0, 4, 8].forEach((x) => {
      const a = project(x, nearZ, 0);
      const b = project(x, farZ, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    const firstGrid = Math.floor((egg.z - 2) / 6) * 6;
    for (let z = firstGrid; z < egg.z + 128; z += 6) {
      const left = project(-CORRIDOR_HALF_WIDTH, z, 0);
      const right = project(CORRIDOR_HALF_WIDTH, z, 0);
      if (left.depth < 1) continue;
      ctx.globalAlpha = physics.clamp(1 - left.depth / 135, 0.08, 0.6);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    wetZones.forEach(drawWetZone);
    ctx.restore();

    drawSideCounters(nearZ, farZ);
    drawExit();
  }

  function drawWetZone(zone) {
    const p1 = project(zone.x - zone.width / 2, zone.z - zone.depth / 2, 0.01);
    const p2 = project(zone.x - zone.width / 2, zone.z + zone.depth / 2, 0.01);
    const p3 = project(zone.x + zone.width / 2, zone.z + zone.depth / 2, 0.01);
    const p4 = project(zone.x + zone.width / 2, zone.z - zone.depth / 2, 0.01);
    if (p1.depth < 0.5 || p2.depth > 150) return;
    polygon([p1, p2, p3, p4], "rgba(150, 190, 191, 0.13)", "rgba(201, 232, 226, 0.18)", 1);
    const glintA = project(zone.x - zone.width * 0.25, zone.z, 0.012);
    const glintB = project(zone.x + zone.width * 0.22, zone.z, 0.012);
    ctx.strokeStyle = "rgba(220, 242, 236, 0.2)";
    ctx.beginPath();
    ctx.moveTo(glintA.x, glintA.y);
    ctx.lineTo(glintB.x, glintB.y);
    ctx.stroke();
  }

  function drawSideCounters(nearZ, farZ) {
    const metal = "#596661";
    const metalDark = "#26302e";
    [-1, 1].forEach((side) => {
      const inner = side * (CORRIDOR_HALF_WIDTH + 0.35);
      const outer = side * 15;
      polygon([
        project(inner, nearZ, 0),
        project(inner, farZ, 0),
        project(inner, farZ, 2.8),
        project(inner, nearZ, 2.8),
      ], metalDark);
      polygon([
        project(inner, nearZ, 2.8),
        project(inner, farZ, 2.8),
        project(outer, farZ, 2.8),
        project(outer, nearZ, 2.8),
      ], metal);
    });
  }

  function drawExit() {
    const z = WORLD_END + 3;
    const leftBottom = project(-3.2, z, 0);
    const rightBottom = project(3.2, z, 0);
    const rightTop = project(3.2, z, 6);
    const leftTop = project(-3.2, z, 6);
    if (leftBottom.depth > 150) return;
    polygon([leftBottom, rightBottom, rightTop, leftTop], "#18201f", "rgba(239, 238, 216, 0.65)", 1);
    const glow = ctx.createRadialGradient(
      (leftBottom.x + rightBottom.x) / 2,
      (leftTop.y + leftBottom.y) / 2,
      2,
      (leftBottom.x + rightBottom.x) / 2,
      (leftTop.y + leftBottom.y) / 2,
      Math.max(20, rightBottom.x - leftBottom.x)
    );
    glow.addColorStop(0, "rgba(219, 233, 214, 0.52)");
    glow.addColorStop(1, "rgba(219, 233, 214, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(leftTop.x - 20, leftTop.y - 20, rightTop.x - leftTop.x + 40, leftBottom.y - leftTop.y + 40);
  }

  function drawStaticObstacle(obstacle) {
    const base = project(obstacle.x, obstacle.z, 0);
    if (base.depth < 1 || base.depth > 138) return;
    const top = project(obstacle.x, obstacle.z, 3.2);
    const radius = Math.max(2, obstacle.radius * base.scale);
    const gradient = ctx.createLinearGradient(base.x - radius, 0, base.x + radius, 0);
    gradient.addColorStop(0, "#202927");
    gradient.addColorStop(0.48, "#78847e");
    gradient.addColorStop(1, "#1f2927");
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.beginPath();
    ctx.ellipse(base.x + radius * 0.28, base.y + 2, radius * 1.1, radius * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gradient;
    ctx.fillRect(base.x - radius * 0.58, top.y, radius * 1.16, base.y - top.y);
  }

  function drawShoe(hazard) {
    const base = project(hazard.x, hazard.z, hazard.lift);
    if (base.depth < 1 || base.depth > 138 || Math.abs(hazard.x) > 12) return;
    const ground = project(hazard.x, hazard.z, 0);
    const shoeW = Math.max(3, hazard.radius * base.scale * 1.75);
    const shoeH = Math.max(2, hazard.radius * base.scale * 0.62);
    const legTop = project(hazard.x, hazard.z, 5.2 + hazard.lift);

    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y + 2, shoeW * 0.72, shoeH * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    const legGradient = ctx.createLinearGradient(base.x - shoeW / 2, 0, base.x + shoeW / 2, 0);
    legGradient.addColorStop(0, "#2b302d");
    legGradient.addColorStop(0.5, "#6e756e");
    legGradient.addColorStop(1, "#202521");
    ctx.fillStyle = legGradient;
    ctx.fillRect(base.x - shoeW * 0.24, legTop.y, shoeW * 0.48, base.y - legTop.y);

    const shoeGradient = ctx.createLinearGradient(0, base.y - shoeH, 0, base.y + shoeH);
    shoeGradient.addColorStop(0, "#282b28");
    shoeGradient.addColorStop(1, "#080a09");
    ctx.fillStyle = shoeGradient;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y - shoeH * 0.35, shoeW * 0.55, shoeH * 0.52, -0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCart(hazard) {
    const base = project(hazard.x, hazard.z, 0);
    if (base.depth < 1 || base.depth > 138 || Math.abs(hazard.x) > 13) return;
    const scale = base.scale;
    const halfW = 2.15 * scale;
    const deckY = project(hazard.x, hazard.z, 2.2).y;
    ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 3, halfW * 0.78, Math.max(2, 0.35 * scale), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#747f7a";
    ctx.fillRect(base.x - halfW, deckY, halfW * 2, Math.max(4, 0.24 * scale));
    ctx.strokeStyle = "#87928c";
    ctx.lineWidth = Math.max(1, 0.13 * scale);
    [-1.45, 1.45].forEach((offset) => {
      ctx.beginPath();
      ctx.moveTo(base.x + offset * scale, deckY);
      ctx.lineTo(base.x + offset * scale, base.y);
      ctx.stroke();
      ctx.fillStyle = "#101312";
      ctx.beginPath();
      ctx.arc(base.x + offset * scale, base.y, Math.max(2, 0.36 * scale), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawEgg() {
    const p = project(egg.x, egg.z, 0);
    const speed = Math.hypot(egg.vx, egg.vz);
    const baseRadius = Math.min(height * 0.105, Math.max(30, EGG_RADIUS * p.scale));
    const wobble = Math.sin(egg.shellPhase * 2.2) * Math.min(0.16, speed * 0.014);
    const lift = Math.abs(Math.sin(egg.visualRoll)) * Math.min(5, speed * 0.32);
    const drawX = p.x + (Math.random() - 0.5) * cameraShake;
    const drawY = p.y - lift + (Math.random() - 0.5) * cameraShake;

    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.beginPath();
    ctx.ellipse(drawX, p.y + baseRadius * 0.12, baseRadius * 0.9, baseRadius * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(drawX, drawY - baseRadius * 0.88);
    ctx.rotate(wobble + Math.sin(egg.visualRoll) * 0.035);
    const shellGradient = ctx.createRadialGradient(
      -baseRadius * 0.3,
      -baseRadius * 0.45,
      baseRadius * 0.08,
      0,
      0,
      baseRadius * 1.25
    );
    shellGradient.addColorStop(0, "#fffdf1");
    shellGradient.addColorStop(0.48, "#e9e3d0");
    shellGradient.addColorStop(0.84, "#c8c0aa");
    shellGradient.addColorStop(1, "#8d877b");
    ctx.fillStyle = shellGradient;
    ctx.beginPath();
    ctx.moveTo(0, -baseRadius * 1.08);
    ctx.bezierCurveTo(
      baseRadius * 0.62,
      -baseRadius * 0.72,
      baseRadius * 0.72,
      baseRadius * 0.62,
      0,
      baseRadius * 0.88
    );
    ctx.bezierCurveTo(
      -baseRadius * 0.72,
      baseRadius * 0.62,
      -baseRadius * 0.62,
      -baseRadius * 0.72,
      0,
      -baseRadius * 1.08
    );
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
    ctx.lineWidth = Math.max(1, baseRadius * 0.025);
    ctx.stroke();

    if (drag.active) {
      const maxPull = 118;
      const yolkX = physics.clamp(drag.dx / maxPull, -1, 1) * baseRadius * 0.3;
      const yolkY = physics.clamp(drag.dy / maxPull, -1, 1) * baseRadius * 0.24;
      const yolkGradient = ctx.createRadialGradient(
        yolkX - baseRadius * 0.08,
        yolkY - baseRadius * 0.08,
        1,
        yolkX,
        yolkY,
        baseRadius * 0.31
      );
      yolkGradient.addColorStop(0, "rgba(255, 236, 106, 0.95)");
      yolkGradient.addColorStop(1, "rgba(224, 151, 16, 0.82)");
      ctx.fillStyle = yolkGradient;
      ctx.beginPath();
      ctx.arc(yolkX, yolkY, baseRadius * 0.29, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(244, 239, 217, 0.2)";
      ctx.fill();
    }
    ctx.restore();

    if (drag.active) drawDragVector(drawX, drawY - baseRadius * 0.88, baseRadius);
  }

  function drawDragVector(originX, originY, baseRadius) {
    const magnitude = Math.min(118, Math.hypot(drag.dx, drag.dy));
    if (magnitude < 4) return;
    const nx = drag.dx / Math.max(1, Math.hypot(drag.dx, drag.dy));
    const ny = drag.dy / Math.max(1, Math.hypot(drag.dx, drag.dy));
    const length = Math.min(baseRadius * 1.25, magnitude * 0.42);
    ctx.strokeStyle = "rgba(240, 201, 75, 0.78)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + nx * length, originY + ny * length);
    ctx.stroke();
    ctx.fillStyle = "#f0c94b";
    ctx.beginPath();
    ctx.arc(originX + nx * length, originY + ny * length, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSplat() {
    if (splatAmount <= 0) return;
    const p = project(egg.x, egg.z, 0);
    const size = Math.min(width, height) * (0.12 + splatAmount * 0.45);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1.4, 0.58);
    ctx.fillStyle = "rgba(241, 238, 217, 0.9)";
    ctx.beginPath();
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const jagged = i % 2 === 0 ? 1 : 0.67;
      const radius = size * jagged * (0.88 + Math.sin(i * 3.7) * 0.08);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(232, 172, 29, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawKitchen();

    const drawables = [];
    staticObstacles.forEach((obstacle) => drawables.push({ z: obstacle.z, kind: "static", value: obstacle }));
    movingHazards(elapsed).forEach((hazard) => drawables.push({ z: hazard.z, kind: hazard.type, value: hazard }));
    drawables
      .filter((item) => item.z > egg.z - 5 && item.z < egg.z + 140)
      .sort((a, b) => b.z - a.z)
      .forEach((item) => {
        if (item.kind === "static") drawStaticObstacle(item.value);
        else if (item.kind === "shoe") drawShoe(item.value);
        else drawCart(item.value);
      });

    if (mode !== "splat" || splatAmount < 0.23) drawEgg();
    drawSplat();

    if (cameraShake > 0.2) {
      ctx.fillStyle = "rgba(255, 255, 255, " + Math.min(0.035, cameraShake * 0.002) + ")";
      ctx.fillRect(0, 0, width, height);
    }
  }

  function loop(now) {
    const dt = Math.min(0.034, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function beginDrag(event) {
    if (mode !== "playing") return;
    ensureAudio();
    const point = pointerPosition(event);
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.startX = point.x;
    drag.startY = point.y;
    drag.dx = 0;
    drag.dy = 0;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
  }

  function moveDrag(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const point = pointerPosition(event);
    drag.dx = physics.clamp(point.x - drag.startX, -118, 118);
    drag.dy = physics.clamp(point.y - drag.startY, -118, 118);
  }

  function endDrag(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const release = physics.releaseFromDrag(drag.dx, drag.dy, egg.shellPhase);
    if (release) {
      egg.vx = egg.vx * 0.26 + release.vx;
      egg.vz = egg.vz * 0.26 + release.vz;
      egg.curveBias = release.curveBias;
      tone(96 + release.pull * 58, 0.075, 0.026, "triangle", 72);
      firstInputMade = true;
      dragHint.classList.add("is-hidden");
    }
    drag.active = false;
    drag.pointerId = null;
    canvas.classList.remove("is-dragging");
  }

  function keyboardRoll(event) {
    if (mode !== "playing") return;
    const vectors = {
      ArrowUp: [0, -88],
      KeyW: [0, -88],
      ArrowDown: [0, 88],
      KeyS: [0, 88],
      ArrowLeft: [-88, -22],
      KeyA: [-88, -22],
      ArrowRight: [88, -22],
      KeyD: [88, -22],
    };
    const vector = vectors[event.code];
    if (!vector) return;
    event.preventDefault();
    ensureAudio();
    const release = physics.releaseFromDrag(vector[0], vector[1], egg.shellPhase);
    if (!release) return;
    egg.vx = egg.vx * 0.26 + release.vx;
    egg.vz = egg.vz * 0.26 + release.vz;
    egg.curveBias = release.curveBias;
    firstInputMade = true;
    dragHint.classList.add("is-hidden");
    tone(118, 0.07, 0.022, "triangle", 76);
  }

  startButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", () => {
    if (mode === "won") {
      checkpointIndex = 0;
      attempt = 1;
    }
    restartFromCheckpoint();
  });
  canvas.addEventListener("pointerdown", beginDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  window.addEventListener("keydown", (event) => {
    if ((event.code === "Space" || event.code === "Enter") && mode === "intro") {
      startGame();
      return;
    }
    if ((event.code === "Space" || event.code === "Enter") && (mode === "splat" || mode === "won")) {
      if (mode === "won") {
        checkpointIndex = 0;
        attempt = 1;
      }
      restartFromCheckpoint();
      return;
    }
    keyboardRoll(event);
  });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    lastTime = performance.now();
  });

  window.__EGG_ESCAPE_TEST__ = {
    getState: () => ({
      mode,
      attempt,
      checkpointIndex,
      firstInputMade,
      egg: { ...egg },
    }),
    start: startGame,
    restart: restartFromCheckpoint,
    simulateDrag: (dx, dy) => {
      const release = physics.releaseFromDrag(dx, dy, egg.shellPhase);
      if (!release) return false;
      egg.vx = release.vx;
      egg.vz = release.vz;
      egg.curveBias = release.curveBias;
      firstInputMade = true;
      return true;
    },
    movingHazards: () => movingHazards(elapsed),
  };

  resize();
  updateHud();
  requestAnimationFrame(loop);
})();
