
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
  cos,
  min,
  mat3,
  mat4,
  max,
  abs,
  mix,
  equal,
  and,
  normalize,
  dot,
  cross,
  int,
  reflect,
  vec2,
  exp,
  vec4,
  refract,
  negate,
  length,
  screenSize,
  assign,
  mulAssign,
  uniform,
  cubeTexture,
} from 'three/tsl';

import * as THREE from 'three';
import { WebGLAssets } from '../utils/webgl-assets';
import {Pane} from 'tweakpane';

export default class Raymarch {

	constructor( materialNode ) {

      this.material = materialNode;


      ////////////////////////////////////////////////////////////////////
      // setup:                                   ////////////////////////
      // ui for prototyping                    ////////////////////////
      ////////////////////////////////////////////////////////////////////

      const pane = new Pane({container:document.getElementById("tweak")});
      const doWobble = uniform( 0.0 );
      const background = uniform( 0.0 );
      const cubeMap = WebGLAssets.shaderParams.cubeTex;
      const cubeMap1 = WebGLAssets.shaderParams.cubeTex1;
      const cubeMap2 = WebGLAssets.shaderParams.cubeTex2;

      const b = pane.addBinding(
        doWobble, 'value',
        {label: 'wobble', min: 0, max: 1, step: 1}
      );

      b.on('change', (ev) => {
        doWobble.value = ev.value;
      });

      const c = pane.addBinding(
        background, 'value',
        {label: 'cubeTexture', min: 0, max: 2, step: 1}
      );

      c.on('change', (ev) => {
        background.value = ev.value;
      });



      const timer = time;

      const rotX = Fn(([a]) => {
        const c = float(cos(a)).toVar();
        const s = float(sin(a)).toVar();
        return mat3(1.0,0.0,0.0,0.0,c,s.negate(),0.0,s,c).toVar();
      })

      const rotY = Fn(([a]) => {
        const c = float(cos(a)).toVar();
        const s = float(sin(a)).toVar();
        return mat3(c,0.0,s,0.0,1.0,0.0,s.negate(),0.0,c).toVar();
      })

      const rotZ = Fn(([a]) => {
        const c = float(cos(a)).toVar();
        const s = float(sin(a)).toVar();
        return mat3(c,s.negate(),0.0,s,c,0.0,0.0,0.0,1.0).toVar();
      })

      const rot = Fn(([z,a]) => {
          const c = float( cos( a ) ).toVar();
          const s = float( sin( a ) ).toVar();
          const ic = float(float(1.0).sub(c) ).toVar();

          return mat3( ic.mul( z.x ).mul( z.x ).add( c ), ic.mul( z.x ).mul( z.y ).sub( z.z.mul( s ) ), ic.mul( z.z ).mul( z.x ).add( z.y.mul( s ) ), ic.mul( z.x ).mul( z.y ).add( z.z.mul( s ) ), ic.mul( z.y ).mul( z.y ).add( c ), ic.mul( z.y ).mul( z.z ).sub( z.x.mul( s ) ), ic.mul( z.z ).mul( z.x ).sub( z.y.mul( s ) ), ic.mul( z.y ).mul( z.z ).add( z.x.mul( s ) ), ic.mul( z.z ).mul( z.z ).add( c ) );
      })


      const smin = Fn(([a, b, k]) => {
        const h = max(k.sub(abs(a.sub(b))), 0).div(k)
        return min(a, b).sub(h.mul(h).mul(k).mul(0.25))
      })


      const sdf = Fn(([pos]) => {

          const d = float( 100.0 ).toVar();
          const p = vec3( pos ).toVar();
          const tp = vec3(0.0).toVar();
          const wobble = float(0.0).toVar();
          const wobbleFactor = float(float(4).negate().addAssign(sin(timer).mul(8))).toVar();

          const ii = int(0).toVar();

          ii.addAssign(1.0);
          tp.assign(p.mulAssign(rotX(timer.div(ii))));
          tp.mulAssign(rotZ(timer.div(ii)));

          const getWobble = float(doWobble).toVar();

          If( getWobble.greaterThan(0.0), () => {

              wobble.assign(sin(float(5).add(wobbleFactor).mul(p.x)).mul(sin(float(6).mul(p.y))).mul(sin(float(4).mul(p.z)))).mul(wobbleFactor.mulAssign(0.025));
              tp.x.addAssign(sin(wobble).mul(0.1));
              tp.y.addAssign(sin(wobble).mul(0.12));
              tp.z.addAssign(sin(wobble).mul(0.12));

          })

          d.assign( min(d,length( vec2(length(tp.xz).sub(1.0).mul(ii.sub(0.3)), tp.y)).sub(0.1)));

          ii.assign(int(1.0));
          ii.addAssign(1.0);
          tp.assign(p.mulAssign(rotX(timer.div(ii))));
          tp.mulAssign(rotZ(timer.div(ii)));
          
          If( getWobble.greaterThan(0.0), () => {

              wobble.assign(sin(float(5).add(wobbleFactor).mul(p.x)).mul(sin(float(6).mul(p.y))).mul(sin(float(4).mul(p.z)))).mul(wobbleFactor.mulAssign(0.025));
              tp.x.addAssign(sin(wobble).mul(0.15));
              tp.y.addAssign(sin(wobble).mul(0.12));

          })

          d.assign( min(d,length( vec2(length(tp.xz).sub(1.2).mul(ii.sub(1.3)), tp.y)).sub(0.1)));

          ii.assign(int(0.0));
          ii.addAssign(1.0);
          tp.assign(p.mulAssign(rotX(timer.div(ii))));
          tp.mulAssign(rotZ(timer.div(ii)));

          If( getWobble.greaterThan(0.0), () => {

              wobble.assign(sin(float(5).add(wobbleFactor).mul(p.x)).mul(sin(float(6).mul(p.y))).mul(sin(float(4).mul(p.z)))).mul(wobbleFactor.mulAssign(0.025));
              tp.x.addAssign(sin(wobble).mul(0.1));
              tp.z.addAssign(sin(wobble).mul(0.1));
          
          })

          d.assign( min(d,length( vec2(length(tp.xz).sub(0.5).mul(ii.sub(2.5)), tp.y)).sub(0.1)));

          ii.assign(int(1.0));
          ii.addAssign(1.0);
          tp.assign(p.mulAssign(rotX(timer.div(ii))));
          tp.mulAssign(rotZ(timer.div(ii)));

          If( getWobble.greaterThan(0.0), () => {

              wobble.assign(sin(float(5).add(wobbleFactor).mul(p.x)).mul(sin(float(6).mul(p.y))).mul(sin(float(4).mul(p.z)))).mul(wobbleFactor.mulAssign(0.025));/*.mul(sin(float(30).mul(p.y))).mul(sin(float(30).mul(p.z))).mul(wobbleFactor.mulAssign(0.025))*/;
              tp.y.addAssign(sin(wobble).mul(0.1));
              tp.z.addAssign(sin(wobble).mul(0.1));

          })

          d.assign( min(d,length( vec2(length(tp.xz).sub(0.8).mul(ii.sub(3.5)), tp.y)).sub(0.1)));


          return d;  
      })


      const normalCalculation = Fn( ( [ p_immutable, d_immutable ] ) => {

          const d = float( 0.0 ).toVar();
          d.addAssign(d_immutable);
          const p = vec3( 0.0 ).toVar();
          p.assign(p_immutable);
          const s = vec3( 0.1, 0.0, 0.0 ).toVar();

          return normalize( vec3( sdf( p.add( s.xyy.sub( d ) ) ), sdf( p.add( s.yxy.sub( d ) ) ), sdf( p.add( s.yyx.sub( d ) ) ) ) );

      } )


      const raymarch = Fn(() => {

        const _uv = uv().mul(screenSize.xy).mul(2).sub(screenSize.xy).div(screenSize.y);

        const upVec = vec3(0.0,-1.0,0.0).toVar();
        const lookPos = vec3(0.0,0.0,0.0).toVar();
        const eyePos = vec3(0.0,0.0,-2.4).toVar(); 

        eyePos.mulAssign(rotX(sin(timer.mul(0.5))));
        eyePos.mulAssign(rotY(sin(timer.mul(0.5))));

        const rayVec = vec3(normalize(lookPos.sub(eyePos))).toVar();

        const leftVec = vec3(normalize(cross(upVec,rayVec))).toVar();
        const eyeUpVec = vec3(normalize(cross(rayVec,leftVec))).toVar();
          
        rayVec.mulAssign(rot(eyeUpVec, _uv.x.mul(0.7)));
        rayVec.mulAssign(rot(leftVec, _uv.y.mul(1.0)));

        const rayPos = vec3(0.0).toVar();
        rayPos.assign(eyePos);
        const attenuation = vec4(1.0).toVar();
        const color = vec4(1.0,0.95,1.0,1.0).toVar();
        const hit = bool( false ).toVar();


        const marchLen = float(0.0).toVar();

        Loop({ start: 1, end: 100 }, () => {

          const d = sdf(rayPos).toVar();

          If( d.lessThan(0.0).and( hit.equal( false ) ), () => {
              hit.assign( true );
              const n = normalCalculation( rayPos, d ).toVec3();
              rayVec.assign( refract( rayVec, n, 0.66666666666 ) );
              attenuation.mulAssign( color.mul( abs( dot( rayVec, n ) ) ) );

          }).ElseIf( d.greaterThan( 0.0 ).and( hit.equal( true ) ), () => {
              hit.assign( false );
              const n = normalCalculation( rayPos, d ).toVec3();
              rayVec.assign( refract( rayVec, n.negate(), 0.66666666666 ) );
              attenuation.mulAssign( color.mul( abs( dot( rayVec, n ) ) ) );
          } );

          marchLen.assign( max( 0.001, abs( d ) ) );
          rayPos.addAssign( rayVec.mul(marchLen));

        })
        
        const finalColor = cubeTexture(cubeMap1, rayVec).toVar();
        const getBackground = float(background).toVar();

        If( getBackground.lessThan(1.0), () => {

            finalColor.assign(cubeTexture(cubeMap, rayVec));

        }).ElseIf( getBackground.greaterThan( 1.0 ), () => {

            finalColor.assign(cubeTexture(cubeMap2, rayVec));

        });

        return finalColor.mulAssign(attenuation);   

      })()

      this.material.colorNode = raymarch;
   
    }    

}