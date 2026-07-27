import * as THREE from "three";

// 実物の卵は殻が全体の約1割。ここを重く見積もると重心移動で転がり出せなくなる。
export const SHELL_MASS = 0.008;
export const EGG_HALF_HEIGHT = 0.032;
export const EGG_MAX_RADIUS = 0.0235;
export const EGG_TAPER = 0.18;
export const EGG_RADIAL_ASYMMETRY = 0.018;

export function eggRadiusAt(normalizedY) {
  const y = THREE.MathUtils.clamp(normalizedY, -1, 1);
  const ellipse = Math.sqrt(Math.max(0, 1 - y * y));
  const taper = 1 - EGG_TAPER * y;
  const shoulder = 1 + 0.055 * (1 - y * y);
  return EGG_MAX_RADIUS * ellipse * taper * shoulder;
}

export function createEggProfile(rings = 32) {
  const profile = [];
  for (let i = 0; i <= rings; i += 1) {
    const normalizedY = -1 + (i / rings) * 2;
    profile.push(new THREE.Vector2(
      eggRadiusAt(normalizedY),
      normalizedY * EGG_HALF_HEIGHT
    ));
  }
  return profile;
}

export function eggAsymmetryFactor(normalizedY, angle) {
  const middleWeight = 0.35 + 0.65 * (1 - normalizedY * normalizedY);
  return 1 + (
    Math.cos(angle + 0.55) * EGG_RADIAL_ASYMMETRY +
    Math.sin(angle * 2 - 0.2) * EGG_RADIAL_ASYMMETRY * 0.35
  ) * middleWeight;
}

export function createEggGeometry(rings = 128, radialSegments = 128) {
  const geometry = new THREE.LatheGeometry(
    createEggProfile(rings),
    radialSegments,
    0,
    Math.PI * 2
  );
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const normalizedY = THREE.MathUtils.clamp(y / EGG_HALF_HEIGHT, -1, 1);
    const factor = eggAsymmetryFactor(normalizedY, angle);
    positions.setXYZ(index, x * factor, y, z * factor);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createEggColliderPoints(rings = 22, radialSegments = 28) {
  const points = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const normalizedY = -1 + (ring / rings) * 2;
    const y = normalizedY * EGG_HALF_HEIGHT;
    const radius = eggRadiusAt(normalizedY);

    if (ring === 0 || ring === rings) {
      points.push(0, y, 0);
      continue;
    }

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const asymmetricRadius = radius * eggAsymmetryFactor(normalizedY, angle);
      points.push(
        Math.cos(angle) * asymmetricRadius,
        y,
        Math.sin(angle) * asymmetricRadius
      );
    }
  }
  return new Float32Array(points);
}
