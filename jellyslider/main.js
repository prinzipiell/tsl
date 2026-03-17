import * as THREE from 'three';
import { MeshBasicNodeMaterial, QuadMesh,
         uniform, uv, texture,
         Fn, Loop, Break, If, Return,
         float, int, vec2, vec3, vec4,
         abs, max, min, clamp, length, normalize, cross, dot, pow, mix, smoothstep,
         reflect, refract, sin, sqrt, select
       } from 'three/tsl';

const L = s => document.getElementById('log').textContent += s+'\n';

try {

const DPR = Math.min(window.devicePixelRatio||1, 2);
const CW=800, CH=500;

const renderer = new THREE.WebGPURenderer({ antialias:false });
await renderer.init();
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.cursor = 'grab';
renderer.domElement.style.touchAction = 'none';
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

// ── Responsive sizing ────────────────────────────────────
const BASE_SCENE_W = 680, BASE_SCENE_H = 300;
const BASE_RECT_W = 800, BASE_RECT_H = 500;

function getScale() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scaleX = vw / BASE_RECT_W;
  const scaleY = vh / BASE_RECT_H;
  return Math.min(scaleX, scaleY, 1.0); // never upscale beyond 1x
}

function updateSizes() {
  const s = getScale();
  const sw = BASE_SCENE_W * s;
  const sh = BASE_SCENE_H * s;
  const rw = BASE_RECT_W * s;
  const rh = BASE_RECT_H * s;
  u.sceneSize.value.set(sw * DPR, sh * DPR);
  u.rectSize.value.set(rw * DPR, rh * DPR);
  u.resolution.value.set(window.innerWidth * DPR, window.innerHeight * DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ── Uniforms ─────────────────────────────────────────────
const u = {
  aspect:     uniform(BASE_SCENE_W/BASE_SCENE_H),
  resolution: uniform(new THREE.Vector2(window.innerWidth*DPR, window.innerHeight*DPR)),
  sceneSize:  uniform(new THREE.Vector2(BASE_SCENE_W*DPR, BASE_SCENE_H*DPR)),
  rectSize:   uniform(new THREE.Vector2(BASE_RECT_W*DPR, BASE_RECT_H*DPR)),
  fill:       uniform(0.18),
  squeeze:    uniform(0.0),
  wobble:     uniform(0.0),
  light:      uniform(new THREE.Vector3(-0.2, 3.0, 0.8)),
  shadowLight:uniform(new THREE.Vector3(-0.43, 0.19, -0.43)),
  shadowDark: uniform(0.32),
  cam:        uniform(new THREE.Vector3(0.0, 1.35, 0.9)),
  bgLight:    uniform(1.50),
  grooveLight:uniform(0.89),
  aoStrength: uniform(3.55),
  opacity:    uniform(0.65),
  colLeft:    uniform(new THREE.Vector3(0.10, 0.35, 1.00)),
  colMid:     uniform(new THREE.Vector3(0.88, 0.88, 0.96)),
  colRight:   uniform(new THREE.Vector3(0.65, 0.30, 0.95)),
};

// ── Text texture ─────────────────────────────────────────
const TEX_W = 256, TEX_H = 128;
const textCanvas = document.createElement('canvas');
textCanvas.width = TEX_W; textCanvas.height = TEX_H;
const tctx = textCanvas.getContext('2d');

const textTex = new THREE.CanvasTexture(textCanvas);
textTex.minFilter = THREE.LinearFilter;
textTex.magFilter = THREE.LinearFilter;
const uTextTex = texture(textTex);

function updateTextTexture(pct) {
  tctx.clearRect(0, 0, TEX_W, TEX_H);
  tctx.fillStyle = '#000';
  tctx.fillRect(0, 0, TEX_W, TEX_H);
  const str = Math.round(pct) + '%';
  tctx.font = '500 72px "Helvetica Neue", Arial, sans-serif';
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  // Shadow: offset bottom-right, slight blur, in green channel
  tctx.fillStyle = '#0f0';
  tctx.shadowColor = '#0f0';
  tctx.shadowBlur = 4;
  tctx.shadowOffsetX = 3;
  tctx.shadowOffsetY = 3;
  tctx.fillText(str, TEX_W/2, TEX_H/2);
  // Main text: no shadow, in red channel
  tctx.shadowColor = 'transparent';
  tctx.shadowBlur = 0;
  tctx.shadowOffsetX = 0;
  tctx.shadowOffsetY = 0;
  tctx.fillStyle = '#f00';
  tctx.fillText(str, TEX_W/2, TEX_H/2);
  textTex.needsUpdate = true;
}
updateTextTexture(0);

// ── SDF Functions ────────────────────────────────────────

const grooveXZ = Fn(([px, pz])=>{
  const cx = clamp(px, -0.85, 0.85);
  return length(vec2(px.sub(cx), pz)).sub(0.105);
});

const mapSurf = Fn(([p])=>{
  return max(p.y, grooveXZ(p.x, p.z).negate());
});

const spineYFn = Fn(([x, fillX, leftX, sqz, wb])=>{
  const span = max(fillX.sub(leftX), 0.001);
  const t = clamp(x.sub(leftX).div(span), 0.0, 1.0);
  const skew = clamp(float(0.55).add(sqz.mul(0.25)), 0.2, 0.9);
  const ts = pow(t, skew);
  const h = sin(float(3.14159265).mul(ts)).toVar();
  const rightDamp = mix(float(1.0), float(0.30), smoothstep(0.5, 1.0, t));
  h.mulAssign(rightDamp);
  const maxH = float(0.28).add(abs(wb).mul(0.05));
  return maxH.mul(h);
});

const archDist = Fn(([p])=>{
  const GR = float(0.098);
  const T  = float(0.030);
  const fillX = clamp(float(-1.0).add(u.fill.mul(2.0)), -0.20, 0.88);
  const leftX = float(-0.90);
  const cx = clamp(p.x, leftX, fillX);
  const xOff = p.x.sub(cx);
  const sy = spineYFn(cx, fillX, leftX, u.squeeze, u.wobble);
  const cr = T.mul(0.85);
  const ey = abs(p.y.sub(sy)).sub(T.sub(cr));
  const ez = abs(p.z).sub(GR.sub(cr));

  const d2 = float(0).toVar();
  If(ey.lessThan(0.0).and(ez.lessThan(0.0)), ()=>{
    d2.assign(max(ey, ez).sub(cr));
  }).Else(()=>{
    d2.assign(length(vec2(max(ey, 0.0), max(ez, 0.0))).sub(cr));
  });
  // Clip below floor
  d2.assign(max(d2, T.negate().sub(p.y)));

  const result = float(0).toVar();
  If(xOff.equal(0.0), ()=>{
    result.assign(d2);
  }).Else(()=>{
    result.assign(length(vec2(max(d2, 0.0), abs(xOff))).add(min(d2, 0.0)));
  });
  return result;
});

const plateDist = Fn(([p])=>{
  const gxz = grooveXZ(p.x, p.z);
  const slab = abs(p.y.add(0.060)).sub(0.001);
  return max(slab, gxz.add(0.015));
});

const mapScene = Fn(([p])=>{
  const surf = max(p.y, grooveXZ(p.x, p.z).negate());
  const arch = archDist(p);
  const plate = plateDist(p);
  return min(min(surf, arch), plate);
});

const matAt = Fn(([p])=>{
  const gxz  = grooveXZ(p.x, p.z);
  const surf = max(p.y, gxz.negate());
  const gint = max(gxz.negate().sub(0.004), p.y.negate().sub(0.10).add(0.003));
  const arch = archDist(p);
  const plate = plateDist(p);
  const m = float(0).toVar();
  If(arch.lessThanEqual(surf).and(arch.lessThanEqual(gint)).and(arch.lessThanEqual(plate)), ()=>{
    m.assign(2.0);
  }).ElseIf(plate.lessThanEqual(surf).and(plate.lessThanEqual(gint)).and(plate.lessThanEqual(arch)), ()=>{
    m.assign(3.0);
  }).ElseIf(gint.lessThan(surf), ()=>{
    m.assign(1.0);
  });
  return m;
});

const calcNorm = Fn(([p])=>{
  const e = float(0.001);
  return normalize(vec3(
    mapScene(p.add(vec3(e,0,0))).sub(mapScene(p.sub(vec3(e,0,0)))),
    mapScene(p.add(vec3(0,e,0))).sub(mapScene(p.sub(vec3(0,e,0)))),
    mapScene(p.add(vec3(0,0,e))).sub(mapScene(p.sub(vec3(0,0,e))))
  ));
});

const softshadow = Fn(([ro, rd])=>{
  const res = float(1.0).toVar();
  const t = float(0.01).toVar();
  Loop(32, ()=>{
    const h = mapScene(ro.add(rd.mul(t)));
    If(h.lessThan(0.001), ()=>{ res.assign(0.0); Break(); });
    res.assign(min(res, float(5.0).mul(h).div(t)));
    t.addAssign(h.mul(0.3));
    If(t.greaterThan(4.0), ()=>{ Break(); });
  });
  return clamp(res, 0.0, 1.0);
});

const calcAO = Fn(([p, n])=>{
  const occ = float(0).toVar();
  const sc = float(1.0).toVar();
  Loop(5, ({i})=>{
    const d = float(0.03).add(float(0.06).mul(i));
    const h = mapScene(p.add(n.mul(d)));
    occ.addAssign(d.sub(h).mul(sc));
    sc.mulAssign(0.60);
  });
  return clamp(float(1.0).sub(u.aoStrength.mul(occ)), 0.0, 1.0);
});

// ── Text on plate (texture-based) ────────────────────────

const textOnPlate = Fn(([p])=>{
  const texU = p.x.sub(0.50).div(0.30).add(0.5);
  const texV = p.z.negate().div(0.18).add(0.5);
  const inBounds = texU.greaterThanEqual(0.0).and(texU.lessThanEqual(1.0))
                   .and(texV.greaterThanEqual(0.0)).and(texV.lessThanEqual(1.0));
  const sampled = uTextTex.uv(vec2(texU, texV));
  const textA = sampled.r.mul(float(inBounds));
  const shadowA = sampled.g.mul(float(inBounds));
  const shadowOnly = clamp(shadowA.sub(textA), 0.0, 1.0);
  return vec2(textA, shadowOnly);
});

// ── Per-sample raymarch + shade ──────────────────────────

const sampleAt = Fn(([sUv, ro, fwd, rgt, up_, vign])=>{
  const sc = sUv.sub(0.5).mul(vec2(u.aspect, 1.0)).mul(2.1);
  const rd = normalize(fwd.add(rgt.mul(sc.x).mul(0.33)).add(up_.mul(sc.y).mul(0.33)));
  const col = vec3(0.98, 0.50, 0.10).mul(float(0.90).add(float(0.10).mul(vign))).toVar();

  // Raymarch
  const t = float(0.01).toVar();
  const hit = int(0).toVar();
  Loop(200, ()=>{
    const d = mapScene(ro.add(rd.mul(t)));
    If(d.lessThan(0.0005), ()=>{ hit.assign(1); Break(); });
    If(t.greaterThan(7.0), ()=>{ Break(); });
    t.addAssign(d.mul(0.3));
  });

  If(hit.equal(1), ()=>{
    const p = ro.add(rd.mul(t));
    const mat = matAt(p);
    const n = calcNorm(p);
    const v = rd.negate();

    const L1 = normalize(u.light);
    const Lshadow = normalize(u.shadowLight);
    const L2 = normalize(vec3(1.5,0.6,0.5));
    const d1 = max(dot(n,L1), 0.0);
    const d2 = max(dot(n,L2), 0.0).mul(0.15);
    const d3 = max(dot(n, normalize(vec3(0,-0.5,1.0))), 0.0).mul(0.10);
    const shd = softshadow(p.add(n.mul(0.014)), L1);
    const dropShd = softshadow(p.add(n.mul(0.014)), Lshadow);
    const ao = calcAO(p, n);

    const H1 = normalize(L1.add(v));
    const sp1 = pow(max(dot(n,H1),0.0), 200.0);
    const H2 = normalize(L2.add(v));
    const sp2 = pow(max(dot(n,H2),0.0), 45.0).mul(0.20);
    const rim = pow(float(1.0).sub(clamp(dot(n,v), 0.0, 1.0)), 3.5);

    const gx = p.x.mul(0.50);
    const gz = p.z.add(0.1).mul(0.90);
    const radial = sqrt(gx.mul(gx).add(gz.mul(gz)));

    // mat=0: flat surface
    If(mat.lessThan(0.5), ()=>{
      const lit = d1.mul(shd).mul(0.45).add(d2).add(d3).add(0.20);
      const baseCol = vec3(0.96, 0.48, 0.08);
      const areaLight = pow(max(float(1.0).sub(radial), 0.0), 1.4).mul(u.bgLight);
      col.assign(baseCol.mul(lit));
      col.addAssign(vec3(1.00,0.60,0.18).mul(areaLight));
      col.addAssign(vec3(1.00,0.65,0.20).mul(sp1).mul(shd).mul(0.10));
      col.mulAssign(mix(0.92, 1.0, ao));
      // Drop shadow from back light
      col.mulAssign(mix(float(1.0).sub(u.shadowDark), 1.0, dropShd));
    });

    // mat=1: groove interior
    If(mat.greaterThanEqual(0.5).and(mat.lessThan(1.5)), ()=>{
      const areaLight = pow(max(float(1.0).sub(radial), 0.0), 1.4).mul(u.grooveLight);
      col.assign(vec3(0.92,0.45,0.08).mul(d1.mul(0.15).add(d2.mul(0.12)).add(0.22)));
      col.addAssign(vec3(0.70,0.30,0.06).mul(rim).mul(0.08));
      col.addAssign(vec3(0.90,0.42,0.08).mul(areaLight));
      col.mulAssign(mix(0.78, 1.0, ao));
      // Drop shadow from back light
      col.mulAssign(mix(float(1.0).sub(u.shadowDark), 1.0, dropShd));
    });

    // mat=2: arch/jelly glass
    If(mat.greaterThanEqual(1.5).and(mat.lessThan(2.5)), ()=>{
      const refrRd = refract(rd, n, float(1.0).div(1.45)).toVar();
      If(length(refrRd).lessThan(0.001), ()=>{ refrRd.assign(reflect(rd, n)); });
      const refrCol = vec3(0.98,0.50,0.10).toVar();

      const rt = float(0.02).toVar();
      Loop(60, ()=>{
        const rp = p.add(refrRd.mul(rt));
        const rd2s = mapSurf(rp);
        const rd2p = plateDist(rp);
        const rd2 = min(rd2s, rd2p);
        If(rd2.lessThan(0.0006), ()=>{
          const hitPlate = rd2p.lessThan(rd2s);
          If(hitPlate, ()=>{
            const rb = max(dot(vec3(0,1,0), L1), 0.0);
            const rResult = textOnPlate(rp);
            const rTextA = rResult.x;
            const rShadA = rResult.y;
            const gBase = vec3(0.90,0.42,0.08).mul(rb.mul(0.15).add(0.20));
            refrCol.assign(mix(gBase, vec3(0.749, 0.533, 0.247), rShadA.mul(0.6)));
            refrCol.assign(mix(refrCol, vec3(0.894, 0.894, 0.894), rTextA));
          }).Else(()=>{
            const matB = grooveXZ(rp.x, rp.z).lessThan(-0.004).and(rp.y.lessThan(-0.001));
            const rb = max(dot(n, L1), 0.0);
            If(matB, ()=>{
              refrCol.assign(vec3(0.65,0.28,0.05).mul(rb.mul(0.08).add(0.09)));
            }).Else(()=>{
              refrCol.assign(vec3(0.98,0.50,0.10).mul(rb.mul(0.55).add(0.38)));
            });
          });
          Break();
        });
        rt.addAssign(rd2.mul(0.5));
        If(rt.greaterThan(2.0), ()=>{ Break(); });
      });

      const cosI = clamp(dot(n, rd.negate()), 0.0, 1.0);
      const fresnel = float(0.04).add(float(0.96).mul(pow(float(1.0).sub(cosI), 4.0)));
      const reflCol = vec3(0.82,0.82,0.84);
      const diff = d1.mul(shd).mul(0.30).add(d2).add(d3).add(0.10);
      const colorT = clamp(p.x.add(0.85).div(1.70), 0.0, 1.0);

      const archTint = mix(
        mix(u.colLeft, u.colMid, clamp(colorT.div(0.35), 0.0, 1.0)),
        mix(u.colMid, u.colRight, clamp(colorT.sub(0.35).div(0.65), 0.0, 1.0)),
        smoothstep(0.33, 0.37, colorT)
      );

      const archSurf = mix(archTint.mul(diff).mul(ao), archTint.mul(0.90), 0.60).toVar();
      refrCol.assign(mix(refrCol, mix(u.colLeft, u.colRight, colorT).mul(0.85), colorT.mul(0.45)));

      const transmit = float(1.0).sub(u.opacity);
      col.assign(mix(archSurf, refrCol, transmit));
      col.assign(mix(col, reflCol, fresnel.mul(0.18)));
      col.addAssign(vec3(1.00,0.995,0.990).mul(sp1).mul(shd).mul(2.2));
      col.addAssign(mix(vec3(0.85,0.80,0.95), vec3(0.70,0.50,0.95), colorT).mul(sp2).mul(0.5));
      col.addAssign(vec3(0.85,0.88,0.95).mul(rim).mul(0.35).mul(ao));
      col.mulAssign(mix(0.72, 1.0, smoothstep(0.0, 0.06, p.y)));
    });

    // mat=3: text plate
    If(mat.greaterThanEqual(2.5), ()=>{
      const areaLightG = pow(max(float(1.0).sub(radial), 0.0), 1.4).mul(u.grooveLight);
      const areaLightB = pow(max(float(1.0).sub(radial), 0.0), 1.4).mul(u.bgLight);
      const plateCol = vec3(0.92,0.45,0.08).mul(d1.mul(0.18).add(d2.mul(0.12)).add(0.24)).toVar();
      plateCol.addAssign(vec3(0.90,0.42,0.08).mul(areaLightG));
      plateCol.addAssign(vec3(1.00,0.60,0.18).mul(areaLightB).mul(0.5));
      plateCol.mulAssign(mix(0.78, 1.0, ao));
      // Drop shadow from back light
      plateCol.mulAssign(mix(float(1.0).sub(u.shadowDark), 1.0, dropShd));
      const tResult = textOnPlate(p);
      const tA = tResult.x;       // main text alpha
      const sA = tResult.y;       // shadow-only alpha
      // Apply shadow first (#BF883F = 0.749, 0.533, 0.247)
      col.assign(mix(plateCol, vec3(0.749, 0.533, 0.247), sA.mul(0.6)));
      // Then text on top (#E4E4E4 = 0.894)
      col.assign(mix(col, vec3(0.894, 0.894, 0.894), tA));
    });
  });

  col.mulAssign(mix(0.84, 1.0, vign));
  col.assign(pow(max(col, vec3(0)), vec3(0.4545)));
  return col;
});

// ── Main Raymarch with 4x SSAA ──────────────────────────

const raymarch = Fn(()=>{
  const vUv = uv();
  const pixelPos = vUv.mul(u.resolution);
  const sceneOrigin = u.resolution.sub(u.sceneSize).mul(0.5);
  const sceneUV = pixelPos.sub(sceneOrigin).div(u.sceneSize);
  // Inside the 800x500 rect: render full scene (unclamped UV shows more floor/shadow)
  // Outside the rect: clamp to rect edge pixels
  const rectOrigin = u.resolution.sub(u.rectSize).mul(0.5);
  const rectMinUV = rectOrigin.sub(sceneOrigin).div(u.sceneSize);
  const rectMaxUV = rectOrigin.add(u.rectSize).sub(sceneOrigin).div(u.sceneSize);
  const sUv = clamp(sceneUV, rectMinUV, rectMaxUV);

  const ro = u.cam.toVar();
  const tgt = vec3(0.0, 0.05, 0.0);
  const fwd = normalize(tgt.sub(ro));
  const rgt = normalize(cross(fwd, vec3(0,1,0)));
  const up_ = cross(rgt, fwd);
  const vign = float(1.0).sub(smoothstep(0.28, 1.05, length(sUv.sub(0.5))));

  // 2x2 SSAA: 4 samples at quarter-pixel offsets
  const ox = float(0.00037);
  const oy = float(0.00083);

  const s0 = sampleAt(sUv.add(vec2(ox.negate(), oy.negate())), ro, fwd, rgt, up_, vign);
  const s1 = sampleAt(sUv.add(vec2(ox, oy.negate())), ro, fwd, rgt, up_, vign);
  const s2 = sampleAt(sUv.add(vec2(ox.negate(), oy)), ro, fwd, rgt, up_, vign);
  const s3 = sampleAt(sUv.add(vec2(ox, oy)), ro, fwd, rgt, up_, vign);

  const totalCol = s0.add(s1).add(s2).add(s3).mul(0.25);
  return vec4(totalCol, 1.0);
});

// ── Material & Quad ──────────────────────────────────────
const material = new MeshBasicNodeMaterial();
material.colorNode = raymarch();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

L('WebGPU TSL OK');

// ── Color presets ────────────────────────────────────────
const colorPresets = {
  'Blue → Violet':  { l:[0.10,0.35,1.00], m:[0.88,0.88,0.96], r:[0.65,0.30,0.95] },
  'Deep Ocean':      { l:[0.02,0.15,0.45], m:[0.10,0.40,0.65], r:[0.05,0.25,0.55] },
  'Neon Mint':       { l:[0.10,1.00,0.55], m:[0.70,1.00,0.85], r:[0.20,0.90,0.70] },
  'Bubblegum':       { l:[0.95,0.15,0.50], m:[1.00,0.60,0.75], r:[0.80,0.10,0.65] },
  'Arctic':         { l:[0.55,0.85,0.95], m:[0.92,0.95,0.98], r:[0.35,0.55,0.90] },
  'Forest':          { l:[0.02,0.30,0.12], m:[0.15,0.45,0.20], r:[0.05,0.35,0.25] },
  'Monochrome':     { l:[0.35,0.35,0.38], m:[0.85,0.85,0.87], r:[0.55,0.55,0.58] },
};
function applyColorPreset(name) {
  const p = colorPresets[name]; if(!p) return;
  u.colLeft.value.set(p.l[0],p.l[1],p.l[2]);
  u.colMid.value.set(p.m[0],p.m[1],p.m[2]);
  u.colRight.value.set(p.r[0],p.r[1],p.r[2]);
}
applyColorPreset('Blue → Violet');

// (text texture updated in render loop)

// ── Resize ───────────────────────────────────────────────
updateSizes();
window.addEventListener('resize', updateSizes);

// ── Interaction ──────────────────────────────────────────
let fp=0.35,fv=0,ft=0.35,sq=0,sqv=0,wb=0,wbv=0;
let drag=false,dx0=0,df0=0;
canvas.addEventListener('mousedown',e=>{drag=true;dx0=e.clientX;df0=fp;wb=0;wbv=0;});
canvas.addEventListener('touchstart',e=>{drag=true;dx0=e.touches[0].clientX;df0=fp;wb=0;wbv=0;e.preventDefault();},{passive:false});
window.addEventListener('mousemove',e=>{if(!drag)return;const W=canvas.getBoundingClientRect().width*0.834;ft=Math.max(0.35,Math.min(0.94,df0+(e.clientX-dx0)/W));});
window.addEventListener('touchmove',e=>{if(!drag)return;const W=canvas.getBoundingClientRect().width*0.834;ft=Math.max(0.35,Math.min(0.94,df0+(e.touches[0].clientX-dx0)/W));e.preventDefault();},{passive:false});
window.addEventListener('mouseup',()=>{if(drag){drag=false;wbv=fv*22;}});
window.addEventListener('touchend',()=>{if(drag){drag=false;wbv=fv*22;}});

// ── Render loop ──────────────────────────────────────────
let prev=performance.now();
let lastPct=-1;
let firstFrame = true;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min((now-prev)*.001,.05); prev=now;
  fv+=((ft-fp)*300-fv*28)*dt; fp+=fv*dt;
  if(fp<0.35){fp=0.35;fv=Math.max(fv,0);} // hard stop
  if(fp>0.94){fp=0.94;fv=Math.min(fv,0);}
  sqv+=((fv*.65-sq)*160-sqv*11)*dt; sq+=sqv*dt; sq=Math.max(-1.5,Math.min(1.5,sq));
  wbv+=(-wb*110-wbv*6)*dt; wb+=wbv*dt; wb=Math.max(-1.0,Math.min(1.0,wb));
  const pct=Math.round((fp-0.35)/0.59*100);
  if(pct!==lastPct){lastPct=pct;updateTextTexture(pct);}
  u.fill.value=fp; u.squeeze.value=sq; u.wobble.value=wb;
  renderer.render(scene, camera);
  if(firstFrame){ firstFrame=false; document.getElementById('loader').classList.add('hidden'); }
}
requestAnimationFrame(frame);

// ── Tweakpane ────────────────────────────────────────────
const light={x:-0.2,y:3.0,z:0.8};
const shadowLight={x:-0.43,y:0.19,z:-0.43};
const cam={x:0.0,y:1.35,z:0.9};
const areaLights={bg:1.50,groove:0.89};
import('https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js').then(({Pane})=>{
  const pane=new Pane({title:'Controls',expanded:false});
  pane.element.style.position='fixed';pane.element.style.top='16px';pane.element.style.right='16px';pane.element.style.zIndex='100';pane.element.style.width='240px';
  const updateLight=()=>u.light.value.set(light.x,light.y,light.z);
  const lf=pane.addFolder({title:'Light Direction',expanded:true});
  lf.addBinding(light,'x',{min:-5,max:5,step:0.01,label:'X'}).on('change',updateLight);
  lf.addBinding(light,'y',{min:-5,max:5,step:0.01,label:'Y'}).on('change',updateLight);
  lf.addBinding(light,'z',{min:-5,max:5,step:0.01,label:'Z'}).on('change',updateLight);
  const updateShadowLight=()=>u.shadowLight.value.set(shadowLight.x,shadowLight.y,shadowLight.z);
  const sf=pane.addFolder({title:'Shadow Light',expanded:true});
  sf.addBinding(shadowLight,'x',{min:-5,max:5,step:0.01,label:'X'}).on('change',updateShadowLight);
  sf.addBinding(shadowLight,'y',{min:-5,max:5,step:0.01,label:'Y'}).on('change',updateShadowLight);
  sf.addBinding(shadowLight,'z',{min:-5,max:5,step:0.01,label:'Z'}).on('change',updateShadowLight);
  const updateCam=()=>u.cam.value.set(cam.x,cam.y,cam.z);
  const cf=pane.addFolder({title:'Camera Position',expanded:true});
  cf.addBinding(cam,'y',{min:0.1,max:5,step:0.01,label:'Y'}).on('change',updateCam);
  const af=pane.addFolder({title:'Area Lights',expanded:true});
  af.addBinding(areaLights,'groove',{min:0,max:2,step:0.01,label:'Groove'}).on('change',()=>{u.grooveLight.value=areaLights.groove;});
  const params={ao:3.55, opacity:0.65, shadowDark:0.32};
  pane.addBinding(params,'ao',{min:0,max:5,step:0.01,label:'AO Strength'}).on('change',()=>{u.aoStrength.value=params.ao;});
  pane.addBinding(params,'opacity',{min:0,max:1,step:0.01,label:'Jelly Opacity'}).on('change',()=>{u.opacity.value=params.opacity;});
  pane.addBinding(params,'shadowDark',{min:0,max:0.63,step:0.01,label:'Shadow Dark'}).on('change',()=>{u.shadowDark.value=params.shadowDark;});
  const presetNames=Object.keys(colorPresets);
  pane.addBlade({view:'list',label:'Color Theme',options:presetNames.map(n=>({text:n,value:n})),value:'Blue → Violet'}).on('change',(ev)=>{applyColorPreset(ev.value);});
});

} catch(e) {
  document.getElementById('log').style.display='block'; document.getElementById('log').textContent = 'Error: '+e.message+'\n'+(e.stack||'');
}
