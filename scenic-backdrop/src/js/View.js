

import * as THREE from 'three/tsl';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import Backdrop from './tsl/Backdrop.js';
import { WebGLAssets } from './utils/webgl-assets';
import { TweenMax, Back, Expo, Sine, Bounce, Quad, Cubic } from 'gsap';

let scope = null;

export default class View {
		
	constructor( rootElement, gpuTiersData ) {

		/* get device pixelratio */
    	let ratio = window.devicePixelRatio;
    	/* set antialising */
    	let aa = true;

    	if( gpuTiersData.isMobile ) {

    		WebGLAssets.isMobile = gpuTiersData.isMobile;

			if (gpuTiersData.tier > 1) {
				
				if (ratio > 1) {

					ratio = 0.8;

				} else {

					ratio = 0.75;
					aa = false;
				}
			}

	    } else {

	    	aa = true;
	      	if (ratio >= 2) ratio = 1.3;

	    }



    	////////////////////////////////////////////////////////////////////
    	// setup:                                   ////////////////////////
    	// threejs         						    ////////////////////////
    	////////////////////////////////////////////////////////////////////

    	scope = this;

		this.renderer = new THREE.WebGPURenderer({
			antialias: aa,
      		preserveDrawingBuffer: false,
      		alpha: false,
      		stencil:false,
      		powerPreference: 'high-performance'
		});

		this.renderer.setPixelRatio( ratio );
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		
		rootElement.appendChild( this.renderer.domElement );

		if( gpuTiersData.isMobile ) {

			this.renderer.setPixelRatio = ratio;
		}

		this.initView();
		WebGLAssets.loaded = true;

	}



	initView() {
		
		this.bg = 0;
    	this.width = window.innerWidth;
    	this.height = window.innerHeight;

		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this.scene = new THREE.Scene();


    	////////////////////////////////////////////////////////////////////
    	// setup:                                   ////////////////////////
    	// raymarcher.node               			////////////////////////
    	////////////////////////////////////////////////////////////////////

		const material = new THREE.MeshBasicNodeMaterial( { color: 0x00ff00 } );

		this.texture01 = new THREE.TextureLoader()
		.load( ['./textures/bmp01.jpg'], () => {
			
			this.texture01.anisotropy = 32;
			this.texture01.wrapS = THREE.RepeatWrapping;
			this.texture01.wrapT = THREE.RepeatWrapping;
			this.texture01.outputColorSpace = THREE.SRGBColorSpace;


			this.texture02 = new THREE.TextureLoader()
			.load( ['./textures/tex12.png'], () => {

				this.texture02.anisotropy = 32;
				this.texture02.wrapS = THREE.RepeatWrapping;
				this.texture02.wrapT = THREE.RepeatWrapping;
				this.texture02.outputColorSpace = THREE.SRGBColorSpace;

				this.plane = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), material );
				this.plane.frustumCulled = false;
				this.plane.renderOrder = 0;
				this.scene.add( this.plane );

				this.materialParams = {
					texture01: this.texture01,
					texture02: this.texture02
				}

				WebGLAssets.shaderParams = this.materialParams; 

				this.raymarch = new Backdrop( material );

				this.renderer.setAnimationLoop( this.animate );
				TweenMax.to( document.getElementById("loader"), 2.0, { autoAlpha:0, ease:Sine.easeOut } );

			});

		});
/*
		this.textureCube = new THREE.CubeTextureLoader()
		.setPath( './models/envMap/1/' ) 
		.load( [ 'px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png' ], () => {

			this.textureCube.anisotropy = 32;

			this.plane = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), material );
			this.plane.frustumCulled = false;
			this.plane.renderOrder = 0;
			this.scene.add( this.plane );

			this.materialParams = {
				cubeTex: this.textureCube,
			}

			WebGLAssets.shaderParams = this.materialParams; 

			this.textureCube1 = new THREE.CubeTextureLoader()
			.setPath( './models/envMap/6/' ) 
			.load( [ 'px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png' ], () => {

				this.textureCube1.anisotropy = 32;
				WebGLAssets.shaderParams.cubeTex1 = this.textureCube1;

				this.textureCube2 = new THREE.CubeTextureLoader()
				.setPath( './models/envMap/8/' ) 
				.load( [ 'px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png' ], () => {

					this.textureCube1.anisotropy = 32;
					WebGLAssets.shaderParams.cubeTex2 = this.textureCube2;

					this.raymarch = new Raymarch( material );

					this.renderer.setAnimationLoop( this.animate );
					TweenMax.to( document.getElementById("loader"), 2.0, { autoAlpha:0, ease:Sine.easeOut } );
				});

			});

		});
*/


    	////////////////////////////////////////////////////////////////////
    	// set:                                     ////////////////////////
    	// start rendering now         			    ////////////////////////
    	////////////////////////////////////////////////////////////////////

	    let canRenderEvent = new CustomEvent("canRender", { detail: "" });
	    document.dispatchEvent( canRenderEvent );
    	


    	////////////////////////////////////////////////////////////////////
    	// trigger: (once)                          ////////////////////////
    	// resize				                    ////////////////////////
    	////////////////////////////////////////////////////////////////////

		this.onWindowResize(window.innerWidth, window.innerHeight);

	}



    ////////////////////////////////////////////////////////////////////
    // resize                                   ////////////////////////
    // renderer, camera, postpro		        ////////////////////////
    ////////////////////////////////////////////////////////////////////
	
	onWindowResize(vpW, vpH) {

		this.renderer.setSize(vpW, vpH);

		this.camera.aspect = vpW / vpH;
		this.camera.updateProjectionMatrix();
	    
	}


    ////////////////////////////////////////////////////////////////////
    // update                                   ////////////////////////
    ////////////////////////////////////////////////////////////////////

	async animate() {

	    scope.renderer.render( scope.scene, scope.camera);

	}	

}