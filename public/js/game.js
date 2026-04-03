// ===================== HELIX JUMP 3D GAME =====================
let gameActive = false;
let gameScene, gameCamera, gameRenderer, gameAnimFrame;
let ball, helix, platforms = [];
let ballVelocity = { x: 0, y: 0 };
let platformsPassed = 0;
let betAmount = 0;
let isCashingOut = false;
let touchStartX = 0;
let helixRotation = 0;
let targetRotation = 0;
let isDragging = false;
let lastMouseX = 0;
let cameraTargetY = 0;
let ballOnPlatform = true;
let currentPlatformIndex = 0;
let gameSpeed = 0;
let bounceCount = 0;
let platformColors;

// Platform configuration
const PLATFORM_COUNT = 40;
const PLATFORM_SPACING = 2.5;
const TOWER_RADIUS = 3;
const BALL_RADIUS = 0.35;
const GRAVITY = -0.015;
const BOUNCE_FORCE = 0.25;
const GAP_ANGLE = Math.PI * 0.45; // Size of gap in each platform ring

function startHelixGame(bet) {
  betAmount = bet;
  platformsPassed = 0;
  isCashingOut = false;
  gameActive = true;
  bounceCount = 0;

  initGame();
  animate();
}

function stopHelixGame() {
  gameActive = false;
  if (gameAnimFrame) cancelAnimationFrame(gameAnimFrame);
  if (gameRenderer) {
    gameRenderer.dispose();
    gameRenderer = null;
  }
  // Remove event listeners
  const canvas = document.getElementById('gameCanvas');
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mouseup', onMouseUp);
  canvas.removeEventListener('touchstart', onTouchStart);
  canvas.removeEventListener('touchmove', onTouchMove);
  canvas.removeEventListener('touchend', onTouchEnd);
}

function helixGameCashOut() {
  if (!gameActive) return;
  isCashingOut = true;
  gameActive = false;
  if (typeof onGameEnd === 'function') {
    onGameEnd(platformsPassed, true);
  }
}

function initGame() {
  const canvas = document.getElementById('gameCanvas');
  const container = document.getElementById('page-game');

  // Scene
  gameScene = new THREE.Scene();
  gameScene.background = new THREE.Color(0x0a0a1a);
  gameScene.fog = new THREE.Fog(0x0a0a1a, 15, 35);

  // Camera
  gameCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  gameCamera.position.set(0, 5, 10);
  gameCamera.lookAt(0, 0, 0);

  // Renderer
  gameRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  gameRenderer.setSize(window.innerWidth, window.innerHeight);
  gameRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gameRenderer.shadowMap.enabled = true;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  gameScene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  gameScene.add(dirLight);

  const pointLight1 = new THREE.PointLight(0x7c4dff, 1.5, 20);
  pointLight1.position.set(-5, 5, 0);
  gameScene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0xff1744, 1, 20);
  pointLight2.position.set(5, -5, 0);
  gameScene.add(pointLight2);

  // Colors for platforms
  platformColors = [
    0x7c4dff, 0x651fff, 0x6200ea, 0x536dfe,
    0x304ffe, 0x2979ff, 0x00e676, 0x00c853
  ];

  // Create central tower (cylinder)
  const towerGeometry = new THREE.CylinderGeometry(0.4, 0.4, PLATFORM_COUNT * PLATFORM_SPACING + 10, 16);
  const towerMaterial = new THREE.MeshPhongMaterial({
    color: 0x1a1a3e,
    emissive: 0x0a0a1a,
    shininess: 80
  });
  const tower = new THREE.Mesh(towerGeometry, towerMaterial);
  tower.position.y = -(PLATFORM_COUNT * PLATFORM_SPACING) / 2 + 5;
  gameScene.add(tower);

  // Create helix group (rotatable)
  helix = new THREE.Group();
  gameScene.add(helix);

  // Create platforms
  platforms = [];
  for (let i = 0; i < PLATFORM_COUNT; i++) {
    const y = -i * PLATFORM_SPACING;
    const gapStart = Math.random() * Math.PI * 2; // Random gap position
    const isBlack = Math.random() < 0.15 && i > 2; // 15% chance of danger platform

    const platform = createPlatformRing(y, gapStart, isBlack, i);
    platform.userData = {
      index: i,
      y: y,
      gapStart: gapStart,
      gapEnd: gapStart + GAP_ANGLE,
      isBlack: isBlack,
      passed: false
    };
    platforms.push(platform);
    helix.add(platform);
  }

  // Create ball
  const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 24);
  const ballMaterial = new THREE.MeshPhongMaterial({
    color: 0xff1744,
    emissive: 0x660000,
    shininess: 100
  });
  ball = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.position.set(TOWER_RADIUS * 0.6, 2, 0);
  ball.castShadow = true;
  gameScene.add(ball);

  // Reset state
  ballVelocity = { x: 0, y: 0 };
  helixRotation = 0;
  targetRotation = 0;
  cameraTargetY = ball.position.y;
  currentPlatformIndex = 0;
  gameSpeed = 0;

  // Input events
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  window.addEventListener('resize', onResize);
}

function createPlatformRing(y, gapStart, isBlack, index) {
  const group = new THREE.Group();
  group.position.y = y;

  const segments = 24;
  const segmentAngle = (Math.PI * 2) / segments;
  const gapEnd = gapStart + GAP_ANGLE;

  for (let s = 0; s < segments; s++) {
    const angle = s * segmentAngle;
    const nextAngle = (s + 1) * segmentAngle;

    // Check if this segment is in the gap
    let inGap = false;
    const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const normalizedGapStart = ((gapStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const normalizedGapEnd = ((gapEnd % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    if (normalizedGapStart < normalizedGapEnd) {
      inGap = normalizedAngle >= normalizedGapStart && normalizedAngle < normalizedGapEnd;
    } else {
      inGap = normalizedAngle >= normalizedGapStart || normalizedAngle < normalizedGapEnd;
    }

    if (inGap) continue;

    // Create segment
    const innerR = 0.6;
    const outerR = TOWER_RADIUS;
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
    shape.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
    shape.lineTo(Math.cos(nextAngle) * outerR, Math.sin(nextAngle) * outerR);
    shape.lineTo(Math.cos(nextAngle) * innerR, Math.sin(nextAngle) * innerR);
    shape.closePath();

    const extrudeSettings = { depth: 0.3, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    let color;
    if (isBlack) {
      color = 0x1a1a1a;
    } else {
      color = platformColors[index % platformColors.length];
    }

    const material = new THREE.MeshPhongMaterial({
      color: color,
      emissive: isBlack ? 0x000000 : new THREE.Color(color).multiplyScalar(0.2),
      shininess: 60,
      transparent: true,
      opacity: 0.9
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  // Add ring edge glow
  if (!isBlack) {
    const ringGeometry = new THREE.TorusGeometry(TOWER_RADIUS, 0.03, 8, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: platformColors[index % platformColors.length],
      transparent: true,
      opacity: 0.3
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  return group;
}

// ===================== INPUT HANDLERS =====================
function onMouseDown(e) {
  isDragging = true;
  lastMouseX = e.clientX;
}

function onMouseMove(e) {
  if (!isDragging) return;
  const deltaX = e.clientX - lastMouseX;
  targetRotation += deltaX * 0.01;
  lastMouseX = e.clientX;
}

function onMouseUp() {
  isDragging = false;
}

function onTouchStart(e) {
  e.preventDefault();
  isDragging = true;
  lastMouseX = e.touches[0].clientX;
}

function onTouchMove(e) {
  e.preventDefault();
  if (!isDragging) return;
  const deltaX = e.touches[0].clientX - lastMouseX;
  targetRotation += deltaX * 0.01;
  lastMouseX = e.touches[0].clientX;
}

function onTouchEnd() {
  isDragging = false;
}

function onResize() {
  if (!gameCamera || !gameRenderer) return;
  gameCamera.aspect = window.innerWidth / window.innerHeight;
  gameCamera.updateProjectionMatrix();
  gameRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ===================== GAME LOOP =====================
function animate() {
  if (!gameActive) return;
  gameAnimFrame = requestAnimationFrame(animate);

  // Smooth helix rotation
  helixRotation += (targetRotation - helixRotation) * 0.15;
  helix.rotation.y = helixRotation;

  // Apply gravity
  ballVelocity.y += GRAVITY;
  ball.position.y += ballVelocity.y;

  // Ball rotation (visual)
  ball.rotation.x += ballVelocity.y * 2;
  ball.rotation.z += 0.02;

  // Check platform collisions
  checkCollisions();

  // Update camera
  cameraTargetY += (ball.position.y - cameraTargetY + 3) * 0.05;
  gameCamera.position.y = cameraTargetY;
  gameCamera.position.x = Math.sin(helixRotation * 0.1) * 1;
  gameCamera.lookAt(0, cameraTargetY - 2, 0);

  // Check if ball fell too far
  const lowestPlatform = -(PLATFORM_COUNT - 1) * PLATFORM_SPACING - 5;
  if (ball.position.y < lowestPlatform) {
    gameOver(false);
    return;
  }

  // Add particles on bounce
  if (ballVelocity.y > 0.1) {
    addBounceEffect();
  }

  gameRenderer.render(gameScene, gameCamera);
}

function checkCollisions() {
  const ballY = ball.position.y;
  const ballAngle = Math.atan2(ball.position.z, ball.position.x);
  const ballDist = Math.sqrt(ball.position.x ** 2 + ball.position.z ** 2);

  // Keep ball at a fixed distance from center
  if (ballDist > 0.1) {
    const targetDist = TOWER_RADIUS * 0.5;
    ball.position.x = Math.cos(ballAngle) * targetDist;
    ball.position.z = Math.sin(ballAngle) * targetDist;
  }

  // Only check collision when falling
  if (ballVelocity.y >= 0) return;

  for (let i = 0; i < platforms.length; i++) {
    const pData = platforms[i].userData;
    const platformY = pData.y;

    // Check if ball is near this platform's height
    if (ballY < platformY + 0.5 && ballY > platformY - 0.3 && ball.position.y + ballVelocity.y <= platformY + 0.4) {
      // Get the ball's angle in the helix's rotated space
      const rotatedAngle = ((ballAngle - helixRotation) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
      const gapStart = ((pData.gapStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const gapEnd = ((pData.gapEnd % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

      // Check if ball is in the gap
      let inGap;
      if (gapStart < gapEnd) {
        inGap = rotatedAngle >= gapStart && rotatedAngle < gapEnd;
      } else {
        inGap = rotatedAngle >= gapStart || rotatedAngle < gapEnd;
      }

      if (inGap) {
        // Ball passes through the gap!
        if (!pData.passed) {
          pData.passed = true;
          platformsPassed++;
          if (typeof onPlatformPassed === 'function') {
            onPlatformPassed(platformsPassed);
          }
          // Visual feedback - make passed platform fade
          platforms[i].children.forEach(child => {
            if (child.material) {
              child.material.opacity = 0.3;
            }
          });
        }
      } else {
        // Ball hits platform
        if (pData.isBlack) {
          // Hit a danger platform - game over
          gameOver(false);
          return;
        }

        // Bounce!
        ball.position.y = platformY + 0.5;
        ballVelocity.y = BOUNCE_FORCE;
        bounceCount++;

        // Mark as passed if first time landing on it
        if (!pData.passed && i > currentPlatformIndex) {
          // Actually, in helix jump, you need to go THROUGH, not land on
          // Landing on a platform is fine, you just bounce
        }

        currentPlatformIndex = Math.max(currentPlatformIndex, i);
        break;
      }
    }
  }
}

function addBounceEffect() {
  // Simple particle effect using small spheres
  const particleCount = 5;
  for (let i = 0; i < particleCount; i++) {
    const geometry = new THREE.SphereGeometry(0.05, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0.8
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.copy(ball.position);

    // Random velocity
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.1 + 0.05;
    particle.userData.velocity = {
      x: Math.cos(angle) * speed,
      y: Math.random() * 0.1 + 0.05,
      z: Math.sin(angle) * speed
    };
    particle.userData.life = 30;

    gameScene.add(particle);

    // Animate and remove
    function animateParticle() {
      particle.position.x += particle.userData.velocity.x;
      particle.position.y += particle.userData.velocity.y;
      particle.position.z += particle.userData.velocity.z;
      particle.userData.velocity.y -= 0.003;
      particle.userData.life--;
      particle.material.opacity = particle.userData.life / 30;

      if (particle.userData.life <= 0) {
        gameScene.remove(particle);
        geometry.dispose();
        material.dispose();
      } else {
        requestAnimationFrame(animateParticle);
      }
    }
    animateParticle();
  }
}

function gameOver(success) {
  gameActive = false;

  // Flash effect
  if (ball) {
    ball.material.color.setHex(success ? 0x00e676 : 0xff1744);
    ball.material.emissive.setHex(success ? 0x004d25 : 0x660000);
  }

  setTimeout(() => {
    if (typeof onGameEnd === 'function') {
      onGameEnd(platformsPassed, false);
    }
  }, 500);
}
