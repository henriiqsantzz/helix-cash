// ===================== HELIX JUMP 3D GAME =====================
// Three.js WebGL Helix Jump - matches helixball.online reference
// Uses: Three.js r160, CylinderGeometry arcs, PerspectiveCamera

(function() {
  'use strict';

  // ===================== GAME CONFIG =====================
  const CONFIG = {
    platformCount: 25,
    platformSpacing: 4,
    platformRadius: 3,
    platformHeight: 0.5,
    postRadius: 1,
    postHeight: 200,
    ballRadius: 0.4,
    ballBounceForce: 0.28,
    gravity: 0.012,
    segmentsPerPlatform: 8,
    holeSegments: 1.25,
    cameraFov: 65,
    cameraZ: 10,
    cameraFollowSpeed: 0.08,
    rotationSensitivity: 0.008,
    dangerChance: 0.12,
    targetMultiplier: 8,
    radialSegments: 32
  };

  // Color palettes (matching reference)
  const PALETTES = [
    { name: 'Rose', platforms: 0xFF9E9D, platformsAlt: 0xFFBEB8, ball: 0xBF1F50, pole: 0xC2285B, bgTop: '#FFE4EE', bgBottom: '#FFB3CB', killer: 0x4A0020 },
    { name: 'Ocean', platforms: 0x7CB8E8, platformsAlt: 0x9DD0F5, ball: 0x2060A0, pole: 0x1A4A80, bgTop: '#E0F0FF', bgBottom: '#A0C8F0', killer: 0x1A1A3A },
    { name: 'Mint', platforms: 0x8CE8A5, platformsAlt: 0xB0F5C0, ball: 0x208A40, pole: 0x1A6A30, bgTop: '#E0FFE8', bgBottom: '#A0F0B0', killer: 0x1A3A1A },
    { name: 'Sunset', platforms: 0xE8C88C, platformsAlt: 0xF5DCA0, ball: 0xA07020, pole: 0x805A18, bgTop: '#FFF5E0', bgBottom: '#F0D0A0', killer: 0x3A2A1A },
    { name: 'Lavender', platforms: 0xC88CE8, platformsAlt: 0xDCA0F5, ball: 0x7020A0, pole: 0x5A1880, bgTop: '#F0E0FF', bgBottom: '#D0A0F0', killer: 0x2A1A3A },
  ];

  // ===================== GAME STATE =====================
  let gameActive = false;
  let betAmount = 0;
  let platformsPassed = 0;
  let isCashingOut = false;
  let gamePhase = 'ready'; // ready, playing, gameover
  let prizeAmount = 0;
  let currentPaletteIndex = 0;
  let comboCount = 0;
  let comboTimer = 0;

  // Three.js objects
  let scene, camera, renderer;
  let helixGroup, postMesh, ballMesh;
  let platforms = [];
  let animFrame = null;

  // Ball physics
  let ballVelY = 0;
  let ballWorldY = 0;

  // Input
  let isDragging = false;
  let lastDragX = 0;
  let helixRotation = 0;

  // Camera
  let cameraTargetY = 0;

  // HUD
  let hudContainer = null;

  // Clouds
  let cloudMeshes = [];

  // ===================== PUBLIC API =====================
  window.startHelixGame = function(bet) {
    betAmount = bet;
    platformsPassed = 0;
    isCashingOut = false;
    gameActive = true;
    prizeAmount = 0;
    comboCount = 0;
    comboTimer = 0;
    currentPaletteIndex = 0;
    gamePhase = 'ready';

    initGame();
    animate();
  };

  window.stopHelixGame = function() {
    gameActive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    removeEvents();
    cleanupHUD();
    cleanupThree();
  };

  window.helixGameCashOut = function() {
    if (!gameActive || gamePhase !== 'playing') return;
    isCashingOut = true;
    gameActive = false;
    gamePhase = 'gameover';
    if (typeof onGameEnd === 'function') {
      onGameEnd(platformsPassed, true);
    }
  };

  // ===================== INIT =====================
  function initGame() {
    cleanupThree();

    const canvas = document.getElementById('gameCanvas');
    const container = canvas.parentElement;
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, W / H, 0.1, 1000);
    camera.position.set(0, 0, CONFIG.cameraZ);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 10, 10);
    scene.add(dirLight);

    // Background gradient
    updateBackground();

    // Create helix
    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    // Central post
    createPost();

    // Platforms
    createPlatforms();

    // Ball
    createBall();

    // Clouds
    createClouds();

    // Camera initial position
    ballWorldY = 0;
    cameraTargetY = 0;
    camera.position.y = 2;

    // HUD
    createHUD();

    // Events
    attachEvents();
  }

  function cleanupThree() {
    if (renderer) {
      renderer.dispose();
    }
    if (scene) {
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    scene = null;
    camera = null;
    renderer = null;
    helixGroup = null;
    postMesh = null;
    ballMesh = null;
    platforms = [];
    cloudMeshes = [];
  }

  // ===================== CREATE OBJECTS =====================
  function createPost() {
    const palette = PALETTES[currentPaletteIndex];
    const geo = new THREE.CylinderGeometry(CONFIG.postRadius, CONFIG.postRadius, CONFIG.postHeight, CONFIG.radialSegments, 1, false);
    const mat = new THREE.MeshLambertMaterial({ color: palette.pole });
    postMesh = new THREE.Mesh(geo, mat);
    postMesh.position.y = -CONFIG.postHeight / 2;
    helixGroup.add(postMesh);
  }

  function createPlatforms() {
    platforms = [];
    const palette = PALETTES[currentPaletteIndex];

    for (let i = 0; i < CONFIG.platformCount; i++) {
      const y = -(i + 1) * CONFIG.platformSpacing;
      const holeStart = Math.random() * Math.PI * 2;
      const holeSize = CONFIG.holeSegments * (Math.PI * 2 / CONFIG.segmentsPerPlatform);
      const isDanger = i > 2 && Math.random() < CONFIG.dangerChance;

      const platformData = {
        y: y,
        holeStart: holeStart,
        holeSize: holeSize,
        isDanger: isDanger,
        passed: false,
        segments: [],
        group: new THREE.Group()
      };

      platformData.group.position.y = y;
      helixGroup.add(platformData.group);

      // Create segments (arcs)
      const segAngle = (Math.PI * 2) / CONFIG.segmentsPerPlatform;
      const holeEnd = holeStart + holeSize;

      for (let s = 0; s < CONFIG.segmentsPerPlatform; s++) {
        const segStart = s * segAngle;
        const segEnd = (s + 1) * segAngle;
        const segMid = segStart + segAngle / 2;

        // Check if this segment is in the hole
        let inHole = isAngleInRange(segMid, holeStart, holeEnd);
        if (inHole) continue;

        const color = isDanger ? palette.killer : (s % 2 === 0 ? palette.platforms : palette.platformsAlt);
        const geo = new THREE.CylinderGeometry(
          CONFIG.platformRadius, CONFIG.platformRadius,
          CONFIG.platformHeight, CONFIG.radialSegments, 1, false,
          segStart, segAngle
        );
        const mat = new THREE.MeshLambertMaterial({ color: color });
        const mesh = new THREE.Mesh(geo, mat);
        platformData.group.add(mesh);

        platformData.segments.push({
          mesh: mesh,
          startAngle: segStart,
          endAngle: segEnd,
          isKiller: isDanger
        });
      }

      platforms.push(platformData);
    }
  }

  function createBall() {
    const palette = PALETTES[currentPaletteIndex];
    const geo = new THREE.SphereGeometry(CONFIG.ballRadius, 32, 32);
    const mat = new THREE.MeshLambertMaterial({ color: palette.ball });
    ballMesh = new THREE.Mesh(geo, mat);
    ballMesh.position.set(0, CONFIG.ballRadius + 0.1, CONFIG.platformRadius * 0.5);
    scene.add(ballMesh);
    ballWorldY = ballMesh.position.y;
  }

  function createClouds() {
    cloudMeshes = [];
    const cloudGeo = new THREE.SphereGeometry(1, 16, 16);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });

    for (let i = 0; i < 8; i++) {
      const cloudGroup = new THREE.Group();

      // Create cloud from multiple spheres
      const baseSize = 0.8 + Math.random() * 1.2;
      for (let j = 0; j < 4; j++) {
        const part = new THREE.Mesh(cloudGeo, cloudMat.clone());
        part.scale.set(
          baseSize * (0.6 + Math.random() * 0.8),
          baseSize * (0.4 + Math.random() * 0.4),
          baseSize * (0.6 + Math.random() * 0.6)
        );
        part.position.x = (Math.random() - 0.5) * baseSize * 1.5;
        part.position.y = (Math.random() - 0.5) * baseSize * 0.3;
        cloudGroup.add(part);
      }

      cloudGroup.position.set(
        (Math.random() - 0.5) * 25,
        -(Math.random() * CONFIG.platformCount * CONFIG.platformSpacing),
        -5 - Math.random() * 10
      );

      scene.add(cloudGroup);
      cloudMeshes.push({
        mesh: cloudGroup,
        speed: 0.003 + Math.random() * 0.005,
        baseX: cloudGroup.position.x
      });
    }
  }

  function updateBackground() {
    const palette = PALETTES[currentPaletteIndex];
    // Create gradient background using a plane behind everything
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 2;
    canvas2d.height = 256;
    const ctx = canvas2d.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, palette.bgTop);
    grad.addColorStop(1, palette.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas2d);
    texture.needsUpdate = true;
    scene.background = texture;
  }

  // ===================== HUD =====================
  function createHUD() {
    cleanupHUD();

    const container = document.getElementById('gameCanvas').parentElement;
    hudContainer = document.createElement('div');
    hudContainer.id = 'helix-hud';
    hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';

    hudContainer.innerHTML = `
      <div style="
        position:absolute; top:12px; left:12px; z-index:100; pointer-events:auto;
        background:rgba(20,20,40,0.85); color:#fff; padding:6px 16px;
        border-radius:10px; font-family:'Inter',sans-serif; backdrop-filter:blur(4px);
        border:1px solid rgba(255,255,255,0.1);
      ">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Entrada</div>
        <div style="font-size:20px;font-weight:800;" id="hud-entry-val">R$ 0,00</div>
      </div>

      <div style="
        position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:100;
        background:rgba(20,20,40,0.85); color:#fff; padding:8px 20px;
        border-radius:12px; font-family:'Inter',sans-serif; min-width:200px; text-align:center;
        backdrop-filter:blur(4px); border:1px solid rgba(255,255,255,0.1);
        max-width:calc(100% - 160px);
      ">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Progresso da Meta</div>
        <div style="font-size:20px;font-weight:800;" id="hud-progress-val">R$ 0,00 / R$ 0,00</div>
        <div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;">
          <div id="hud-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#00e676,#69f0ae);border-radius:2px;transition:width 0.3s;"></div>
        </div>
      </div>

      <div id="hud-cashout" style="
        position:absolute; top:12px; right:12px; z-index:100; pointer-events:auto;
        background:linear-gradient(135deg,#00e676,#00c853); color:#000; padding:10px 16px;
        border-radius:10px; font-family:'Inter',sans-serif; cursor:pointer; font-weight:800;
        font-size:13px; text-transform:uppercase; letter-spacing:1px;
        border:none; box-shadow:0 4px 15px rgba(0,230,118,0.3);
        display:none;
      " onclick="helixGameCashOut()">Resgatar</div>

      <div id="hud-start" style="
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        z-index:100; font-family:'Inter',sans-serif; text-align:center; color:#333;
        pointer-events:none;
      ">
        <div style="font-size:22px;font-weight:600;">Toque para jogar</div>
        <div style="font-size:32px;margin-top:8px;animation:helixBounce 1s infinite;">&#8595;</div>
      </div>

      <div id="hud-combo" style="
        position:absolute; bottom:120px; left:50%; transform:translateX(-50%);
        z-index:100; pointer-events:none; font-family:'Inter',sans-serif;
        font-size:24px; font-weight:800; color:#ffab00;
        text-shadow:0 2px 8px rgba(255,171,0,0.5); opacity:0; transition: all 0.3s;
      "></div>

      <div id="hud-score-popup" style="
        position:absolute; top:45%; left:50%; transform:translate(-50%,-50%);
        z-index:100; pointer-events:none; font-family:'Inter',sans-serif;
        font-size:36px; font-weight:900; color:#fff;
        text-shadow:0 2px 10px rgba(0,0,0,0.3); opacity:0;
      "></div>
    `;

    // Add animation CSS
    const style = document.createElement('style');
    style.textContent = `
      @keyframes helixBounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(10px)} }
      @keyframes helixFadeUp { 0%{opacity:1;transform:translate(-50%,-50%) scale(1)} 100%{opacity:0;transform:translate(-50%,-80%) scale(1.5)} }
    `;
    hudContainer.appendChild(style);

    container.appendChild(hudContainer);
    updateHUD();
  }

  function cleanupHUD() {
    if (hudContainer && hudContainer.parentNode) {
      hudContainer.parentNode.removeChild(hudContainer);
      hudContainer = null;
    }
  }

  function updateHUD() {
    if (!hudContainer) return;

    const entryVal = document.getElementById('hud-entry-val');
    const progressVal = document.getElementById('hud-progress-val');
    const progressBar = document.getElementById('hud-progress-bar');
    const cashoutBtn = document.getElementById('hud-cashout');
    const startScreen = document.getElementById('hud-start');

    if (entryVal) entryVal.textContent = 'R$ ' + formatBRL(betAmount);

    const metaTotal = betAmount * CONFIG.targetMultiplier;
    const currentPrize = calculatePrize();
    prizeAmount = currentPrize;

    if (progressVal) progressVal.textContent = 'R$ ' + formatBRL(currentPrize) + ' / R$ ' + formatBRL(metaTotal);
    if (progressBar) progressBar.style.width = Math.min(100, (currentPrize / metaTotal) * 100) + '%';
    if (cashoutBtn) cashoutBtn.style.display = (gamePhase === 'playing' && platformsPassed > 0) ? 'block' : 'none';
    if (startScreen) startScreen.style.display = gamePhase === 'ready' ? 'block' : 'none';
  }

  function calculatePrize() {
    if (platformsPassed <= 0) return 0;
    let multiplier = 0;
    for (let i = 0; i < platformsPassed; i++) {
      multiplier += 0.15 + (i * 0.05);
    }
    return Math.round(betAmount * multiplier * 100) / 100;
  }

  function formatBRL(val) {
    return val.toFixed(2).replace('.', ',');
  }

  function showScorePopup(text) {
    const popup = document.getElementById('hud-score-popup');
    if (popup) {
      popup.textContent = text;
      popup.style.opacity = '1';
      popup.style.animation = 'none';
      popup.offsetHeight;
      popup.style.animation = 'helixFadeUp 0.8s ease-out forwards';
    }
  }

  function showCombo(count) {
    const combo = document.getElementById('hud-combo');
    if (combo) {
      combo.textContent = count + 'x COMBO!';
      combo.style.opacity = '1';
      combo.style.transform = 'translateX(-50%) scale(1.2)';
      setTimeout(() => {
        combo.style.opacity = '0';
        combo.style.transform = 'translateX(-50%) scale(1)';
      }, 800);
    }
  }

  // ===================== EVENTS =====================
  function attachEvents() {
    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onTouchDown, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    window.addEventListener('resize', onResize);
  }

  function removeEvents() {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mouseleave', onUp);
    canvas.removeEventListener('touchstart', onTouchDown);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onUp);
    window.removeEventListener('resize', onResize);
  }

  function onDown(e) {
    if (gamePhase === 'ready') startPlaying();
    isDragging = true;
    lastDragX = e.clientX;
  }

  function onMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - lastDragX;
    helixRotation += dx * CONFIG.rotationSensitivity;
    if (helixGroup) helixGroup.rotation.y = helixRotation;
    lastDragX = e.clientX;
  }

  function onUp() {
    isDragging = false;
  }

  function onTouchDown(e) {
    e.preventDefault();
    if (gamePhase === 'ready') startPlaying();
    isDragging = true;
    lastDragX = e.touches[0].clientX;
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDragging) return;
    const dx = e.touches[0].clientX - lastDragX;
    helixRotation += dx * CONFIG.rotationSensitivity;
    if (helixGroup) helixGroup.rotation.y = helixRotation;
    lastDragX = e.touches[0].clientX;
  }

  function onResize() {
    if (!renderer || !camera) return;
    const container = document.getElementById('gameCanvas').parentElement;
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
  }

  function startPlaying() {
    gamePhase = 'playing';
    ballVelY = 0;
    updateHUD();
  }

  // ===================== GAME LOOP =====================
  function animate() {
    if (!gameActive && gamePhase !== 'gameover') return;
    animFrame = requestAnimationFrame(animate);

    update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function update() {
    if (gamePhase === 'playing') {
      // Gravity
      ballVelY += CONFIG.gravity;
      ballWorldY -= ballVelY;

      // Update ball mesh position
      if (ballMesh) {
        ballMesh.position.y = ballWorldY;
        // Ball stays at fixed Z relative to tower, tower rotates around it
        ballMesh.position.z = CONFIG.platformRadius * 0.5;
        ballMesh.position.x = 0;
      }

      // Combo timer
      if (comboTimer > 0) {
        comboTimer--;
        if (comboTimer <= 0) comboCount = 0;
      }

      // Check collisions
      checkCollisions();

      // Check if fell past all platforms
      if (ballWorldY < -(CONFIG.platformCount + 2) * CONFIG.platformSpacing) {
        triggerGameOver();
      }
    }

    // Camera follow
    if (camera && gamePhase !== 'ready') {
      cameraTargetY = ballWorldY + 2;
      camera.position.y += (cameraTargetY - camera.position.y) * CONFIG.cameraFollowSpeed;
      camera.lookAt(0, camera.position.y - 2, 0);
    }

    // Animate clouds
    cloudMeshes.forEach(c => {
      c.mesh.position.x = c.baseX + Math.sin(Date.now() * c.speed) * 2;
    });

    // Update palette based on progress
    const newPalette = Math.min(Math.floor(platformsPassed / 5), PALETTES.length - 1);
    if (newPalette !== currentPaletteIndex) {
      currentPaletteIndex = newPalette;
      updatePaletteColors();
    }

    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return; // only when falling

    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.passed) continue;

      const platTop = p.y + CONFIG.platformHeight / 2;
      const platBottom = p.y - CONFIG.platformHeight / 2;

      // Ball approaching platform
      if (ballWorldY <= platTop + CONFIG.ballRadius && ballWorldY >= platBottom - 0.1 && ballVelY > 0) {
        // Get ball angle in helix space (account for rotation)
        const ballAngle = normalizeAngle(Math.atan2(ballMesh.position.z, ballMesh.position.x) - helixRotation);

        // Check if in hole
        const holeStart = normalizeAngle(p.holeStart);
        const holeEnd = normalizeAngle(p.holeStart + p.holeSize);
        const inHole = isAngleInRange(ballAngle, holeStart, holeEnd);

        if (inHole) {
          // Pass through!
          p.passed = true;
          platformsPassed++;

          // Combo
          comboCount++;
          comboTimer = 60;
          if (comboCount >= 3) showCombo(comboCount);

          // Score popup
          const oldPrize = prizeAmount;
          const newPrize = calculatePrize();
          showScorePopup('+R$ ' + formatBRL(newPrize - oldPrize));

          // Fade out passed platform
          p.segments.forEach(seg => {
            seg.mesh.material.transparent = true;
            seg.mesh.material.opacity = 0.3;
          });

          if (typeof onPlatformPassed === 'function') {
            onPlatformPassed(platformsPassed);
          }
        } else {
          // Hit platform
          if (p.isDanger) {
            triggerGameOver();
            return;
          }

          // Bounce
          ballWorldY = platTop + CONFIG.ballRadius;
          ballVelY = -CONFIG.ballBounceForce;
          comboCount = 0;
          comboTimer = 0;

          // Brief squash animation
          if (ballMesh) {
            ballMesh.scale.set(1.2, 0.7, 1.2);
            setTimeout(() => {
              if (ballMesh) ballMesh.scale.set(1, 1, 1);
            }, 100);
          }
          break;
        }
      }
    }
  }

  function triggerGameOver() {
    if (gamePhase === 'gameover') return;
    gamePhase = 'gameover';

    // Brief delay then end
    setTimeout(() => {
      gameActive = false;
      if (typeof onGameEnd === 'function') {
        onGameEnd(platformsPassed, false);
      }
    }, 600);
  }

  function updatePaletteColors() {
    const palette = PALETTES[currentPaletteIndex];

    // Update post
    if (postMesh) postMesh.material.color.setHex(palette.pole);

    // Update ball
    if (ballMesh) ballMesh.material.color.setHex(palette.ball);

    // Update background
    updateBackground();

    // Update future platforms (non-passed ones)
    platforms.forEach((p, idx) => {
      if (p.passed) return;
      p.segments.forEach((seg, s) => {
        if (seg.isKiller) {
          seg.mesh.material.color.setHex(palette.killer);
        } else {
          seg.mesh.material.color.setHex(s % 2 === 0 ? palette.platforms : palette.platformsAlt);
        }
      });
    });
  }

  // ===================== HELPERS =====================
  function normalizeAngle(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  function isAngleInRange(angle, start, end) {
    angle = normalizeAngle(angle);
    start = normalizeAngle(start);
    end = normalizeAngle(end);
    if (start <= end) {
      return angle >= start && angle <= end;
    } else {
      return angle >= start || angle <= end;
    }
  }

})();
