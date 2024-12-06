
import {
  MeshBasicNodeMaterial,
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

export default class Backdrop {

	constructor( materialNode ) {

      this.material = materialNode;


      ////////////////////////////////////////////////////////////////////
      // setup:                                   ////////////////////////
      // ui for prototyping                    ////////////////////////
      ////////////////////////////////////////////////////////////////////

      const pane = new Pane({container:document.getElementById("tweak")});
      const setGamma = uniform( 0.87 );
      const setHorizon = uniform(0.36);
      const setMoonlight = uniform(5.0);
      const texture01 = WebGLAssets.shaderParams.texture01;
      const texture02 = WebGLAssets.shaderParams.texture02;
      const resx = uniform( window.innerWidth );
      const resy = uniform( window.innerHeight );

      const b = pane.addBinding(
        setGamma, 'value',
        {label: 'gamma', min: 0.40, max: 0.90, step: 0.01}
      );

      b.on('change', (ev) => {
        setGamma.value = ev.value;
      });

      const c = pane.addBinding(
        setHorizon, 'value',
        {label: 'horizon', min: 0.25, max: 0.50, step: 0.01}
      );

      c.on('change', (ev) => {
        setHorizon.value = ev.value;
      });      

      const d = pane.addBinding(
        setMoonlight, 'value',
        {label: 'moonlight', min: 5.00, max: 20.00, step: 0.10}
      );

      d.on('change', (ev) => {
        setMoonlight.value = ev.value;
      }); 


      const timer = time;

      const fbm = Fn( ( [ p ] ) => {

          return float(1.5000).mul(texture(texture01, p.mul(1.00)).x)
          .add( float(1.2500).mul(texture(texture01,p.mul(2.02)).x))
          .add( float(1.1250).mul(texture(texture01,p.mul(4.02)).x))
          .add( float(1.0675).mul(texture(texture01,p.mul(8.02)).x));

      } )

      const fbm2 = Fn( ( [ p ] ) => {

          return float(0.5000).mul(texture(texture01,p.mul(1.00)).x)
          .add( float(0.2500).mul(texture(texture01,p.mul(2.02)).x))
          .add( float(0.1250).mul(texture(texture01,p.mul(4.02)).x))
          .add( float(0.0675).mul(texture(texture01,p.mul(8.02)).x));

      } )
      
      const ApplyGamma = Fn( ( [ vLinear ] ) => {

          const kGamma = float(setGamma).toVar();
          return pow(vLinear,vec3(float(1.0).div(kGamma)));

      } )
     
      const backgrop = Fn(() => {

        const tick = mod( timer.mul(0.4), 458.0 ).toVar();
        const uv = screenUV.sub(0.5).mul(vec2(div(screenSize.x, screenSize.y), float(1.).negate())).mul(2.).toVar();

        //const aspect = vec2(div(screenSize.x, screenSize.y), 1).toVar();
        //let newUV = vec2(screenUV.x, screenUV.y.oneMinus()).sub(0.5).mul(aspect).mul(2);
        
        // camera
        const p = uv.toVar();
        p.addAssign(vec2(1.0,3.0).mul(float(0.002)).mul(float(2.0)).mul(cos(tick).mul(float(2.0).add(vec2(0.0,1.5)))));
        p.addAssign(vec2(1.0,3.0).mul(float(0.001)).mul(float(1.0)).mul(cos(tick).mul(float(5.0).add(vec2(1.0,4.5)))));
        p.mulAssign(float(0.95).add(float(0.05).mul(length(p))));
        const an = float(0.03).mul(sin( float(0.1).mul(tick))).toVar();
        const co = float(cos(an)).toVar();
        const si = float(sin(an)).toVar();
        p.assign(mat2( co, si.negate(), si, co ).mul(p));

        // water
        const q = vec2(p.x,float(1.0).negate()).div(p.y.sub(0.1)).toVar();
        q.y.sub(float(0.3).mul(tick.mul(0.001))); 
        const off = texture(texture01, float(0.1).mul(mod( tick.mul( 0.001 ), 2.0 ).mul(q).mul(vec2(1.0,float(2.0).oneMinus())).sub(vec2(float(0.0),float(0.007).mul(tick))).xy)).toVar();
        q.add(0.4).div(float(1.00).oneMinus().add(float(50.0).mul(off)));
        const col = vec3(texture( texture01, float(1.9).mul(q).mul(mod(tick.mul(0.0005),12.0)).mul(vec2(.5,8.0)).add(vec2(0.0,float(0.01).mul(tick)))).zyx).toVar();
        col.mulAssign(0.4);
        const re = float(float(1.0).sub(smoothstep( 0.0, 0.7, abs(p.x.sub(0.6)).sub(abs(p.y).mul(0.3).add(0.2))))).toVar();
        col.addAssign(float(0.1).mul(vec3(1.0,0.9,0.73)).mul(re).mul(0.2).mul(off.y).mul(5.0).mul( float(1.0).sub(col.x)));
        const re2 = float(1.0).sub(smoothstep( 0.0, 2.0, abs(p.x.sub(0.6)).sub(abs(p.y.add(0.2)).mul(0.85) ))).toVar();
        col.addAssign(float(0.5).mul(vec3(1.0,0.9,0.73)).mul(re).mul(0.2).mul(off.y).mul(setMoonlight).mul( float(1.0).sub(col.x)));
        
        // sky
        const sky = vec3(0.01, 0.03, 0.1).toVar();
        // stars    
        sky.addAssign(float(2.8).mul(smoothstep( 0.90,1.0,texture( texture02, float(3.5).mul(p.add(tick.mul(0.1)).mul(0.29))).x).mul(1.6)));
        sky.addAssign(float(2.1).mul(smoothstep( 0.50,1.0,texture( texture02, float(2.5).mul(p.div(0.01).add(tick).mul(0.02) )).y)));
        sky.addAssign(float(2.3).mul(pow(abs(float(0.5).sub(max(0.0,p.y))),5.0)));

        // clouds    
        const f = fbm( float(0.002).mul(vec2(p.x,1.0).div(p.y))).toVar();
        const cloud = vec3(vec3(0.3,0.4,0.5).mul(0.7).mul(float(1.0).sub(0.85).mul(sqrt(smoothstep(0.4,1.0,f))))).toVar();
        sky.assign(mix( sky, cloud, float(0.95).mul(smoothstep( 0.4, 0.6, f ) ) ) );
        sky.assign(mix( sky, vec3(0.33,0.34,0.35),pow(float(1.0).sub(max(0.0,p.y)),float(5.0).add(sin(timer).mul(2.0)))));
        col.assign(mix( col, sky, smoothstep(0.0,0.1,p.y)));

        // moon
        const ddd = length(p.sub(vec2(0.58,0.45))).toVar();
        const g = float(0.1).sub(smoothstep( float(0.2), float(0.21) , ddd.sub(float(0.10).mul(tick).mul(0.05)))).toVar();
        const moontex = float(0.8).add(0.2).mul(smoothstep(float(0.25), float(0.7), fbm2(float(0.3).add(sin(timer).mul(float(0.01).add(sin(timer).mul(0.018)))).mul(p.oneMinus())))).toVar();
        const moon = vec3(1.0,0.97,0.9).toVar();
        col.addAssign(moon.mul(exp(float(5.0).oneMinus().mul(ddd).add(float(moontex).mul(0.15).add(col)))));

        // horizon
        col.addAssign(float(setHorizon).mul(cos(tick.div(120.0))).mul(pow(clamp(float(1.0).sub(abs(p.y.add(0.96).oneMinus())),0.0,1.0),9.0)));

        // postprocess
        col.mulAssign(1.4);
        col.assign(pow( col, vec3(1.5,1.2,1.0)));
        col.assign(ApplyGamma(col));

        // blend-in
        col.mulAssign(smoothstep(0.0,4.0, tick ));

        return vec4(col,1.0);

      })()

      this.material.colorNode = backgrop;
   
    }    

}