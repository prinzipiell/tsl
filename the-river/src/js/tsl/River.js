
import {
  MeshBasicNodeMaterial,
  positionLocal,
  float,
  bool,
  Loop,
  If,
  Break,
  Fn,
  uv,
  vec3,
  time,
  sin,
  div,
  cos,
  min,
  mul,
  add,
  sub,
  mat2,
  mat3,
  mat4,
  mod,
  max,
  abs,
  mix,
  equal,
  and,
  normalize,
  dot,
  cross,
  int,
  pow,
  sqrt,
  clamp,
  reflect,
  vec2,
  exp,
  exp2,
  vec4,
  refract,
  negate,
  length,
  screenSize,
  assign,
  mulAssign,
  addAssign,
  subAssign,
  uniform,
  smoothstep,
  cubeTexture,
  texture,
  oneMinus,
  screenCoordinate,
  screenUV,
} from 'three/tsl';

import * as THREE from 'three';
import { WebGLAssets } from '../utils/webgl-assets';
import {Pane} from 'tweakpane';

export default class River {

	constructor( materialNode ) {

      this.material = materialNode;


      ////////////////////////////////////////////////////////////////////
      // setup:                                   ////////////////////////
      // ui for prototyping                    ////////////////////////
      ////////////////////////////////////////////////////////////////////

      const pane = new Pane({container:document.getElementById("tweak")});
      const setGamma = uniform( 0.87 );
      const setBrightness = uniform(0.125);
      const setTurbulence = uniform(349.0);
      const texture01 = WebGLAssets.shaderParams.texture01;
      const texture02 = WebGLAssets.shaderParams.texture02;
      const cubeMap = WebGLAssets.shaderParams.cubeTex;
      const resx = uniform( window.innerWidth );
      const resy = uniform( window.innerHeight );
      this.mouseX = uniform(WebGLAssets.shaderParams.mouseX);

      ////////////////////////////////////////////////////////////////////
      // add & listen to:                         ////////////////////////
      // mouse-event(s) -> down, up, move         ////////////////////////
      ////////////////////////////////////////////////////////////////////

      this.downFlag = false;

      document.addEventListener( 'pointerdown', e => {

        this.downFlag = true;

      });

      document.addEventListener( 'pointerup', e => {

        this.downFlag = false;

      });


      document.addEventListener( 'pointermove', e => {

        if( this.downFlag ) {
            this.mouseX.value = e.clientX / window.innerWidth;
        }

      });

      const b = pane.addBinding(
        setGamma, 'value',
        {label: 'gamma', min: 0.40, max: 0.90, step: 0.001}
      );

      b.on('change', (ev) => {
        setGamma.value = ev.value;
        this.downFlag = false;
      });

      const c = pane.addBinding(
        setBrightness, 'value',
        {label: 'bright water', min: 0.100, max: 0.550, step: 0.001}
      );

      c.on('change', (ev) => {
        setBrightness.value = ev.value;
        this.downFlag = false;
      });      

      const d = pane.addBinding(
        setTurbulence, 'value',
        {label: 'turbulence', min: 100.0, max: 400.0, step: 1.0}
      );

      d.on('change', (ev) => {
        setTurbulence.value = ev.value;
        this.downFlag = false;
      }); 


      const timer = time;
      const waveHeight = float(2.025).toVar(); // average surface height
      
      const ApplyGamma = Fn( ( [ vLinear ] ) => {
          const kGamma = float(setGamma).toVar();
          return pow(vLinear,vec3(float(1.0).div(kGamma)));
      } )

      const wave = Fn(([ p ]) => {
          const t = float(timer.mul(0.08)).toVar();
          const c1 = vec3(texture(texture01, p.xz.add(vec2(2.,2.0).mul(t).mul(1.1))).rgb).toVar();
          const c2 = vec3(texture(texture01, p.xz.add(vec2(2.52, .50).mul(t).mul(1.25))).rgb).toVar();
          const c3 = vec3(texture(texture01, p.xz.add(vec2(1.32,2.0).mul(t).mul(1.65))).rgb).toVar();
          c1.addAssign(c2.add(c3));
          const z = float(float(c1.x.add(c1.y).add(c1.z)).div(setTurbulence)).toVar();
          return p.y.add(z);
      } )

      const normWave = Fn(([ p ]) => {
          const e = vec2(.25,0.0).toVar();
          return normalize( vec3( wave( p.add( e.xyy ) ), wave( p.add( e.yxy ) ), wave( p.add( e.yyx ) ) ).sub( wave( p ) ) );
      } )

      const lightWave = Fn(([ ro, rd, d ]) => {
          const p = vec3( ro.add( rd.mul( d ) ) ).toVar();
          const sh = float( wave( p ).sub( mul( 3.5, waveHeight ) ) ).toVar();
          p.xz.addAssign( mul( 1., sh ).mul( rd.xz ) );
          sh.assign( wave( p ).sub( mul( 1.015, waveHeight ) ) );

          const n = vec3( normWave( p ) ).toVar(), l1 = vec3( normalize( vec3( int( 1 ) ) ) ).toVar();
          const nv = float( dot( rd, n ) ).toVar(), spc = float( pow( max( 0., dot( reflect( l1, n ), rd ) ), 120. ) ).toVar(), eta = float( 1.003 / 1.3 ).toVar(), waterdepth = float( 4.15 ).toVar();

          const rfd = vec3( refract( rd, n, eta ) ).toVar();
          const depthest = float( waterdepth.negate().div( rfd.y ) ).toVar();
          const ref = vec3( cubeTexture(cubeMap, reflect( rd, n ) ).rgb ).toVar(), rfa = vec3( texture( texture02, p.add( rfd.mul( depthest ) ).xz.div( 10.0 ) ).rgb ).toVar();

          const c = vec3(0.0).toVar();

          ref.mulAssign(0.35);
          rfa.mulAssign(exp2( float(setBrightness).negate().mul(depthest)));   

          return c.assign( rfa.add( ref ).add(spc) );
      } )

      const intersectWave = Fn(([ ro, rd ]) => {
          return float(ro.y.sub(waveHeight)).div(float(rd.y).negate());
      } )

      const cossin = Fn( ( [ angleRadians ] ) => {
          return sin(angleRadians.add(vec2(1.5708,0.0)));
      } )

      const river = Fn(() => {

        const aspect = vec2(div(screenSize.x, screenSize.y), 1);
        const newUV = vec2(positionLocal.xy).toVar();

        const qr = newUV;
        const cr = vec3(0.0).toVar();
        const rc = vec3(0.0).toVar(); // look at point, spins around
        const ro = ( vec3( mul( 5., cossin( add( 4., this.mouseX ) ) ), int( 8 ) ).xzy );
        const ww = vec3(normalize(rc.sub(ro))).toVar();
        const uu = vec3(normalize(cross(vec3(0.0,.1,0.0), ww))).toVar();
        const vv = vec3(normalize(cross(ww, uu))).toVar();
        const rd = vec3(normalize( (uu.mul(qr.x)).add( vv.mul(qr.y)).add(ww))).toVar();
        const d = float(intersectWave(ro, rd)).toVar();

        If( d.greaterThan( 0.0 ), () => {

            cr.assign(vec3(lightWave(ro, rd, d)));

        } );  

        // postprocess
        cr.mulAssign(1.4);
        cr.assign(pow( cr, vec3(1.5,1.2,1.0)));
        cr.assign(ApplyGamma(cr));

        return vec4(cr,1.0);

      })()

      this.material.colorNode = river;
   
    } 

    autoMouse() {

      if( !this.downFlag ) this.mouseX.value += 0.001;

    }   

}