import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float,
  uv, time, uniform,
  floor, fract, step, mod,
  cos, sin, max, dot, mix,
  normalize, pow
} from 'three/tsl';
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';

// ═══════════════════════════════════════════════════════════════════
//  TSL uniforms — driven by Tweakpane PARAMS
// ═══════════════════════════════════════════════════════════════════
const uSpeed        = uniform( 1.0 );
const uScale        = uniform( 20.0 );
const uWarp         = uniform( 0.245 );
const uSpec         = uniform( 24.0 );
const uSurfaceColor = uniform( new THREE.Color( 0x80ff33 ) );
const uSpecColor    = uniform( new THREE.Color( 0xffffff ) );

// ═══════════════════════════════════════════════════════════════════
//  TSL: psrdnoise
//  © Stefan Gustavson & Ian McEwan, MIT
//
//  GLSL signature:  float psrdnoise(vec2 x, vec2 period, float alpha, out vec2 gradient)
//  TSL return:      vec3  — .x = noise value, .yz = gradient
//  (period is hardcoded vec2(0,0) — no tiling — matching mainImage)
// ═══════════════════════════════════════════════════════════════════
const psrdnoise = Fn( ([ x, alpha ]) => {

  // Skew input coords to triangular grid
  const uvc = vec2( x.x.add( x.y.mul( 0.5 ) ), x.y );
  const i0  = floor( uvc );
  const f0  = fract( uvc );

  // Which triangle half?
  const cmp = step( f0.y, f0.x );
  const o1  = vec2( cmp, cmp.oneMinus() );

  // Integer coords of the three triangle vertices
  const i1  = i0.add( o1 );
  const i2  = i0.add( 1.0 );

  // Back to unskewed space
  const v0  = vec2( i0.x.sub( i0.y.mul( 0.5 ) ),             i0.y              );
  const v1  = vec2( v0.x.add( o1.x ).sub( o1.y.mul( 0.5 ) ),  v0.y.add( o1.y ) );
  const v2  = vec2( v0.x.add( 0.5 ),                           v0.y.add( 1.0 )  );

  // Offset vectors from each vertex to x
  const x0  = x.sub( v0 );
  const x1  = x.sub( v1 );
  const x2  = x.sub( v2 );

  // Non-periodic: integer grid coords directly (period == vec2(0))
  const iu  = vec3( i0.x, i1.x, i2.x );
  const iv  = vec3( i0.y, i1.y, i2.y );

  // Polynomial hash → gradient angle psi
  const h0  = mod( iu, 289.0 );
  const h1  = mod( h0.mul( 51.0 ).add( 2.0 ).mul( h0 ).add( iv ), 289.0 );
  const h2  = mod( h1.mul( 34.0 ).add( 10.0 ).mul( h1 ),          289.0 );

  const psi = h2.mul( 0.07482 ).add( alpha );
  const gx  = cos( psi );
  const gy  = sin( psi );

  // Radial kernel weights: w = max(0.8 - |xi|², 0)
  const ww  = max(
    vec3( dot(x0,x0), dot(x1,x1), dot(x2,x2) ).negate().add( 0.8 ),
    0.0
  );
  const ww2 = ww.mul( ww );
  const ww4 = ww2.mul( ww2 );

  // dot(gradient_i, offset_i) for each of the 3 vertices
  const gdotx = vec3(
    dot( vec2( gx.x, gy.x ), x0 ),
    dot( vec2( gx.y, gy.y ), x1 ),
    dot( vec2( gx.z, gy.z ), x2 )
  );

  // Noise value: 10.9 * Σ ww4_i * (g_i · x_i)
  const nv  = dot( ww4, gdotx ).mul( 10.9 );

  // Analytical gradient:
  //   vertex 0: ww4.x * vec2(gx.x,gy.x) + dw.x * x0
  //   vertex 1: ww4.y * vec2(gx.y,gy.y) + dw.y * x1
  //   vertex 2: ww4.z * vec2(gx.z,gy.z) + dw.z * x2
  const dw  = ww2.mul( ww ).mul( gdotx ).mul( -8.0 );

  const grad = vec2( gx.x, gy.x ).mul( ww4.x ).add( x0.mul( dw.x ) )
    .add( vec2( gx.y, gy.y ).mul( ww4.y ).add( x1.mul( dw.y ) ) )
    .add( vec2( gx.z, gy.z ).mul( ww4.z ).add( x2.mul( dw.z ) ) )
    .mul( 10.9 );

  // Return packed: .x = noise value, .yz = gradient
  return vec3( nv, grad.x, grad.y );

} );

// ═══════════════════════════════════════════════════════════════════
//  TSL: main color node
// ═══════════════════════════════════════════════════════════════════
const colorNode = Fn( () => {

  // uv() is [0,1] — centre and scale to match original nscale=8
  const v     = uv().sub( 0.5 ).mul( uScale );
  const alpha = time.mul( uSpeed );

  // ── Octave 1 ────────────────────────────────────────────────────
  const r0   = psrdnoise( v, alpha );
  const n0   = r0.x;
  const gsum = vec2( r0.y, r0.z ).toVar();

  // ── Octave 2 — domain-warped by gsum ────────────────────────────
  const warpedPos = v.mul( 2.0 ).add( gsum.mul( uWarp ) );
  const r1   = psrdnoise( warpedPos, alpha.mul( 2.0 ) );
  const n1   = r1.x;
  gsum.addAssign( vec2( r1.y, r1.z ) );

  // ── Combine ─────────────────────────────────────────────────────
  const n    = float( 0.5 ).add( n0.mul( 0.4 ) ).add( n1.mul( 0.2 ) );

  // ── Bump normal from gradient → Blinn-Phong ─────────────────────
  const N    = normalize( vec3( gsum.x.negate(), gsum.y.negate(), 1.0 ) );
  const L    = normalize( vec3( 1.0, 1.0, 1.0 ) );
  const s    = pow( max( dot( N, L ), 0.0 ), uSpec );

  // ── Colour ──────────────────────────────────────────────────────
  const col  = mix( uSurfaceColor.mul( n ), uSpecColor, s );

  return vec4( col, 1.0 );

} );

// ═══════════════════════════════════════════════════════════════════
//  Three.js scene — WebGPU renderer + fullscreen quad
// ═══════════════════════════════════════════════════════════════════
const canvas   = document.getElementById( 'c' );
const renderer = new THREE.WebGPURenderer( { canvas, antialias: true } );
await renderer.init();
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
renderer.setSize( innerWidth, innerHeight );

const scene    = new THREE.Scene();
const camera   = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );

const material = new THREE.MeshBasicNodeMaterial();
material.colorNode = colorNode();

scene.add( new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), material ) );

window.addEventListener( 'resize', () => {
  renderer.setSize( innerWidth, innerHeight );
  renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
} );

// ═══════════════════════════════════════════════════════════════════
//  Tweakpane GUI
// ═══════════════════════════════════════════════════════════════════
const PARAMS = {
  speed:        1.0,
  scale:        20.0,
  warp:         0.245,
  specular:     24.0,
  surfaceColor: '#80ff33',
  specColor:    '#ffffff',
};

const pane = new Pane({
  title:     'Pustule',
  container: document.getElementById( 'pane-container' ),
});

const fShader = pane.addFolder( { title: 'Shader', expanded: true } );
fShader.addBinding( PARAMS, 'speed',    { label: 'Speed',       min: 0,   max: 4,   step: 0.01  } );
fShader.addBinding( PARAMS, 'scale',    { label: 'Scale',       min: 2,   max: 20,  step: 0.1   } );
fShader.addBinding( PARAMS, 'warp',     { label: 'Domain Warp', min: 0,   max: 0.5, step: 0.005 } );
fShader.addBinding( PARAMS, 'specular', { label: 'Shininess',   min: 10,  max: 60,  step: 0.5   } );

const fColor = pane.addFolder( { title: 'Colour', expanded: true } );
fColor.addBinding( PARAMS, 'surfaceColor', { label: 'Surface',  view: 'color' } );
fColor.addBinding( PARAMS, 'specColor',    { label: 'Specular', view: 'color' } );

const PRESETS = [
  { label: 'Colorset 01', surfaceColor: '#80ff33', specColor: '#ffffff' },
  { label: 'Colorset 02', surfaceColor: '#ff4400', specColor: '#ffdd88' },
  { label: 'Colorset 03', surfaceColor: '#00aaff', specColor: '#e8f8ff' },
  { label: 'Colorset 04', surfaceColor: '#6633ff', specColor: '#ccbbff' },
  { label: 'Colorset 05', surfaceColor: '#cc8800', specColor: '#fffbe0' },
  { label: 'Colorset 06', surfaceColor: '#00ff88', specColor: '#aaffdd' },
];

const fPresets = pane.addFolder( { title: 'Presets', expanded: true } );
PRESETS.forEach( p => {
  fPresets.addButton( { title: p.label } ).on( 'click', () => {
    PARAMS.surfaceColor = p.surfaceColor;
    PARAMS.specColor    = p.specColor;
    pane.refresh();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Render loop
// ═══════════════════════════════════════════════════════════════════
const fpsEl  = document.getElementById( 'fps' );
let fCount   = 0;
let fpsLast  = performance.now();

renderer.setAnimationLoop( () => {

  uSpeed.value        = PARAMS.speed;
  uScale.value        = PARAMS.scale;
  uWarp.value         = PARAMS.warp;
  uSpec.value         = PARAMS.specular;
  uSurfaceColor.value.set( PARAMS.surfaceColor );
  uSpecColor.value.set(    PARAMS.specColor    );

  fCount++;
  const now = performance.now();
  if ( now - fpsLast >= 500 ) {
    fpsEl.textContent = Math.round( fCount * 1000 / ( now - fpsLast ) ) + ' fps';
    fCount  = 0;
    fpsLast = now;
  }

  renderer.render( scene, camera );

} );
