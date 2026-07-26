import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let container;
let camera, scene, renderer;
let controller;

let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

let portalGroup;
let mixer; // For dragon animation
const clock = new THREE.Clock();
let portalPlaced = false;

init();
animate();

function init() {
  container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // Setup Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // AR Button setup
  const arButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] });
  document.getElementById('ar-button-container').appendChild(arButton);
  
  // Hide HTML UI when entering AR
  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('in-ar');
  });
  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('in-ar');
    portalPlaced = false;
    if (portalGroup) {
        scene.remove(portalGroup);
        portalGroup = null;
    }
  });

  // Setup Controller (Tap to place)
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // Reticle (the target ring on the floor)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9f7aea })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener('resize', onWindowResize);
}

function createPortalMask() {
  portalGroup = new THREE.Group();

  // 1. The Occluder (The invisible mask that creates the "hole" effect)
  // We make a box that extends downwards, and we render it invisibly, but it blocks depth.
  const maskGeometry = new THREE.BoxGeometry(2, 2, 2);
  
  // We need to punch a hole in the top of the box. 
  // An easier way is to create 4 walls around the hole instead.
  const wallMaterial = new THREE.MeshBasicMaterial({ 
    colorWrite: false, // Don't draw color (invisible)
    depthWrite: true   // Do write to depth buffer (blocks things behind it)
  });

  // Create walls for the hole (Size of hole: 1x1 meter)
  const wallThickness = 2;
  const holeSize = 1.0;
  const depth = 2.0;

  // Left wall
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, depth, holeSize + wallThickness*2), wallMaterial);
  leftWall.position.set(-holeSize/2 - wallThickness/2, -depth/2, 0);
  
  // Right wall
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, depth, holeSize + wallThickness*2), wallMaterial);
  rightWall.position.set(holeSize/2 + wallThickness/2, -depth/2, 0);
  
  // Front wall
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(holeSize, depth, wallThickness), wallMaterial);
  frontWall.position.set(0, -depth/2, holeSize/2 + wallThickness/2);
  
  // Back wall
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(holeSize, depth, wallThickness), wallMaterial);
  backWall.position.set(0, -depth/2, -holeSize/2 - wallThickness/2);

  // Bottom wall (floor of the hole)
  const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(holeSize, wallThickness, holeSize), wallMaterial);
  bottomWall.position.set(0, -depth - wallThickness/2, 0);

  const occluderGroup = new THREE.Group();
  occluderGroup.add(leftWall, rightWall, frontWall, backWall, bottomWall);
  portalGroup.add(occluderGroup);

  // 2. The visual edge of the hole (crack graphic or border)
  const borderGeometry = new THREE.RingGeometry(0.5, 0.6, 32).rotateX(-Math.PI / 2);
  const borderMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
  const border = new THREE.Mesh(borderGeometry, borderMaterial);
  // Place it slightly above the ground to avoid Z-fighting
  border.position.y = 0.001; 
  portalGroup.add(border);

  // 3. Inner Walls of the hole (darkness)
  const innerWallGeometry = new THREE.CylinderGeometry(0.5, 0.5, depth, 32, 1, true);
  const innerWallMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
  const innerWalls = new THREE.Mesh(innerWallGeometry, innerWallMaterial);
  innerWalls.position.y = -depth/2;
  portalGroup.add(innerWalls);

  // 4. Load the Wyvern inside the hole
  const loader = new GLTFLoader();
  loader.load('./Models/wyvern_animated_low.glb', (gltf) => {
    const wyvern = gltf.scene;
    // Scale down if necessary
    wyvern.scale.set(15, 15, 15); 
    
    // Position deep inside the hole
    wyvern.position.set(0, -1.5, 0);
    
    // Play animation
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(wyvern);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
    }

    portalGroup.add(wyvern);

    // Simple animation: make the dragon rise up
    const riseInterval = setInterval(() => {
        if (wyvern.position.y < 0.2) {
            wyvern.position.y += 0.005;
        } else {
            clearInterval(riseInterval);
        }
    }, 16);

  }, undefined, (error) => {
      console.error("Error loading wyvern model:", error);
  });

  return portalGroup;
}

function onSelect() {
  if (reticle.visible && !portalPlaced) {
    const portal = createPortalMask();
    
    // Place portal at reticle position
    portal.position.setFromMatrixPosition(reticle.matrix);
    portal.quaternion.setFromRotationMatrix(reticle.matrix);
    
    scene.add(portal);
    portalPlaced = true;
    reticle.visible = false; // Hide reticle once placed
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace('viewer').then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      
      if (hitTestResults.length && !portalPlaced) {
        const hit = hitTestResults[0];
        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}
