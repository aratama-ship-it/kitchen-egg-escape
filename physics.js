(function attachEggPhysics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EggPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEggPhysics() {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function releaseFromDrag(dx, dy, shellPhase) {
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 8) return null;

    const pull = clamp(magnitude / 118, 0, 1);
    const speed = 5.4 + pull * 8.6;
    const directionX = dx / magnitude;
    const directionZ = -dy / magnitude;
    const phaseSignal = Math.sin(shellPhase * 1.73 + 0.41);
    const handedness = phaseSignal >= 0 ? 1 : -1;

    return {
      vx: directionX * speed,
      vz: directionZ * speed,
      pull,
      curveBias: handedness * (0.22 + pull * 0.2),
    };
  }

  function stepEgg(state, dt, surface) {
    const next = { ...state };
    const speed = Math.hypot(next.vx, next.vz);
    const safeSurface = surface || {};
    const grip = Number.isFinite(safeSurface.grip) ? safeSurface.grip : 1;
    const irregularity = Number.isFinite(safeSurface.irregularity)
      ? safeSurface.irregularity
      : 1;

    if (speed > 0.015) {
      next.shellPhase += speed * dt * 1.84;

      const forwardX = next.vx / speed;
      const forwardZ = next.vz / speed;
      const sideX = -forwardZ;
      const sideZ = forwardX;
      const wobble =
        Math.sin(next.shellPhase * 2.15) * 0.58 +
        Math.sin(next.shellPhase * 0.74 + 1.1) * 0.17 +
        next.curveBias;
      const lateralAcceleration = wobble * speed * 0.54 * irregularity;

      next.vx += sideX * lateralAcceleration * dt;
      next.vz += sideZ * lateralAcceleration * dt;
    }

    const damping = Math.exp(-1.28 * grip * dt);
    next.vx *= damping;
    next.vz *= damping;
    next.x += next.vx * dt;
    next.z += next.vz * dt;

    if (Math.hypot(next.vx, next.vz) < 0.045) {
      next.vx = 0;
      next.vz = 0;
      next.curveBias *= 0.45;
    }

    return next;
  }

  function circlesOverlap(ax, az, ar, bx, bz, br) {
    const dx = ax - bx;
    const dz = az - bz;
    const radius = ar + br;
    return dx * dx + dz * dz <= radius * radius;
  }

  return {
    clamp,
    releaseFromDrag,
    stepEgg,
    circlesOverlap,
  };
});
