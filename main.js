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

let wyvernModel = null;
let isDisintegrating = false;
let particlesGroup = null;
let particlesData = [];

init();
animate();

function init() {
  container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

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
    isDisintegrating = false;
    wyvernModel = null;
    particlesGroup = null;
    particlesData = [];
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

  // The visual edge of the hole (crack graphic or border)
  const borderGeometry = new THREE.RingGeometry(0.5, 0.6, 32).rotateX(-Math.PI / 2);
  const borderMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
  const border = new THREE.Mesh(borderGeometry, borderMaterial);
  // Place it slightly above the ground to avoid Z-fighting
  border.position.y = 0.001; 
  portalGroup.add(border);

  // 4. Load the Wyvern inside the hole
  const loader = new GLTFLoader();
  loader.load('./Models/wyvern_animated_low.glb', (gltf) => {
    wyvernModel = gltf.scene;
    // Scale down if necessary
    wyvernModel.scale.set(15, 15, 15); 
    
    // Position deep inside the hole, with X and Z offsets so you aren't inside the massive body
    wyvernModel.position.set(-4, 2, -35);
    
    // Play animation
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(wyvernModel);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
    }

    portalGroup.add(wyvernModel);

    // Simple animation: make the dragon rise up
    const riseInterval = setInterval(() => {
        if (!wyvernModel) {
            clearInterval(riseInterval);
            return;
        }
        if (wyvernModel.position.y < 0.2) {
            wyvernModel.position.y += 0.005;
        } else {
            clearInterval(riseInterval);
        }
    }, 16);

  }, undefined, (error) => {
      console.error("Error loading wyvern model:", error);
  });

  return portalGroup;
}

function disintegrateWyvern() {
  if (!wyvernModel || isDisintegrating) return;
  isDisintegrating = true;
  
  particlesGroup = new THREE.Group();
  particlesGroup.position.copy(wyvernModel.position);
  particlesGroup.quaternion.copy(wyvernModel.quaternion);
  particlesGroup.scale.copy(wyvernModel.scale);

  wyvernModel.traverse((child) => {
    if (child.isMesh) {
      if (child.material) {
        child.material.transparent = true;
        child.material.needsUpdate = true;
      }

      const originalGeometry = child.geometry;
      const posAttribute = originalGeometry.attributes.position;
      const count = posAttribute.count;
      
      const multiplier = 3; // Increase number of particles by 3x
      const newPos = new Float32Array(count * multiplier * 3);
      const velocities = [];
      
      for (let i = 0; i < count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);
        
        for (let m = 0; m < multiplier; m++) {
          const idx = (i * multiplier + m) * 3;
          newPos[idx] = x + (Math.random() - 0.5) * 0.2;
          newPos[idx+1] = y + (Math.random() - 0.5) * 0.2;
          newPos[idx+2] = z + (Math.random() - 0.5) * 0.2;
          
          velocities.push(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5 + 2,
            (Math.random() - 0.5) * 5
          );
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
      geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));

      const material = new THREE.PointsMaterial({
        color: 0xa855f7,
        size: 0.02,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const points = new THREE.Points(geometry, material);
      particlesGroup.add(points);
      
      particlesData.push({ points: points, geometry: geometry, material: material });
    }
  });

  portalGroup.add(particlesGroup);
  // We don't remove wyvernModel here anymore so we can fade it out over time
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
  } else if (portalPlaced && !isDisintegrating) {
    disintegrateWyvern();
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

  if (isDisintegrating && particlesGroup) {
    if (wyvernModel) {
      let isFullyFaded = true;
      wyvernModel.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity -= delta * 1.5; // Fades out over ~0.66 seconds
          if (child.material.opacity > 0) {
            isFullyFaded = false;
          } else {
            child.material.opacity = 0;
          }
        }
      });
      if (isFullyFaded) {
        portalGroup.remove(wyvernModel);
        wyvernModel = null;
      }
    }

    particlesData.forEach(data => {
      const positions = data.geometry.attributes.position.array;
      const velocities = data.geometry.attributes.velocity.array;
      
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += velocities[i] * delta;
        positions[i+1] += velocities[i+1] * delta;
        positions[i+2] += velocities[i+2] * delta;
        
        // gravity
        velocities[i+1] -= 2.0 * delta;
      }
      data.geometry.attributes.position.needsUpdate = true;
      data.material.opacity -= delta * 0.5;
    });
  }

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
