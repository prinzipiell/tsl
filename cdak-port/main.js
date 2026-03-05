
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break,
  uniform, float, vec2, vec3, vec4, mat3,
  abs, min, max, clamp,
  sin, cos, sqrt, pow,
  floor, fract, step, smoothstep,
  dot, length, normalize,
  mix,
  uv, screenCoordinate, screenSize,
  texture as samplerTex
} from 'three/tsl';

// ── renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.toneMapping       = THREE.NoToneMapping;
renderer.outputColorSpace  = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ── uniforms ──────────────────────────────────────────────────────────────────
const uTime = uniform( 0.0 );   // demo time (seconds * 20)
const uMX   = uniform( 0.5 );   // mouse x  0-1
const uMY   = uniform( 0.5 );   // mouse y  0-1
const uGlow       = uniform( 0.10 );   // glow intensity multiplier
const uBlend    = uniform( 0.0  );   // blend: 0=warped intro, 1=normal
// Edge colour channel weights — control the R/G/B tones of geometry edges
// Original: sv²×(0.5,0.01,1) + sz²×(0.02,1,1)  gives orange/cyan split
const uEdgeR    = uniform( 0.50 );  // edge red   weight (Sobel-Y)
const uEdgeG    = uniform( 0.01 );  // edge green weight (Sobel-Y)
const uEdgeB    = uniform( 1.00 );  // edge blue  weight (Sobel-Y) — kept constant
const uEdgeXR   = uniform( 0.02 );  // edge red   weight (Sobel-X)
const uEdgeXG   = uniform( 1.00 );  // edge green weight (Sobel-X) — kept constant
// Gamma tint — per-channel power curve, controls warm/cool output tone
const uGammaR   = uniform( 2.02 );
const uGammaG   = uniform( 1.68 );
const uGammaB   = uniform( 1.38 );
// Fog colour multiplier (fog = h.x * uFogBright, grey fog by default)
const uFogBright  = uniform( 24.0 );
const uFogDensity = uniform( 5.0 );  // fog depth divisor — lower = more fog
// Light direction tint (vec3 in diffuse calc)
const uLightR   = uniform( 0.14 );
const uLightG   = uniform( 0.47 );
const uLightB   = uniform( 0.33 );

// ── render target (pass0 → pass1) ─────────────────────────────────────────────
const rt = new THREE.RenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter
});

// =============================================================================
//  SHARED HELPER NODES
// =============================================================================

// h — float4 automation/mouse uniform (h.x intensity, h.z mouseX*0.01, h.w mouseY)
const H = Fn(() => {
  const hx = float(0.02).sub( sin(uTime.mul(0.1)).mul(0.01) );
  return vec4( hx, float(0.0), uMX.mul(0.01), uMY );
});

// r(g) — euler angles → mat3  (g *= 6.283 then standard ZYX)
// TSL mat3(col0,col1,col2)
const R = Fn(([g]) => {
  const G = g.mul(6.283);
  const a=cos(G.x), b=sin(G.x), c=cos(G.y), d=sin(G.y), e=cos(G.z), f=sin(G.z);
  return mat3(
    vec3( c.mul(e).add(b.mul(d).mul(f)),   c.mul(f).sub(b.mul(d).mul(e)),   a.mul(d) ),
    vec3( a.mul(f).negate(),                a.mul(e),                         b        ),
    vec3( b.mul(c).mul(f).sub(d.mul(e)),   d.mul(f).negate().sub(b.mul(c).mul(e)),  a.mul(c) )
  );
});

// w() — camera rotation matrix
const W = Fn(() => {
  const h = H();
  return R(
    vec3(0.0, 0.0, smoothstep(float(-7.0), float(30.0), uTime))
      .add( vec3(1.0,2.0,3.0).mul( smoothstep(float(170.0), float(300.0), uTime) ) )
      .add( sin( vec3(5.0,6.0,7.0).mul( h.z.mul(100.0).add(uTime.mul(0.002)) ) )
              .mul(0.08)
              .mul( float(2.0).sub( sin( h.z.mul(2222.0).sub(h.w) ) ) ) )
  );
});

// =============================================================================
//  SDF FUNCTIONS
// =============================================================================

// f1(p) — tunnel geometry
const f1 = Fn(([pIn]) => {
  const p  = pIn.toVar();
  const t  = uTime;

  const rotArg = sin(p.z.mul(0.07)).mul(vec3(0.0,0.0,0.3))
                   .mul( smoothstep(float(150.0), float(60.0), p.z) );
  const rotP = p.add( sin(p.yzx.mul(0.1)).div(3.0) ).mul( R(rotArg) );
  const g  = fract(rotP.div(6.0)).sub(0.5).mul(6.0).toVar();

  const d1 = float(2.4).mul(smoothstep(float(20.0),float(70.0),t)).sub(abs(p.x)).sub(1.0).toVar();
  const d2 = max(abs(g.x), max(abs(g.y), abs(g.z))).sub(2.3).toVar();
  const d3 = length(p.sub(vec3(0.0,0.0,84.0))).sub(18.0).toVar();

  d1.assign( mix(
    d1,
    min( max(d1, float(-0.7).sub(d2)),  max(d2.sub(0.3), abs(d1.sub(0.9)).sub(1.3)) ),
    clamp( p.z.mul(0.03).sub(0.5).add(sin(p.z.mul(0.1)).mul(0.1)), 0.0, 1.0 )
  ));

  d1.assign( max( max(d1, float(25.0).sub(p.z)), p.z.sub(116.0) ) );

  d1.assign( min(
    min(
      max( d1, min(
        float(11.0).sub(abs(d3)),
        max( p.z.negate().add(84.0),
             abs( length(p.xy).sub(1.3).add(sin(p.z.mul(0.9)).div(5.0)) ).sub(0.2) )
      )),
      max( d1.add(0.5), abs(d3.sub(4.0)).sub(0.5) )
    ).sub( float(0.3).mul(smoothstep(float(60.0),float(110.0),t)) ),
    max(
      float(111.0).sub(p.z),
      min(
        float(7.0).sub(length(p.xy).div(2.0))
          .sub( sin(p.z.mul(0.3).add(sin(p.z.mul(2.0)).div(25.0)).add(t.div(5.0))).mul(6.0) ),
        max( p.x.negate().add(p.z.sub(105.0).mul(0.1)), abs(p.y).sub(1.8) )
      )
    )
  ));

  const gg = p.sub(vec3(0.0,0.0,44.0)).mul(
    R( pow( smoothstep(float(36.0),float(4.0),t).mul(vec3(1.0,2.0,3.0)), vec3(2.0) )
         .mul( step(p.z.negate(), float(-15.0)) ) )
  ).toVar();

  If( t.lessThan(44.0), () => {
    d1.assign( mix(
      d1,
      max(abs(gg.x), max(abs(gg.y),abs(gg.z))).sub(4.0)
        .sub( float(15.0).mul(smoothstep(float(27.0),float(36.0),t)) ),
      smoothstep(float(44.0),float(30.0),t)
    ));
  });

  d1.assign( min( d1,
    float(0.8).mul( max(
      p.z.sub(14.0),
      abs( length(p.xy).sub(1.5).sub(sin(floor(p.z)).div(5.0)) ).sub(1.0)
    ))
  ));
  return d1;
});

// f2(p) — metaballs
const f2 = Fn(([pIn]) => {
  const p = pIn.toVar();
  const t = uTime;
  p.z.subAssign(138.0);

  const ln =
    pow( float(1.0).div(length(p.add(sin(t.mul(vec3(5.1,7.6,1.0).mul(0.023))).mul(3.0)))), float(2.0) ).add(
    pow( float(1.0).div(length(p.add(sin(t.mul(vec3(4.5,2.7,2.0).mul(0.033))).mul(3.0)))), float(2.0) )).add(
    pow( float(1.0).div(length(p.add(sin(t.mul(vec3(6.3,3.7,4.0).mul(0.031))).mul(3.0)))), float(2.0) )).add(
    pow( float(1.0).div(length(p.add(sin(t.mul(vec3(7.5,6.3,5.0).mul(0.023))).mul(3.0)))), float(2.0) ));

  const d1 = float(1.0).div(sqrt(ln)).sub(1.0).toVar();
  d1.assign( min(
    mix(
      d1.sub(0.7),
      min( abs(d1.add(0.3)).sub(0.3), abs(d1.sub(0.7)).mul(2.0).sub(0.3) ),
      smoothstep(float(150.0),float(230.0), t.sub(p.y.div(9.0)))
    ),
    abs(d1.sub(5.0)).sub(1.0).add( float(4.2).mul(smoothstep(float(210.0),float(150.0), t.add(p.y.div(5.0)))) )
  ).add( float(2.0).mul(smoothstep(float(230.0),float(270.0), t.add(p.y))) ) );
  return d1;
});

// k() — camera position
const K = Fn(() => {
  const t = uTime;
  return vec3(0.0, 0.1, float(-0.1).sub(float(2.0).mul(smoothstep(float(170.0),float(190.0),t))))
    .mul( W() )
    .add( vec3(0.0, 0.0, smoothstep(float(-0.07),float(1.0),t.mul(0.005)).mul(140.0)) );
});

// f(p) — combined SDF
const F = Fn(([pIn]) => {
  const p  = pIn.add(0.01).toVar();
  const t  = uTime;
  const h  = H();
  const d1 = float(95.0).sub(length(p.sub(K()))).toVar();

  If( t.lessThan(280.0), () => {
    d1.assign( min(d1, f1(p)).add( float(14.0).mul(smoothstep(float(140.0),float(230.0),t)) ) );
  });
  If( t.greaterThan(130.0), () => {
    d1.assign( min(d1, f2(p)) );
  });

  d1.mulAssign(0.3);
  const pp = p.mul(0.3).toVar();

  // for(float i=0;i<4;i++) fractal detail
  Loop(4, ({ i }) => {
    const fi = float(i);
    const q = vec3(1.0).add(
      fi.mul(fi).mul(0.18).mul(
        vec3(1.0).add(
          float(4.0)
            .mul( float(1.0).add(float(0.3).mul(sin(t.mul(0.001)))) )
            .mul( sin(
              vec3(5.7,6.4,7.3).mul(fi).mul(1.145)
                .add( float(0.3).mul(sin(h.w.mul(0.015))).mul(fi.add(3.0)) )
            ))
        )
      )
    );
    const gv = fract(pp.mul(q)).sub(0.5).div(q);
    d1.assign( min(
      d1.add(0.03),
      max(d1, max(abs(gv.x), max(abs(gv.y),abs(gv.z))).sub(0.148) )
    ));
  });

  return d1.div(0.28);
});

// nn(p) — normal via central differences
const NN = Fn(([p]) => {
  const e = float(4e-3);
  return normalize(vec3(
    F(p.add(vec3(e,0,0))).sub(F(p.sub(vec3(e,0,0)))),
    F(p.add(vec3(0,e,0))).sub(F(p.sub(vec3(0,e,0)))),
    F(p.add(vec3(0,0,e))).sub(F(p.sub(vec3(0,0,e))))
  )).negate();
});

// u(p,y) — AO  (original: for i=0;i<1;i+=.25 → 4 steps)
const U = Fn(([p, y]) => {
  const o   = float(0.8).toVar();
  const hit = float(F(p).lessThan(0.01));
  const step_ = (i) => {
    const fi = float(i);
    const d  = fi.mul(0.15).add(0.025);
    o.subAssign( hit.mul( d.sub(F(p.sub(y.mul(d)))) ).mul(2.0).mul(float(2.0).sub(fi.mul(1.8))) );
  };
  step_(0.0); step_(0.25); step_(0.5); step_(0.75);
  return o;
});

// =============================================================================
//  PASS 0  — raymarcher  →  rt (stores vec4(z, glow, ao, depth))
// =============================================================================
const pass0 = Fn(() => {
  const t   = uTime;
  const h   = H();
  const res = screenSize.xy;
  // screenCoordinate is fragment pixel position (0..res), no +0.5 needed in TSL
  const vp  = screenCoordinate.xy;

  // ray direction — matches HLSL: normalize(float3(2*sin((vp-.5-j/2)/j.y), cos(...)))
  const off = vp.sub(res.mul(0.5)).div(res.y);
  // Fisheye: equidistant projection — wider FOV, barrel distortion
  const fishR = length(off).mul(2.8);  // radial distance scaled for ~150° FOV
  const rd  = normalize(vec3(
    sin(off.x).mul(3.2),
    sin(off.y).mul(3.2),
    cos( fishR )
  )).mul(W()).toVar();

  const cp = K().toVar();
  const a  = cp.toVar();
  const p  = cp.toVar();
  const g  = float(0.0).toVar();
  const df = F(cp).add(0.002).toVar();

  Loop(90, () => {
    If( abs(df).lessThanEqual(0.00032), () => { Break(); });
    g.addAssign( smoothstep(float(0.5),float(0.07),df).mul(0.01).mul(float(1.0).sub(g)) );
    p.addAssign( rd.mul( df.add(float(0.000001).mul(length(p.sub(a)))) ) );
    df.assign( F(p) );
  });

  const n  = NN(p);
  const d  = length(p.sub(a));
  const o  = U(p, n);

  // z = 2*pow(.5 + dot(n, normalize(sin(p.yzx/5 + h.w + float3(.14,.47,.33)*t))) / 2, .5)
  const ldir = normalize( sin( p.yzx.div(5.0).add(h.w).add(vec3(uLightR,uLightG,uLightB).mul(t)) ) );
  const z = float(2.0).mul( pow(float(0.5).add(dot(n,ldir).mul(0.5)), float(0.5)) ).toVar();

  // Surface detail — original: sin(floor(vec3)) used as float via implicit cast
  // In HLSL, float3 → float cast takes .x — we replicate that with .x
  const sf = sin(
    floor( p.mul(1.6).add(sin(floor(p.yzx.mul(3.0))).mul(3.0)) )
      .add( sin(floor(p.zxy.mul(1.7))) )
  ).x;

  const isin = sin(
    floor(
      p.mul(3.0).add(t.mul(0.1))
        .add( sin(floor(p.yzx.mul(133.0))).mul(0.24).div(d)
                .mul(sin(t.mul(0.3).add(floor(p.zxy.mul(0.15))))) )
    ).add( sin(floor(p.yzx.mul(7.0))) )
  );

  // Original: sin(floor(p.z)*3 + floor(p.x + sin(floor(p.yzx*15))))
  // sin(floor(vec3)) → float via implicit cast (.x in HLSL)
  const sfz = sin(
    floor(p.z).mul(3.0).add( floor(p.x.add(sin(floor(p.yzx.mul(15.0))).x)) )
  );

  z.mulAssign(
    float(1.0)
      .add( float(0.8).div(pow(d.add(0.5),float(0.6))).mul(sf) )
      .add( float(0.7).mul(
        sin(
          t.mul(0.08)
            .add(length(isin).mul(4.0))
            .add(step(
              length(fract(p.xy.mul(7.0)).sub(0.5))
                .add(float(0.6).mul(sin(length(sin(t.mul(vec2(0.5,0.7)).add(floor(p.xy.mul(7.0)))))))),
              float(0.5)
            ))
        ).mul(sfz)
      ))
  );

  z.addAssign( pow(float(0.45).add(float(0.45).mul(sin(o.mul(38.0).add(t)))), float(19.0)).mul(uGlow) );

  // store clamped z so pass1 glow (z^2) doesn't blow out
  return vec4(clamp(z, float(0.0), float(4.0)), g, o, d);
});

// =============================================================================
//  PASS 1  — post-process (Sobel edge + colour grade)
//  Translated line-by-line from original HLSL p1()
// =============================================================================

// q(uvs) — HLSL: float3 q(sampler s, float2 x)
//   float4 c=tex2D(s,x), d=3/pow(c.w,.15);
//   return saturate(c.x/d)*d;
// d is scalar (float4 broadcast), result is float (scalar)
const Q = Fn(([uvs]) => {
  const c  = samplerTex(rt.texture, uvs);
  const dv = float(3.0).div(pow(c.w, float(0.15)));
  return clamp(c.x.div(dv), float(0.0), float(1.0)).mul(dv);
});

const pass1 = Fn(() => {
  const t   = uTime;
  const h   = H();
  const res = screenSize.xy;
  const fc  = screenCoordinate.xy;  // pixel coords

  // blend = min(2*abs(sin(0.1*t * PI/3.2)), 1.0)
  // but we drive it externally via uBlend for JS-controlled fade
  const blend = uBlend;

  // Warped UV matching original "zoom XY" blend:
  // uv.x = 1 + (mod(fc.x - sin(t)*fc.y - res.x/2, res.x/4*(-1.5*blend+0.501)+res.x/4) - fc.x) / res.x
  // uv.y = 1 + (mod(fc.y + sin(t)*fc.x - res.y/2, res.y/4*(-1.5*blend+0.501)+res.y/4) - fc.y) / res.y
  // period for mod: res/4 * (-1.5*blend+0.501) + res/4
  const periodX = res.x.mul(0.25).mul(float(-1.5).mul(blend).add(0.501)).add(res.x.mul(0.25));
  const periodY = res.y.mul(0.25).mul(float(-1.5).mul(blend).add(0.501)).add(res.y.mul(0.25));

  // mod(a,b) = a - b*floor(a/b)
  const argX = fc.x.sub(sin(t).mul(fc.y)).sub(res.x.mul(0.5));
  const argY = fc.y.add(sin(t).mul(fc.x)).sub(res.y.mul(0.5));
  const modX = argX.sub(periodX.mul(floor(argX.div(periodX))));
  const modY = argY.sub(periodY.mul(floor(argY.div(periodY))));

  // uv.x = 1 + (modX - fc.x) / res.x
  const uvWarpX = float(1.0).add(modX.sub(fc.x).div(res.x));
  const uvWarpY = float(1.0).add(modY.sub(fc.y).div(res.y));
  // sample UV: original uses (1-uv) to flip, giving [0,1]
  const uvC = vec2(float(1.0).sub(uvWarpX), float(1.0).sub(uvWarpY));

  const samp = samplerTex(rt.texture, uvC);
  const c_in = samp.x;      // z (scalar, used as float3 via broadcast in HLSL)
  const b    = samp.yzw;    // b.x=g(glow), b.y=o(AO), b.z=d(depth)

  // float2 w=4e-4/j*j.x/pow(b.z+.03,.5)*(pow(b.y,2)+.1)
  const ww = vec2(4e-4, 4e-4)
    .div(res)
    .mul(res.x)
    .div(pow(b.z.add(0.03), float(0.5)))
    .mul(pow(b.y, float(2.0)).add(0.1));

  // 8 Sobel neighbours — each returns a scalar float
  const _11 = Q(uvC.add(ww.mul(vec2(-1.0,-1.0))));
  const _12 = Q(uvC.add(ww.mul(vec2( 0.0,-1.0))));
  const _13 = Q(uvC.add(ww.mul(vec2( 1.0,-1.0))));
  const _21 = Q(uvC.add(ww.mul(vec2(-1.0, 0.0))));
  const _23 = Q(uvC.add(ww.mul(vec2( 1.0, 0.0))));
  const _31 = Q(uvC.add(ww.mul(vec2(-1.0, 1.0))));
  const _32 = Q(uvC.add(ww.mul(vec2( 0.0, 1.0))));
  const _33 = Q(uvC.add(ww.mul(vec2( 1.0, 1.0))));

  // float3 v = _13+2*_23+_33 - (_11+2*_21+_31)  (Sobel Y — all scalars, stored as float3)
  // float3 z = _11+2*_12+_13 - (_31+2*_32+_33)  (Sobel X)
  // HLSL stores these as float3 but they're all scalar — the colour comes from
  // the per-channel WEIGHTS applied below: float3(.5,.01,1) and float3(.02,1,1)
  const sv = _13.add(_23.mul(2.0)).add(_33).sub(_11.add(_21.mul(2.0)).add(_31));
  const sz = _11.add(_12.mul(2.0)).add(_13).sub(_31.add(_32.mul(2.0)).add(_33));

  // Original:
  // c=lerp(
  //   (saturate(pow(sqrt(v*v*float3(.5,.01,1)+z*z*float3(.02,1,1)),.5)*.4/pow(b.z,.3))
  //    *sqrt(h.x*50+1)
  //    + b.x*b.x*12/pow(b.z+.5,.6)
  //   )*pow(b.y,1.1)*1.04,
  //   h.x*70+h.x*smoothstep(50,10,t)*2,
  //   saturate(b.z/110-.1+h.x*3));
  //
  // Key: v*v*float3(.5,.01,1) + z*z*float3(.02,1,1) gives different R/G/B weights
  // making the edges coloured (orange/cyan tones)
  const sv2 = sv.mul(sv);
  const sz2 = sz.mul(sz);
  const edgeVec = vec3(
    sv2.mul(uEdgeR).add(sz2.mul(uEdgeXR)),   // R: Sobel-Y * uEdgeR  + Sobel-X * uEdgeXR
    sv2.mul(uEdgeG).add(sz2.mul(uEdgeXG)),   // G: Sobel-Y * uEdgeG  + Sobel-X * uEdgeXG
    sv2.mul(uEdgeB).add(sz2.mul(uEdgeB))     // B: both weighted by uEdgeB
  );

  // pow(sqrt(...), .5) = 4th root
  const edgeMag = sqrt(sqrt(edgeVec));  // 4th root, same as pow(x, 0.25)

  const edgeTerm = clamp(
    edgeMag.mul(0.4).div(pow(b.z, float(0.3))),
    0.0, 1.0
  ).mul(sqrt(h.x.mul(50.0).add(1.0)));

  // b.x = g (volumetric glow channel from pass0)
  const glowTerm = b.x.mul(b.x).mul(12.0).div(pow(b.z.add(0.5), float(0.6))).mul(uGlow);

  // combine edge + glow, modulate by AO (b.y)
  const lit = edgeTerm.add(glowTerm).mul(pow(b.y, float(1.1))).mul(1.04);

  // fog colour and blend
  const fogCol = vec3(h.x.mul(uFogBright).add(h.x.mul(smoothstep(float(50.0), float(10.0), t)).mul(2.0)));
  const fogT   = clamp(b.z.div(uFogDensity).sub(0.0).add(h.x.mul(3.0)), 0.0, 1.0);

  const c = mix(lit, fogCol, fogT).toVar();

  // c=pow(c+saturate(1-c)*b.x, 1.8*float3(1.8,1.2,1.1)-1+9/t+.1/(pow(h.x*20,float3(3,4,3))+.05))*2
  // b.x here = g (glow) — adds glow back into the colour before gamma
  // 9/t: big at start (high contrast), settles as demo progresses
  const tSafe = max(t, float(1.0));
  const gamma = vec3(uGammaR, uGammaG, uGammaB).mul(1.8).sub(1.0)
    .add(float(9.0).div(tSafe))
    .add(float(0.1).div(pow(vec3(h.x.mul(20.0)), vec3(3.0, 4.0, 3.0)).add(0.05)));

  // original: pow(c + saturate(1-c)*b.x, gamma) * 2
  // do NOT pre-clamp c — let values flow naturally through gamma, *2 is intentional boost
  c.assign(
    pow(
      c.add(clamp(vec3(1.0).sub(c), 0.0, 1.0).mul(b.x)),
      gamma
    ).mul(2.0)
  );





  return vec4(c, 1.0);
});

// =============================================================================
//  Scenes & materials
// =============================================================================
const cam    = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const geo    = new THREE.PlaneGeometry(2,2);
const scene0 = new THREE.Scene();
const scene1 = new THREE.Scene();

const { MeshBasicNodeMaterial } = THREE;

const mat0 = new MeshBasicNodeMaterial();
mat0.colorNode = pass0();
mat0.toneMapped = false;
mat0.depthTest  = false;
mat0.depthWrite = false;

const mat1 = new MeshBasicNodeMaterial();
mat1.colorNode = pass1();
mat1.toneMapped = false;
mat1.depthTest  = false;
mat1.depthWrite = false;

scene0.add(new THREE.Mesh(geo,         mat0));
scene1.add(new THREE.Mesh(geo.clone(), mat1));

// =============================================================================
//  Events
// =============================================================================
// ── Tweakpane UI ──────────────────────────────────────────────────────────────
const params = {
  lookX:   /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent) ? 0.428 : 0.696,
  lookY:   1.0,
  speed:   1.0,
  glow:      0.34,
  edgeR:   0.50,
  edgeG:   0.01,
  edgeB:   1.00,
  edgeXR:  0.02,
  edgeXG:  1.00,
  gammaR:  2.02,
  gammaG:  1.68,
  gammaB:  1.38,
  fogBright: 24.0,
  fogDensity: 5.0,
  lightR:  0.14,
  lightG:  0.47,
  lightB:  0.33,
};

// Sync all uniforms from params immediately
uMX.value        = params.lookX;
uMY.value        = params.lookY;
uGlow.value       = params.glow;
uEdgeR.value     = params.edgeR;
uEdgeG.value     = params.edgeG;
uEdgeB.value     = params.edgeB;
uEdgeXR.value    = params.edgeXR;
uEdgeXG.value    = params.edgeXG;
uGammaR.value    = params.gammaR;
uGammaG.value    = params.gammaG;
uGammaB.value    = params.gammaB;
uFogBright.value  = params.fogBright;
uFogDensity.value = params.fogDensity;
uLightR.value    = params.lightR;
uLightG.value    = params.lightG;
uLightB.value    = params.lightB;

// Load Tweakpane dynamically — shader runs fine without it
async function initPane() {
  try {
    await new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://cdn.jsdelivr.net/npm/tweakpane@3.1.10/dist/tweakpane.min.js';
      el.onload = resolve; el.onerror = reject;
      document.head.appendChild(el);
    });

    const pane = new Tweakpane.Pane({ container: document.getElementById('pane-container'), title: 'CONTROLS', expanded: false });

    const camFolder = pane.addFolder({ title: 'Camera Look', expanded: true });
    camFolder.addInput(params, 'lookX', { min: 0.0, max: 1.0, step: 0.001, label: 'Yaw' })
      .on('change', () => { uMX.value = params.lookX; });
    camFolder.addInput(params, 'lookY', { min: 0.0, max: 2.0, step: 0.001, label: 'Pitch' })
      .on('change', () => { uMY.value = params.lookY; });

    const demoFolder = pane.addFolder({ title: 'Demo', expanded: true });
    demoFolder.addInput(params, 'glow',  { min: 0.0, max: 3.0,  step: 0.01, label: 'Glow' })
      .on('change', () => { uGlow.value = params.glow; });

    const edgeFolder = pane.addFolder({ title: 'Edge Colours', expanded: false });
    edgeFolder.addInput(params, 'edgeR',  { min: 0.0, max: 2.0, step: 0.01, label: 'R (Sobel-Y)' })
      .on('change', () => { uEdgeR.value  = params.edgeR; });
    edgeFolder.addInput(params, 'edgeG',  { min: 0.0, max: 2.0, step: 0.01, label: 'G (Sobel-Y)' })
      .on('change', () => { uEdgeG.value  = params.edgeG; });
    edgeFolder.addInput(params, 'edgeB',  { min: 0.0, max: 2.0, step: 0.01, label: 'B (both)' })
      .on('change', () => { uEdgeB.value  = params.edgeB; });
    edgeFolder.addInput(params, 'edgeXR', { min: 0.0, max: 2.0, step: 0.01, label: 'R (Sobel-X)' })
      .on('change', () => { uEdgeXR.value = params.edgeXR; });
    edgeFolder.addInput(params, 'edgeXG', { min: 0.0, max: 2.0, step: 0.01, label: 'G (Sobel-X)' })
      .on('change', () => { uEdgeXG.value = params.edgeXG; });

    const toneFolder = pane.addFolder({ title: 'Tone / Gamma', expanded: false });
    toneFolder.addInput(params, 'gammaR',    { min: 0.5, max: 4.0,   step: 0.01, label: 'Gamma R' })
      .on('change', () => { uGammaR.value    = params.gammaR; });
    toneFolder.addInput(params, 'gammaG',    { min: 0.5, max: 4.0,   step: 0.01, label: 'Gamma G' })
      .on('change', () => { uGammaG.value    = params.gammaG; });
    toneFolder.addInput(params, 'gammaB',    { min: 0.5, max: 4.0,   step: 0.01, label: 'Gamma B' })
      .on('change', () => { uGammaB.value    = params.gammaB; });


    const fogFolder = pane.addFolder({ title: 'Fog', expanded: false });
    fogFolder.addInput(params, 'fogBright',  { min: 0.0, max: 200.0, step: 1.0, label: 'Brightness' })
      .on('change', () => { uFogBright.value  = params.fogBright; });
    fogFolder.addInput(params, 'fogDensity', { min: 5.0, max: 200.0, step: 1.0, label: 'Density (lower=more)' })
      .on('change', () => { uFogDensity.value = params.fogDensity; });

  } catch(e) { console.warn('Tweakpane unavailable:', e); }
}
initPane();

// Camera look controlled via Tweakpane sliders only

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rt.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================================
//  Boot
// =============================================================================

async function boot() {
  await renderer.init();
  const el = document.getElementById('loading');
  el.style.opacity = '0';
  setTimeout(() => el.style.display = 'none', 900);

  const FADE_MS = 6000;
  const LOOP_START = 36.2;
  let fadeStart = performance.now();
  let loopOffset = fadeStart - (LOOP_START / params.speed) * 1000.0;
  let fadeComplete = false;
  let fadeReverse = false;  // true = warp closing (1→0), false = warp opening (0→1)

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (!fadeComplete) {
      const p = Math.min((now - fadeStart) / FADE_MS, 1.0);
      if (fadeReverse) {
        // Warp closing: blend 1→0, shader keeps playing
        uBlend.value = 1.0 - p;
        uTime.value = (now - loopOffset) / 1000.0 * params.speed;
        if (p >= 1.0) {
          // Snap loopOffset so opening warp starts exactly at LOOP_START
          loopOffset = now - (LOOP_START / params.speed) * 1000.0;
          fadeReverse = false;
          fadeComplete = false;
          fadeStart = now;
          uBlend.value = 0.0;
          uTime.value = LOOP_START;  // hard snap uTime to 50 this one frame
          uGlow.value = params.glow;  // reset glow to default
        }
      } else {
        // Warp opening: blend 0→1, shader plays from LOOP_START
        uBlend.value = p;
        uTime.value = (now - loopOffset) / 1000.0 * params.speed;
        if (p >= 1.0) {
          fadeComplete = true;
        }
      }
    } else {
      uTime.value = (now - loopOffset) / 1000.0 * params.speed;
      uBlend.value = 1.0;
      // Ramp glow from default to 1.50 between t=200 and t=220
      const glowRamp = Math.min(Math.max((uTime.value - 200.0) / 20.0, 0.0), 1.0);
      uGlow.value = params.glow + glowRamp * (1.50 - params.glow);
      // Only trigger reverse once — when uTime first crosses 235
      if (uTime.value > 235.0 && !fadeReverse) {
        fadeComplete = false;
        fadeReverse = true;
        fadeStart = now;
      }
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene0, cam);
    renderer.setRenderTarget(null);
    renderer.render(scene1, cam);
  });
}

boot().catch(err => {
  const el = document.getElementById('loading');
  el.style.opacity = '1';
  el.style.display = 'flex';
  el.style.color   = '#f55';
  el.textContent   = 'ERROR: ' + err.message;
  console.error(err);
});
