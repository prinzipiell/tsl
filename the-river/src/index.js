
import { getGPUTier } from 'detect-gpu';
import View from "./js/View";
import { WebGLAssets } from './js/utils/webgl-assets';


/* Define DOM elements */
const rootElement = document.querySelector('#root');
const contentElement = document.querySelector('#content-wrapper');

let view;
let gpuDetected, render = false;


////////////////////////////////////////////////////////////////////
// initialize                               ////////////////////////                                ////////////////////////
////////////////////////////////////////////////////////////////////

class App {

    

    ////////////////////////////////////////////////////////////////////
    ///// get: GPU info(s) + init               ////////////////////////  
    ////////////////////////////////////////////////////////////////////
    
    constructor() {

        (async () => {

            const data = await getGPUTier({});    
            this.view = new View( rootElement, data );
          
            window.addEventListener("resize", this.resize);
          
            this.gpuDetected = true;

        })();

        document.addEventListener("canRender", (e) => {

            this.render = true;

        } );

    }



    ////////////////////////////////////////////////////////////////////
    ///// resize: core                          ////////////////////////  
    ////////////////////////////////////////////////////////////////////

    resize = () => {
        if( this.gpuDetected && this.render ) this.view.onWindowResize( window.innerWidth, window.innerHeight );
    }

}

const app = new App();
