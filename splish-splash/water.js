import * as THREE from 'three/webgpu';
import { Fn, If, Loop, Break, uniform, float, uint, int, vec2, vec3, vec4, ivec3,
  instanceIndex, instancedArray, atomicStore, atomicAdd, atomicLoad,
  exp, dot, normalize, length, max, min, clamp, floor, cos, pow, mix,
  texture, texture3D, storageTexture3D, uv, refract, reflect, smoothstep,
  atan, acos } from 'three/tsl';

// The field comes entirely from the simulated particles, not a torus mesh.
export async function createWater(renderer, camera, positions, mass, hue, particleCount, densities) {
  const NX = 224, NY = 224, NZ = 128, STEP = 8 / 150;
  const SIZE = NX * NY * NZ, FIXED = 262144, SIGMA = 0.105;
  const extent = vec3(NX * STEP, NY * STEP, NZ * STEP);
  const half = extent.mul(0.5);
  const accumulation = instancedArray(SIZE, 'uint').toAtomic();
  const volume = new THREE.Storage3DTexture(NX, NY, NZ);
  volume.type = THREE.HalfFloatType;
  volume.format = THREE.RGBAFormat;
  volume.minFilter = volume.magFilter = THREE.LinearFilter;
  const index = Fn(([c]) => uint(c.x.add(c.y.mul(NX)).add(c.z.mul(NX * NY))));
  const clear = Fn(() => { atomicStore(accumulation.element(instanceIndex), uint(0)); })().compute(SIZE).setName('Clear liquid reconstruction volume');
  const splat = Fn(() => {
    const p = positions.element(instanceIndex).xyz.toVar();
    const cell = ivec3(floor(p.add(half).div(STEP))).toVar();
    // Broad overlapping kernels reconstruct connected splash sheets. Do not shrink
    // sparse particles into individually visible glass beads.
    const sigma = mix(float(0.075), float(SIGMA), smoothstep(0.12, 0.65, densities.element(instanceIndex))).toVar();
    Loop({ start: -4, end: 5, type: 'int', name: 'z' }, ({ z }) => {
      Loop({ start: -4, end: 5, type: 'int', name: 'y' }, ({ y }) => {
        Loop({ start: -4, end: 5, type: 'int', name: 'x' }, ({ x }) => {
          const c = cell.add(ivec3(x, y, z)).toVar();
          If(c.x.greaterThanEqual(0).and(c.x.lessThan(NX)).and(c.y.greaterThanEqual(0)).and(c.y.lessThan(NY)).and(c.z.greaterThanEqual(0)).and(c.z.lessThan(NZ)), () => {
            const delta = vec3(c).add(0.5).mul(STEP).sub(half).sub(p).toVar();
            const w = exp(dot(delta, delta).mul(-0.5).div(sigma.mul(sigma))).mul(mass).mul(FIXED / Math.pow(2 * Math.PI, 1.5)).div(sigma.mul(sigma).mul(sigma));
            atomicAdd(accumulation.element(index(c)), uint(w));
          });
        });
      });
    });
  })().compute(particleCount).setName('Splat Gaussian particle density');
  const resolve = Fn(() => {
    const c = ivec3(int(instanceIndex.mod(NX)), int(instanceIndex.div(NX).mod(NY)), int(instanceIndex.div(NX * NY)));
    const read = cell => float(atomicLoad(accumulation.element(index(ivec3(clamp(cell, ivec3(0), ivec3(NX - 1, NY - 1, NZ - 1))))))).div(FIXED);
    const rho = read(c);
    // Store the gradient as well as density. Interpolating these gradients
    // produces smoother refractive normals than differentiating a trilinear field.
    const gradient = vec3(
      read(c.sub(ivec3(1, 0, 0))).sub(read(c.add(ivec3(1, 0, 0)))),
      read(c.sub(ivec3(0, 1, 0))).sub(read(c.add(ivec3(0, 1, 0)))),
      read(c.sub(ivec3(0, 0, 1))).sub(read(c.add(ivec3(0, 0, 1))))
    ).div(2 * STEP);
    storageTexture3D(volume, c, vec4(rho, gradient)).toWriteOnly().toStack();
  })().compute(SIZE).setName('Resolve filterable 3D liquid density');

  const studio = await new THREE.TextureLoader().loadAsync('./assets/environment.png');
  // Keep the established water colour response when sampling the supplied panorama.
  studio.colorSpace = THREE.NoColorSpace;
  studio.minFilter = studio.magFilter = THREE.LinearFilter;
  studio.generateMipmaps = false;
  studio.wrapS = THREE.RepeatWrapping;
  const inverseProjection = uniform(camera.projectionMatrixInverse.clone());
  const cameraWorld = uniform(camera.matrixWorld.clone());
  const eye = uniform(camera.position.clone());
  const colourStrength = uniform(0.75);
  const showStudio = uniform(1);
  const field = Fn(([p]) => texture3D(volume, p.add(half).div(extent)).level(0).r);
  const normalAt = Fn(([p]) => normalize(texture3D(volume, p.add(half).div(extent)).level(0).gba.add(vec3(1e-7))));
  const env = Fn(([direction]) => {
    const d = normalize(direction);
    // The source simulation is Z-up. Rotate the environment to Three's Y-up.
    const original = vec3(d.x, d.z.negate(), d.y);
    const coord = vec2(atan(original.x, original.y).div(Math.PI * 2).add(0.5), acos(clamp(original.z.negate(), -1, 1)).div(Math.PI));
    // Preserve the original PNG values for the visible panorama.
    return texture(studio, coord).level(0).rgb;
  });
  const thickness = Fn(([origin, direction]) => {
    const result = float(0).toVar();
    Loop(48, ({ i }) => {
      const p = origin.add(direction.mul(float(i).add(0.5).mul(0.12)));
      result.addAssign(smoothstep(0.16, 0.2, field(p)).mul(0.12));
    });
    return result;
  });
  const lightDirection = normalize(vec3(3, 2, -4));
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  material.toneMapped = false;
  material.fragmentNode = Fn(() => {
    const clip = inverseProjection.mul(vec4(vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2))), 1, 1));
    const direction = normalize(cameraWorld.mul(vec4(normalize(clip.xyz.div(clip.w)), 0)).xyz).toVar();
    const background = env(direction).toVar();
    const result = mix(vec3(0.012, 0.02, 0.027), background, showStudio).toVar();
    // Ray/AABB interval limits primary tracing to the reconstruction volume.
    const inverse = float(1).div(direction).toVar();
    const a = half.negate().sub(eye).mul(inverse).toVar();
    const b = half.sub(eye).mul(inverse).toVar();
    const near3 = min(a, b), far3 = max(a, b);
    const near = max(max(near3.x, near3.y), max(near3.z, 0)).toVar();
    const far = min(min(far3.x, far3.y), far3.z).toVar();
    If(far.greaterThan(near), () => {
      const travel = near.toVar();
      const hit = float(0).toVar();
      const previous = near.toVar();
      Loop(256, () => {
        If(travel.greaterThan(far), () => { Break(); });
        const rho = field(eye.add(direction.mul(travel))).toVar();
        If(rho.greaterThan(0.2), () => { hit.assign(1); Break(); });
        previous.assign(travel);
        travel.addAssign(mix(float(0.075), float(0.03), smoothstep(0.005, 0.15, rho)));
      });
      If(hit.greaterThan(0), () => {
        // Sub-voxel surface intersection removes the appearance of beads.
        Loop(5, () => {
          const middle = previous.add(travel).mul(0.5).toVar();
          If(field(eye.add(direction.mul(middle))).greaterThan(0.2), () => { travel.assign(middle); }).Else(() => { previous.assign(middle); });
        });
        const p = eye.add(direction.mul(travel)).toVar();
        const n = normalAt(p).toVar();
        const view = direction.negate();
        // Exact source hue functions: a = 2*pi*hue + 4; albedo / absorb.
        const palette = cos(vec3(0, 2, 4).add(hue.mul(Math.PI * 2).add(4))).toVar();
        const albedo = palette.mul(0.03).add(0.03);
        const absorb = palette.mul(0.08).add(0.92);
        const absorption = float(1).sub(absorb).mul(0.5 * 18).mul(colourStrength);
        const ndotl = max(dot(n, lightDirection), 0.002).toVar();
        const shadowThickness = thickness(p.add(n.mul(0.04)), lightDirection).mul(18).toVar();
        const shadow = exp(shadowThickness.negate());
        const ambient = exp(shadowThickness.mul(-0.3)).mul(0.5).mul(ndotl.mul(0.7).add(0.3));
        const insideDirection = refract(direction, n, 1 / 1.33).toVar();
        const rayOrigin = p.add(insideDirection.mul(0.04)).toVar();
        const rayDirection = insideDirection.toVar();
        const distanceInside = float(0).toVar();
        const distanceAlong = float(0).toVar();
        const bounced = float(0).toVar();
        const lastDensity = float(1).toVar();
        // Exit-surface refraction and one total-internal-reflection fallback,
        // corresponding to trace_dens_medium / refractFull in the original.
        Loop(100, () => {
          const q = rayOrigin.add(rayDirection.mul(distanceAlong)).toVar();
          const rho = field(q).toVar();
          distanceInside.addAssign(smoothstep(0.18, 0.22, rho).mul(0.055));
          If(lastDensity.greaterThan(0.2).and(rho.lessThan(0.2)).and(bounced.equal(0)).and(distanceAlong.greaterThan(0.08)), () => {
            const exitNormal = normalAt(q).negate().toVar();
            const transmitted = refract(rayDirection, exitNormal, 1.3).toVar();
            If(length(transmitted).lessThan(0.5), () => { rayDirection.assign(reflect(rayDirection, exitNormal)); }).Else(() => { rayDirection.assign(transmitted); });
            rayOrigin.assign(q); distanceAlong.assign(0); bounced.assign(1);
          });
          lastDensity.assign(rho); distanceAlong.addAssign(0.055);
        });
        const refraction = env(rayDirection).mul(0.5).mul(exp(absorption.mul(distanceInside).negate()));
        const reflected = reflect(direction, n).toVar();
        const reflection = env(reflected).mul(0.5).mul(exp(absorption.mul(thickness(p.add(n.mul(0.04)), reflected)).negate()));
        const a = 0.01;
        const h = max(dot(normalize(view.add(lightDirection)), n), 0);
        const denom = h.mul(h).mul(a - 1).add(1);
        const specular = float(a).div(denom.mul(denom).mul(Math.PI));
        const fresnel = pow(float(1).sub(max(dot(view, n), 0)), 5).mul(0.96).add(0.04);
        result.assign(mix(albedo.mul(ambient.add(shadow.mul(ndotl).div(Math.PI))).add(refraction), vec3(shadow.mul(specular)).add(reflection), fresnel));
        // Apply the original water response only to liquid pixels.
        // The background bypasses this brightening curve.
        result.mulAssign(float(1.2).div(result.add(0.2)));
        result.assign(result.mul(result).mul(1.5));
      });
    });
    return vec4(result, 1);
  })();
  const quad = new THREE.QuadMesh(material);
  const render = () => quad.render(renderer);
  function update(rebuild = true) {
    camera.updateMatrixWorld();
    inverseProjection.value.copy(camera.projectionMatrixInverse);
    cameraWorld.value.copy(camera.matrixWorld);
    eye.value.copy(camera.position);
    if (rebuild) renderer.compute([clear, splat, resolve]);
  }
  return { setParticleCount: count => { splat.count = count; }, update, render, colourStrength, showStudio, volume, material };
}

