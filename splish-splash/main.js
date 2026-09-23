
// See README.md for the deliberate changes from the clustered WebGL solver.
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, uniform, float, uint, vec3, vec4, ivec3,
  instanceIndex, instancedArray, atomicStore, atomicAdd, atomicLoad,
  sin, cos, exp, sqrt, dot, cross, normalize, length, max, min, clamp,
  floor, fract, hash, smoothstep } from 'three/tsl';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createWater } from './water.js';
import { Pane } from 'tweakpane';

const $ = id => document.getElementById(id);
const notice = document.querySelector('#loader .loading-text');
let renderer;
function fail(error) {
  console.error(error);
  $('loader').classList.remove('hidden');
  document.querySelector('#loader .spinner').style.display = 'none';
  notice.textContent = `Unable to run the WebGPU simulation.\n${error.message || error}\nUse a WebGPU-capable browser on localhost or HTTPS.`;
  $('backend').textContent = 'WEBGPU UNAVAILABLE';
  renderer?.setAnimationLoop(null);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

async function main() {
  if (THREE.REVISION !== '186') throw new Error(`Expected Three.js r186, got r${THREE.REVISION}`);
  if (!navigator.gpu) throw new Error('navigator.gpu is unavailable.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMappingExposure = 0.9;
  document.body.prepend(renderer.domElement);
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('A native WebGPU backend is required.');
  renderer.backend.device.lost.then(info => fail(new Error(`WebGPU device lost: ${info.message}`)));
  renderer.backend.device.addEventListener('uncapturederror', e => fail(e.error));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#080e13');
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0.7, 1.2, innerWidth < 1100 ? 17.8 : 14.8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0.65, 0, 0);
  controls.minDistance = 7;
  controls.maxDistance = 24;
  controls.autoRotateSpeed = 0.45;
  function setViewAngle(degrees) {
    const ratio = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      Math.tan(THREE.MathUtils.degToRad(degrees / 2));
    camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
    controls.minDistance *= ratio;
    controls.maxDistance *= ratio;
    camera.fov = degrees;
    camera.updateProjectionMatrix();
    controls.update();
  }
  setViewAngle(75);
  // Startup composition matched to the supplied courtyard/turquoise-tower view.
  const startYaw = -2.4088, startPitch = -0.1964, startDistance = 9.5;
  const startForward = new THREE.Vector3(
    Math.sin(startYaw) * Math.cos(startPitch), Math.sin(startPitch),
    -Math.cos(startYaw) * Math.cos(startPitch));
  camera.position.copy(controls.target).addScaledVector(startForward, -startDistance);
  controls.update();

  let N = 32768;
  const MAX_PARTICLES = 98304;
  const activeCount = uniform(N);
  const separationDistance = uniform(0.0535 * Math.cbrt(49152 / N));
  const G = 50, CELL = 0.24, CAP = 512, CELLS = G ** 3;
  const TAU = Math.PI * 2, SIGMA = 0.09;
  const dt = uniform(1 / 120), speed = uniform(5.85), viscosity = uniform(3);
  const radius = uniform(0.57), hue = uniform(300 / 360);
  const simulationTime = uniform(0);
  const cursorPosition = uniform(new THREE.Vector3(100, 100, 100));
  const cursorVelocity = uniform(new THREE.Vector3());
  const cursorBurstDirection = uniform(new THREE.Vector3(0, 1, 0));
  const cursorRadius = uniform(0.55), cursorActive = uniform(0), cursorPressed = uniform(0);
  const sprayLife = instancedArray(MAX_PARTICLES, 'float');
  const positions = instancedArray(MAX_PARTICLES, 'vec4'); // xyz position, w nearest knot parameter
  const velocities = instancedArray(MAX_PARTICLES, 'vec3');
  const nextVelocity = instancedArray(MAX_PARTICLES, 'vec3');
  const densities = instancedArray(MAX_PARTICLES, 'float');
  const counts = instancedArray(CELLS, 'uint').toAtomic();
  // Split neighbour storage to stay below the per-buffer 128 MiB limit.
  const members = instancedArray(CELLS * (CAP / 2), 'uint');
  const membersExtra = instancedArray(CELLS * (CAP / 2), 'uint');
  const overflow = instancedArray(1, 'uint').toAtomic();

  // A (2,3) torus knot. The frame uses an analytic derivative, avoiding a
  // singular world-up cross product at the knot's vertical tangencies.
  const knot = Fn(([t]) => {
    const r = cos(t.mul(3)).mul(0.95).add(2.6);
    return vec3(r.mul(cos(t.mul(2))), r.mul(sin(t.mul(2))), sin(t.mul(3)).mul(0.95));
  });
  const derivative = Fn(([t]) => {
    const r = cos(t.mul(3)).mul(0.95).add(2.6);
    const dr = sin(t.mul(3)).mul(-2.85);
    return vec3(dr.mul(cos(t.mul(2))).sub(r.mul(sin(t.mul(2))).mul(2)),
      dr.mul(sin(t.mul(2))).add(r.mul(cos(t.mul(2))).mul(2)), cos(t.mul(3)).mul(2.85));
  });
  const cellOf = Fn(([p]) => ivec3(clamp(floor(p.add(G * CELL / 2).div(CELL)), 1, G - 2)));
  const cellIndex = Fn(([c]) => uint(c.x.add(c.y.mul(G)).add(c.z.mul(G * G))));
  const kernel = Fn(([d2]) => exp(d2.mul(-0.5 / (SIGMA * SIGMA))).div(Math.pow(2 * Math.PI, 1.5) * SIGMA ** 3));

  // Arc-length sampling prevents bunching at the slower parameter sections.
  function knotCPU(t) { const r = 2.6 + 0.95 * Math.cos(3 * t); return new THREE.Vector3(r * Math.cos(2 * t), r * Math.sin(2 * t), 0.95 * Math.sin(3 * t)); }
  const samples = 4096, arc = [0];
  let previous = knotCPU(0);
  for (let i = 1; i <= samples; i++) { const p = knotCPU(i / samples * TAU); arc.push(arc[i - 1] + p.distanceTo(previous)); previous = p; }
  const pathLength = arc[samples];
  const phases = new Float32Array(MAX_PARTICLES);
  let cursor = 1;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const target = i / MAX_PARTICLES * pathLength;
    while (arc[cursor] < target) cursor++;
    phases[i] = (cursor - 1 + (target - arc[cursor - 1]) / (arc[cursor] - arc[cursor - 1])) / samples * TAU;
  }
  const initialPhase = instancedArray(phases, 'float').toReadOnly();
  // Unit rest density. Particle mass scales with tube volume / particle count.
  const mass = uniform(pathLength * Math.PI * radius.value ** 2 / N);

  const initialise = Fn(() => {
    sprayLife.element(instanceIndex).assign(0);
    const t = initialPhase.element(uint(float(instanceIndex).mul(MAX_PARTICLES).div(activeCount)));
    const tangent = normalize(derivative(t));
    const radialAxis = vec3(cos(t.mul(2)), sin(t.mul(2)), 0);
    const normal = normalize(radialAxis.sub(tangent.mul(dot(radialAxis, tangent))));
    const binormal = normalize(cross(tangent, normal));
    const a = hash(instanceIndex.add(31)).mul(TAU);
    const r = sqrt(hash(instanceIndex.add(712))).mul(radius);
    const offset = normal.mul(cos(a)).add(binormal.mul(sin(a))).mul(r);
    positions.element(instanceIndex).assign(vec4(knot(t).add(offset), t));
    velocities.element(instanceIndex).assign(tangent.mul(speed));
  })().compute(N).setName('Seed arc-length distributed torus-knot particles');

  const clear = Fn(() => {
    atomicStore(counts.element(instanceIndex), uint(0));
    If(instanceIndex.equal(0), () => { atomicStore(overflow.element(0), uint(0)); });
  })().compute(CELLS).setName('Clear spatial cells');
  const scatter = Fn(() => {
    const cell = cellIndex(cellOf(positions.element(instanceIndex).xyz));
    const slot = atomicAdd(counts.element(cell), uint(1)).toVar();
    If(slot.lessThan(uint(CAP)), () => {
      If(slot.lessThan(uint(CAP / 2)), () => {
        members.element(cell.mul(CAP / 2).add(slot)).assign(instanceIndex);
      }).Else(() => {
        membersExtra.element(cell.mul(CAP / 2).add(slot.sub(CAP / 2))).assign(instanceIndex);
      });
    }).Else(() => { atomicAdd(overflow.element(0), uint(1)); });
  })().compute(N).setName('Build atomic spatial neighbour grid');

  // The grid is fully built before density or force dispatches start.
  // Clamping loop length guarantees safe access even in an overfull cell.
  function neighbours(p, visit) {
    const c = cellOf(p).toVar();
    Loop({ start: -1, end: 2, type: 'int', name: 'z' }, ({ z }) => {
      Loop({ start: -1, end: 2, type: 'int', name: 'y' }, ({ y }) => {
        Loop({ start: -1, end: 2, type: 'int', name: 'x' }, ({ x }) => {
          const key = cellIndex(c.add(ivec3(x, y, z))).toVar();
          const n = min(atomicLoad(counts.element(key)), uint(CAP)).toVar();
          Loop({ start: uint(0), end: n, type: 'uint', name: 'j' }, ({ j }) => {
            const other = uint(0).toVar();
            If(j.lessThan(uint(CAP / 2)), () => {
              other.assign(members.element(key.mul(CAP / 2).add(j)));
            }).Else(() => {
              other.assign(membersExtra.element(key.mul(CAP / 2).add(j.sub(CAP / 2))));
            });
            const delta = p.sub(positions.element(other).xyz).toVar();
            const d2 = dot(delta, delta).toVar();
            If(d2.lessThan(CELL * CELL), () => visit(other, delta, d2));
          });
        });
      });
    });
  }
  const density = Fn(() => {
    const p = positions.element(instanceIndex).xyz.toVar();
    const rho = float(0).toVar();
    neighbours(p, (other, delta, d2) => { rho.addAssign(mass.mul(kernel(d2))); });
    densities.element(instanceIndex).assign(max(rho, 0.15));
  })().compute(N).setName('Gaussian SPH density');

  const forces = Fn(() => {
    const state = positions.element(instanceIndex).toVar();
    const p = state.xyz;
    const v = velocities.element(instanceIndex).toVar();
    const rho = densities.element(instanceIndex).toVar();
    const pressure = max(rho.sub(1), 0).mul(1.5).div(rho.mul(rho)).toVar();
    const force = vec3(0).toVar();
    neighbours(p, (other, delta, d2) => {
      If(other.notEqual(instanceIndex), () => {
        const rj = densities.element(other).toVar();
        const pj = max(rj.sub(1), 0).mul(1.5).div(rj.mul(rj));
        const w = kernel(d2).toVar();
        // grad W = -delta / sigma^2 * W. Symmetric pressure conserves momentum.
        force.addAssign(delta.mul(pressure.add(pj)).mul(mass).mul(w).div(SIGMA * SIGMA));
        const separation = max(separationDistance.sub(sqrt(d2)), 0);
        force.addAssign(delta.div(max(sqrt(d2), 0.001)).mul(separation).mul(22));
        force.addAssign(velocities.element(other).sub(v).mul(viscosity).mul(3).mul(mass).mul(w).div(rj));
      });
    });
    const t = state.w.toVar();
    // Local closest-point refinement remains on the same strand at crossings.
    Loop(3, () => {
      const d = derivative(t).toVar();
      t.addAssign(clamp(dot(p.sub(knot(t)), d).div(dot(d, d)), -0.12, 0.12));
    });
    const tangent = normalize(derivative(t)).toVar();
    const radial = p.sub(knot(t)).toVar();
    const distance = max(length(radial), 0.0001).toVar();
    const outward = radial.div(distance).toVar();
    const radialV = dot(v, outward);
    const life = sprayLife.element(instanceIndex);
    life.assign(max(life.sub(dt), 0));
    // Recovery depends on where the water is, not just a shared timer.
    // Detached sheets retain transverse momentum until they mix into the core.
    const outside = smoothstep(radius.mul(1.2), radius.add(0.9), distance).toVar();
    const freedom = max(clamp(life.div(0.3), 0, 1), outside.mul(0.78)).toVar();
    const attachment = float(1).sub(freedom.mul(0.94)).toVar();
    const clock = simulationTime;
    const fluidity = float(1).div(float(1).add(viscosity.mul(0.55))).toVar();
    const drive = speed.div(1.5).toVar();
    const radialAxis = vec3(cos(t.mul(2)), sin(t.mul(2)), 0);
    const sectionNormal = normalize(radialAxis.sub(tangent.mul(dot(radialAxis, tangent))));
    const sectionBinormal = normalize(cross(tangent, sectionNormal));
    // Travelling compression packets vary both the jet width and axial speed.
    const packet = sin(t.mul(5).sub(clock.mul(2.8))).toVar();
    const breathingRadius = radius.mul(float(0.92).add(packet.mul(0.13).mul(fluidity)).add(sin(t.mul(13).add(clock.mul(4.1))).mul(0.06).mul(fluidity)));
    force.subAssign(outward.mul(max(distance.sub(breathingRadius), 0)).mul(80).mul(attachment));
    force.subAssign(outward.mul(radialV).mul(float(0.5).add(viscosity.mul(0.15))).mul(attachment));
    // Viscosity controls transverse dissipation as well as SPH neighbour exchange.
    // Low values retain eddies and spray; high values rapidly settle into a stream.
    force.subAssign(v.sub(tangent.mul(dot(v, tangent))).mul(float(0.3).add(viscosity.mul(1.15))).mul(attachment));
    const localSpeed = speed.mul(float(1).add(packet.mul(0.38).mul(fluidity)));
    force.addAssign(tangent.mul(localSpeed.sub(dot(v, tangent))).mul(2.5).mul(attachment));
    // Curvature acceleration keeps fast flow centred on the analytic (2,3)
    // knot instead of letting inertia cut corners. Free spray is unaffected.
    const curveR = cos(t.mul(3)).mul(0.95).add(2.6);
    const curveDR = sin(t.mul(3)).mul(-2.85);
    const curveDDR = cos(t.mul(3)).mul(-8.55);
    const secondDerivative = vec3(
      curveDDR.sub(curveR.mul(4)).mul(cos(t.mul(2))).sub(curveDR.mul(4).mul(sin(t.mul(2)))),
      curveDDR.sub(curveR.mul(4)).mul(sin(t.mul(2))).add(curveDR.mul(4).mul(cos(t.mul(2)))),
      sin(t.mul(3)).mul(-8.55));
    const curveD = derivative(t);
    const curvature = secondDerivative.sub(tangent.mul(dot(secondDerivative, tangent))).div(dot(curveD, curveD));
    const axialSpeed = dot(v, tangent);
    force.addAssign(curvature.mul(axialSpeed.mul(axialSpeed)).mul(attachment));
    // Smooth space/time forcing, evaluated per particle, excites real eddies.
    const eddyA = sin(p.y.mul(8).add(p.z.mul(5)).sub(clock.mul(4.2))).add(cos(p.x.mul(5).add(clock.mul(2.7))));
    const eddyB = cos(p.x.mul(7).sub(p.z.mul(6)).add(clock.mul(3.6))).add(sin(p.y.mul(4).sub(clock.mul(3.1))));
    force.addAssign(sectionNormal.mul(eddyA).add(sectionBinormal.mul(eddyB)).mul(fluidity).mul(drive).mul(4.0));
    force.addAssign(cross(tangent, radial).mul(3));
    // A short, pulsing nozzle sector throws off sheets and droplets like the
    // reference's inlet jet. Detached particles remain simulated and recirculate.
    const nozzle = exp(cos(t.sub(2.15)).sub(1).mul(28));
    const pulse = sin(clock.mul(5.3)).mul(0.5).add(0.5);
    const jet = sectionNormal.add(sectionBinormal.mul(sin(clock.mul(3.7)).mul(0.8)));
    force.addAssign(jet.mul(nozzle).mul(pulse.mul(pulse)).mul(14).mul(fluidity).mul(drive));
    // Coherent, divergence-free eddies: neighbouring droplets move in sheets,
    // rather than getting independent frame-to-frame random jitter.
    const q = p.mul(3.2).add(vec3(clock.mul(1.7), clock.mul(-1.3), clock.mul(1.1)));
    const curl = vec3(cos(q.y).sub(sin(q.z)), cos(q.z).sub(sin(q.x)), cos(q.x).sub(sin(q.y)));
    const detached = max(freedom, outside).toVar();
    force.addAssign(curl.mul(detached).mul(float(2.5).add(fluidity.mul(5))));
    // Roll around the strand and advect downstream while being recaptured.
    // Spatially varying circulation bends return trajectories into small eddies.
    const roll = sin(t.mul(7).add(clock.mul(2.1))).mul(3).add(5);
    force.addAssign(cross(tangent, outward).mul(roll).mul(detached));
    force.addAssign(tangent.mul(speed).mul(outside).mul(1.2));
    // A soft outer brake avoids sheets piling onto the hard recovery boundary.
    force.subAssign(outward.mul(smoothstep(1.25, 1.95, distance)).mul(float(24).add(max(radialV, 0).mul(12))));
    // Invisible pointer collider: radial pressure plus momentum from hand motion.
    const toCursor = p.sub(cursorPosition).toVar();
    const cursorDistance = max(length(toCursor), 0.001).toVar();
    If(cursorActive.greaterThan(0).and(cursorDistance.lessThan(cursorRadius)), () => {
      const normal = toCursor.div(cursorDistance);
      const penetration = float(1).sub(cursorDistance.div(cursorRadius));
      const handSpeed = length(cursorVelocity);
      force.addAssign(normal.mul(penetration).mul(float(130).add(cursorPressed.mul(180)).add(handSpeed.mul(24))));
      force.addAssign(cursorVelocity.mul(penetration).mul(16));
      const variation = sin(p.x.mul(9).add(p.y.mul(6)).add(clock.mul(3))).mul(0.12);
      life.assign(max(life, float(0.42).add(variation).add(min(handSpeed.mul(0.04), 0.2)).add(cursorPressed.mul(0.15))));
    });
    // Brief free flight lets sheets tear away instead of snapping to the tube.
    force.addAssign(vec3(0, -1.8, 0).mul(freedom));
    force.mulAssign(min(float(1), float(240).div(max(length(force), 0.0001))));
    const next = v.add(force.mul(dt)).toVar();
    next.mulAssign(min(float(1), max(float(9), speed.mul(1.5)).div(max(length(next), 0.0001))));
    nextVelocity.element(instanceIndex).assign(next);
    // Positions and old velocities stay read-only throughout this dispatch.
  })().compute(N).setName('SPH pressure, viscosity and knot flow forces');

  // A click is an impulse, not a single short frame of steady pressure.
  const clickBurst = Fn(() => {
    const delta = positions.element(instanceIndex).xyz.sub(cursorPosition).toVar();
    const distance = max(length(delta), 0.001).toVar();
    const reach = cursorRadius.mul(1.65);
    If(distance.lessThan(reach), () => {
      const falloff = sqrt(float(1).sub(distance.div(reach)));
      const direction = normalize(delta.add(vec3(0.0001, 0.0002, 0.0001)));
      const phase = dot(delta, vec3(7.1, 5.3, -6.7)).add(simulationTime.mul(4.3));
      const packet = sin(phase).mul(0.5).add(0.5);
      const twist = cross(cursorBurstDirection, direction).mul(cos(phase.mul(0.7))).mul(2.8);
      velocities.element(instanceIndex).addAssign(direction.mul(falloff).mul(2.2)
        .add(cursorBurstDirection.mul(falloff).mul(packet.mul(3).add(5)))
        .add(twist.mul(falloff)).add(cursorVelocity.mul(falloff).mul(0.45)));
      sprayLife.element(instanceIndex).assign(packet.mul(0.5).add(0.5));
    });
  })().compute(N).setName('Cursor click splash impulse');

  const integrate = Fn(() => {
    const p = positions.element(instanceIndex);
    const v = nextVelocity.element(instanceIndex).toVar();
    p.xyz.addAssign(v.mul(dt));
    const t = p.w.toVar();
    Loop(3, () => {
      const d = derivative(t).toVar();
      t.addAssign(clamp(dot(p.xyz.sub(knot(t)), d).div(dot(d, d)), -0.12, 0.12));
    });
    // Outer recovery envelope only: free surface and spray can leave the nominal tube.
    // This bound remains inside the reconstruction volume at every allowed radius.
    const radial = p.xyz.sub(knot(t)).toVar();
    const dist = length(radial).toVar();
    If(dist.greaterThan(float(2.0)), () => {
      const normal = radial.div(dist);
      p.xyz.assign(knot(t).add(normal.mul(float(2.0))));
      v.subAssign(normal.mul(max(dot(v, normal), 0)));
    });
    p.w.assign(fract(t.div(TAU)).mul(TAU));
    velocities.element(instanceIndex).assign(v);
  })().compute(N).setName('Integrate and constrain to the knot');

  const water = await createWater(renderer, camera, positions, mass, hue, N, densities);
  scene.background = null;
  const curvePoints = Array.from({ length: 513 }, (_, i) => knotCPU(i / 512 * TAU));
  const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curvePoints), new THREE.LineBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
  guide.visible = false; guide.renderOrder = 2; scene.add(guide);

  const pointer = new THREE.Vector2(10, 10);
  const raycaster = new THREE.Raycaster();
  let pointerInside = false, pointerDown = false, pendingClick = false, cursorEnabled = true, hadCursor = false;
  const lastCursor = new THREE.Vector3(), hitCursor = new THREE.Vector3(), burstCentre = new THREE.Vector3();
  const ring = document.createElement('div');
  ring.id = 'cursor-ring'; ring.hidden = true; document.body.append(ring);
  function configureCursor() {
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  }
  configureCursor();
  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
    pointerInside = e.buttons === 0 && e.pointerType !== 'touch';
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
  });
  canvas.addEventListener('pointerdown', () => {
    pointerDown = true; pointerInside = false; pendingClick = false;
    cursorActive.value = 0; ring.hidden = true;
    hadCursor = false; cursorVelocity.value.set(0, 0, 0);
  });
  window.addEventListener('pointerup', () => {
    pointerDown = false;
    // Wait for the next hover movement before resuming splashes.
    pointerInside = false; hadCursor = false;
  });
  canvas.addEventListener('pointerleave', () => { pointerInside = false; pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { pointerInside = false; pointerDown = false; });
  window.addEventListener('blur', () => { pointerInside = false; pointerDown = false; });
  function updateCursor(frameDt) {
    cursorActive.value = 0; cursorPressed.value = pointerDown ? 1 : 0;
    if (!cursorEnabled || !pointerInside || pointerDown) { ring.hidden = true; hadCursor = false; cursorVelocity.value.set(0, 0, 0); return; }
    camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
    let best = Infinity, depth = 0;
    for (const centre of curvePoints) {
      const along = centre.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
      if (along < 0) continue;
      const dist = raycaster.ray.distanceSqToPoint(centre);
      // Small depth bias prefers the front strand where projected paths cross.
      const score = dist + along * 0.002;
      if (score < best) { best = score; depth = along; burstCentre.copy(centre); }
    }
    if (best > (cursorRadius.value + radius.value + 0.5) ** 2) { ring.hidden = true; hadCursor = false; return; }
    raycaster.ray.at(depth, hitCursor);
    if (hadCursor && hitCursor.distanceTo(lastCursor) < 2) {
      cursorVelocity.value.copy(hitCursor).sub(lastCursor).divideScalar(Math.max(frameDt, 1 / 240)).clampLength(0, 8);
    } else cursorVelocity.value.set(0, 0, 0);
    cursorPosition.value.copy(hitCursor); lastCursor.copy(hitCursor); hadCursor = true;
    cursorBurstDirection.value.set(burstCentre.x, burstCentre.y, burstCentre.z * 0.3).normalize();
    cursorActive.value = 1; ring.hidden = false;
    const diameter = cursorRadius.value * innerHeight / (depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    ring.style.width = ring.style.height = diameter + 'px';
    ring.classList.toggle('pressed', pointerDown);
  }

  let paused = false, resetting = false, elapsed = 0, accumulator = 0, frames = 0, frameTime = 0, last = performance.now();
  const passes = [clear, scatter, density, forces, integrate];
  notice.textContent = 'Compiling TSL compute & material shaders…';
  await renderer.computeAsync(initialise);
  await renderer.computeAsync([clear, scatter, density, clickBurst]);
  water.update();
  water.render();
  // Warm-up compiles every compute pipeline before the first visible frame.
  await renderer.computeAsync(passes);
  await renderer.backend.device.queue.onSubmittedWorkDone();
  if ($('backend').textContent === 'WEBGPU UNAVAILABLE') return;
  $('loader').classList.add('hidden');

  const pane = new Pane({ container: $('pane-container'), title: 'Controls', expanded: false });
  const settings = { viewAngle: camera.fov, particles: N, speed: speed.value,
    viscosity: viscosity.value, radius: radius.value, colour: hue.value * 360,
    absorption: water.colourStrength.value, cursorRadius: cursorRadius.value,
    hoverSplash: true, background: true, orbit: false, path: false };
  const particlePasses = [initialise, scatter, density, forces, clickBurst, integrate];
  async function reform() {
    if (resetting) return;
    resetting = true;
    try {
      await renderer.computeAsync(initialise);
      await renderer.computeAsync([clear, scatter, density]);
      accumulator = 0; elapsed = 0; pendingClick = false;
    } catch (error) { fail(error); }
    finally { resetting = false; }
  }
  const flowFolder = pane.addFolder({ title: 'Flow', expanded: false });
  const particleBinding = flowFolder.addBinding(settings, 'particles', { label: 'Particles', min:8192, max:MAX_PARTICLES, step:8192 });
  particleBinding.on('change', async event => {
    if (!event.last || resetting) return;
    particleBinding.disabled = true;
    N = Math.max(8192, Math.min(MAX_PARTICLES, Math.round(event.value / 8192) * 8192));
    settings.particles = N;
    activeCount.value = N;
    mass.value = pathLength * Math.PI * radius.value ** 2 / N;
    separationDistance.value = 0.0535 * Math.cbrt(49152 / N);
    for (const pass of particlePasses) pass.count = N;
    water.setParticleCount(N);
    await reform();
    particleBinding.disabled = false;
    particleBinding.refresh();
  });
  flowFolder.addBinding(settings, 'speed', { label:'Flow speed', min:0, max:9, step:0.05 }).on('change', e => { speed.value = e.value; });
  flowFolder.addBinding(settings, 'viscosity', { label:'Viscosity', min:0, max:10, step:0.1 }).on('change', e => { viscosity.value = e.value; });
  flowFolder.addBinding(settings, 'radius', { label:'Tube radius', min:0.22, max:1, step:0.01 }).on('change', e => {
    radius.value = e.value; mass.value = pathLength * Math.PI * radius.value ** 2 / N;
  });
  const waterFolder = pane.addFolder({ title:'Water', expanded:false });
  waterFolder.addBinding(settings, 'colour', { label:'Colour', min:0, max:360, step:1 }).on('change', e => { hue.value = e.value / 360; });
  waterFolder.addBinding(settings, 'absorption', { label:'Absorption', min:0, max:3, step:0.05 }).on('change', e => { water.colourStrength.value = e.value; });
  const interactionFolder = pane.addFolder({ title:'Interaction', expanded:false });
  interactionFolder.addBinding(settings, 'hoverSplash', { label:'Hover splashes' }).on('change', e => { cursorEnabled = e.value; configureCursor(); });
  interactionFolder.addBinding(settings, 'cursorRadius', { label:'Cursor radius', min:0.2, max:1, step:0.05 }).on('change', e => { cursorRadius.value = e.value; });
  const viewFolder = pane.addFolder({ title:'View', expanded:false });
  viewFolder.addBinding(settings, 'viewAngle', { label:'View angle', min:38, max:75, step:1 }).on('change', e => setViewAngle(e.value));
  viewFolder.addBinding(settings, 'background', { label:'Environment' }).on('change', e => { water.showStudio.value = e.value ? 1 : 0; });
  viewFolder.addBinding(settings, 'orbit', { label:'Auto orbit' }).on('change', e => { controls.autoRotate = e.value; });
  viewFolder.addBinding(settings, 'path', { label:'Flow path' }).on('change', e => { guide.visible = e.value; });
  const pauseButton = pane.addButton({ title:'Pause' }).on('click', () => {
    paused = !paused; pauseButton.title = paused ? 'Resume' : 'Pause'; accumulator = 0;
  });
  pane.addButton({ title:'Re-form' }).on('click', reform);
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r' && !e.repeat && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) void reform();
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  document.addEventListener('visibilitychange', () => { last = performance.now(); accumulator = 0; });
  renderer.setAnimationLoop(() => {
    const now = performance.now(), wallDt = (now - last) / 1000, frameDt = Math.min(wallDt, 0.04); last = now;
    controls.update(frameDt);
    updateCursor(frameDt);
    if (pendingClick) {
      if (!paused && !resetting && cursorActive.value) renderer.compute(clickBurst);
      pendingClick = false;
    }
    if (!paused && !resetting && !document.hidden) {
      accumulator = Math.min(accumulator + frameDt, dt.value * 4);
      while (accumulator >= dt.value) {
        simulationTime.value = elapsed;
        renderer.compute(passes);
        accumulator -= dt.value; elapsed += dt.value;
      }
    }
    water.update();
    water.render();
    if (guide.visible) { renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true; }
    frames++; frameTime += wallDt;
    if (frameTime > 0.6) {
      $('backend').textContent = `THREE r${THREE.REVISION} · WEBGPU · TSL · ${Math.round(frames / frameTime)} FPS`;
      frames = 0; frameTime = 0;
    }
  });

  // Opt-in GPU readback for validation; it is not part of the animation loop.
  async function diagnostics() {
    const wasPaused = paused; paused = true;
    try {
      await renderer.backend.device.queue.onSubmittedWorkDone();
      const [pbuf, vbuf, obuf, lbuf] = await Promise.all([
        renderer.getArrayBufferAsync(positions.value), renderer.getArrayBufferAsync(velocities.value), renderer.getArrayBufferAsync(overflow.value), renderer.getArrayBufferAsync(sprayLife.value)
      ]);
      const p = new Float32Array(pbuf), v = new Float32Array(vbuf), lives = new Float32Array(lbuf);
      let finite = true, maxRadius = 0, meanSpeed = 0, meanTangentSpeed = 0, meanTransverseSpeed = 0, sprayParticles = 0, freeFlightParticles = 0;
      const stride = velocities.value.itemSize;
      for (let i = 0; i < N; i++) {
        const a = new THREE.Vector3(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]);
        finite &&= [...a, p[i * 4 + 3], v[i * stride], v[i * stride + 1], v[i * stride + 2]].every(Number.isFinite);
        const radialDistance = a.distanceTo(knotCPU(p[i * 4 + 3]));
        maxRadius = Math.max(maxRadius, radialDistance);
        if (radialDistance > radius.value * 1.2) sprayParticles++;
        if (lives[i] > 0) freeFlightParticles++;
        meanSpeed += Math.hypot(v[i * stride], v[i * stride + 1], v[i * stride + 2]) / N;
        const t = p[i * 4 + 3];
        const tangent = knotCPU(t + 0.0001).sub(knotCPU(t - 0.0001)).normalize();
        const velocity = new THREE.Vector3(v[i * stride], v[i * stride + 1], v[i * stride + 2]);
        const axial = tangent.dot(velocity);
        meanTangentSpeed += axial / N;
        meanTransverseSpeed += velocity.addScaledVector(tangent, -axial).length() / N;
      }
      const result = { revision: THREE.REVISION, backend: renderer.backend.constructor.name, particles: N, finite, maxRadius, meanSpeed, meanTangentSpeed, meanTransverseSpeed, sprayParticles, freeFlightParticles, cursorActive: cursorActive.value, viscosity: viscosity.value, overflow: new Uint32Array(obuf)[0], simulationSeconds: elapsed };
      $('diagnostic').textContent = JSON.stringify(result);
      return result;
    } finally { paused = wasPaused; }
  }
  window.knotFluid = { renderer, diagnostics, positions, velocities, water, cursorPosition, cursorActive };
  if (new URLSearchParams(location.search).has('test')) {
    pane.addButton({ title:'Check GPU state' }).on('click', () => diagnostics().catch(fail));
    setTimeout(() => diagnostics().catch(fail), 12000);
  }
}
main().catch(fail);

