// ===================== HELIX JUMP GAME =====================
// Full Helix Jump game rendered on Canvas 2D with 3D-like perspective
// Matches the helixball.online style with tower, ball, platforms, clouds

(function() {
  'use strict';

  // ===================== GAME STATE =====================
  let gameActive = false;
  let betAmount = 0;
  let platformsPassed = 0;
  let isCashingOut = false;
  let animFrame = null;

  // Canvas & rendering
  let canvas, ctx;
  let W, H;

  // Tower / helix
  let towerRotation = 0;    // current rotation angle
  let targetRotation = 0;   // target (drag-based)
  let towerY = 0;           // vertical scroll offset

  // Ball
  let ballY = 0;            // ball Y position (world)
  let ballVelY = 0;         // ball velocity Y
  let ballBounceAnim = 0;   // bounce squash animation
  let ballX = 0;            // visual horizontal offset

  // Platforms
  let platforms = [];
  const PLATFORM_COUNT = 50;
  const PLATFORM_SPACING = 80;
  const TOWER_RADIUS = 120;
  const BALL_RADIUS = 16;
  const GRAVITY = 0.45;
  const BOUNCE_FORCE = -9.5;
  const GAP_SIZE = 0.28; // fraction of circle that is gap (0-1)

  // Danger platforms (red/black - game over if you land)
  const DANGER_CHANCE = 0.12;

  // Input
  let isDragging = false;
  let lastDragX = 0;
  let dragSensitivity = 0.006;

  // Visual
  let clouds = [];
  let particles = [];
  let splashParticles = [];
  let comboCount = 0;
  let comboTimer = 0;
  let screenShake = 0;
  let backgroundColor = { r: 255, g: 220, b: 225 }; // pinkish
  let currentColorScheme = 0;

  // Color schemes for platforms (changes as you go deeper)
  const COLOR_SCHEMES = [
    { platform: '#e88ca5', platformDark: '#c4607d', tower: '#d4758f', ball: '#a02050', bg: { r: 255, g: 220, b: 225 } },
    { platform: '#7cb8e8', platformDark: '#4a8abf', tower: '#6aa0d0', ball: '#2060a0', bg: { r: 220, g: 235, b: 255 } },
    { platform: '#8ce8a5', platformDark: '#5abf6d', tower: '#70c885', ball: '#208a40', bg: { r: 220, g: 255, b: 230 } },
    { platform: '#e8c88c', platformDark: '#bf9a5a', tower: '#d0b070', ball: '#a07020', bg: { r: 255, g: 240, b: 220 } },
    { platform: '#c88ce8', platformDark: '#9a5abf', tower: '#b070d0', ball: '#7020a0', bg: { r: 240, g: 220, b: 255 } },
    { platform: '#e88c8c', platformDark: '#bf5a5a', tower: '#d07070', ball: '#a02020', bg: { r: 255, g: 225, b: 225 } },
  ];

  // Game phases
  let gamePhase = 'ready'; // 'ready', 'playing', 'gameover'
  let gameOverTimer = 0;
  let scoreDisplay = 0; // animated score
  let prizeAmount = 0;

  // HUD references (will be created dynamically)
  let hudContainer = null;

  // ===================== PUBLIC API =====================
  window.startHelixGame = function(bet) {
    betAmount = bet;
    platformsPassed = 0;
    isCashingOut = false;
    gameActive = true;
    prizeAmount = 0;
    scoreDisplay = 0;

    initGame();
    gamePhase = 'ready';
    gameLoop();
  };

  window.stopHelixGame = function() {
    gameActive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    removeEvents();
    if (hudContainer && hudContainer.parentNode) {
      hudContainer.parentNode.removeChild(hudContainer);
      hudContainer = null;
    }
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
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();

    // Reset state
    towerRotation = 0;
    targetRotation = 0;
    towerY = 0;
    ballY = -20;
    ballVelY = 0;
    ballBounceAnim = 0;
    ballX = 0;
    isDragging = false;
    comboCount = 0;
    comboTimer = 0;
    screenShake = 0;
    currentColorScheme = 0;
    backgroundColor = { ...COLOR_SCHEMES[0].bg };

    // Generate platforms
    platforms = [];
    for (let i = 0; i < PLATFORM_COUNT; i++) {
      const gapAngle = Math.random() * Math.PI * 2;
      const isDanger = i > 3 && Math.random() < DANGER_CHANCE;
      platforms.push({
        y: i * PLATFORM_SPACING,
        gapAngle: gapAngle,
        gapSize: GAP_SIZE + (Math.random() * 0.08 - 0.04), // slight variation
        isDanger: isDanger,
        passed: false,
        hitAnim: 0,
        opacity: 1
      });
    }

    // Generate clouds
    clouds = [];
    for (let i = 0; i < 12; i++) {
      clouds.push({
        x: Math.random() * W,
        y: Math.random() * H * 3 - H,
        size: 40 + Math.random() * 80,
        speed: 0.15 + Math.random() * 0.3,
        opacity: 0.15 + Math.random() * 0.2
      });
    }

    particles = [];
    splashParticles = [];

    // Create HUD
    createHUD();

    // Attach events
    attachEvents();
  }

  function resizeCanvas() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;
  }

  // ===================== HUD =====================
  function createHUD() {
    if (hudContainer) {
      hudContainer.parentNode.removeChild(hudContainer);
    }

    hudContainer = document.createElement('div');
    hudContainer.id = 'helix-hud';
    hudContainer.innerHTML = `
      <div id="hud-entry" style="
        position:absolute; top:12px; left:12px; z-index:100;
        background:rgba(20,20,40,0.85); color:#fff; padding:6px 16px;
        border-radius:10px; font-family:sans-serif; backdrop-filter:blur(4px);
        border:1px solid rgba(255,255,255,0.1);
      ">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Entrada</div>
        <div style="font-size:20px;font-weight:800;" id="hud-entry-val">R$ 0,00</div>
      </div>
      <div id="hud-progress" style="
        position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:100;
        background:rgba(20,20,40,0.85); color:#fff; padding:8px 24px;
        border-radius:12px; font-family:sans-serif; min-width:220px; text-align:center;
        backdrop-filter:blur(4px); border:1px solid rgba(255,255,255,0.1);
      ">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Progresso da Meta</div>
        <div style="font-size:22px;font-weight:800;" id="hud-progress-val">R$ 0,00 / R$ 0,00</div>
        <div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;">
          <div id="hud-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#00e676,#69f0ae);border-radius:2px;transition:width 0.3s;"></div>
        </div>
      </div>
      <div id="hud-cashout" style="
        position:absolute; top:12px; right:12px; z-index:100;
        background:linear-gradient(135deg,#00e676,#00c853); color:#000; padding:10px 20px;
        border-radius:10px; font-family:sans-serif; cursor:pointer; font-weight:800;
        font-size:14px; text-transform:uppercase; letter-spacing:1px;
        border:none; box-shadow:0 4px 15px rgba(0,230,118,0.3);
        display:none;
      " onclick="helixGameCashOut()">
        💰 Resgatar
      </div>
      <div id="hud-score-popup" style="
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        z-index:100; pointer-events:none; font-family:sans-serif;
        font-size:48px; font-weight:900; color:#fff;
        text-shadow:0 2px 10px rgba(0,0,0,0.3);
        opacity:0; transition:all 0.3s;
      "></div>
      <div id="hud-combo" style="
        position:absolute; bottom:100px; left:50%; transform:translateX(-50%);
        z-index:100; pointer-events:none; font-family:sans-serif;
        font-size:24px; font-weight:800; color:#ffab00;
        text-shadow:0 2px 8px rgba(255,171,0,0.5);
        opacity:0;
      "></div>
      <div id="hud-start" style="
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        z-index:100; font-family:sans-serif; text-align:center; color:#333;
      ">
        <div style="font-size:22px;font-weight:600;">Toque para jogar</div>
        <div style="font-size:32px;margin-top:8px;animation:bounce 1s infinite;">↓</div>
      </div>
    `;

    // Add bounce animation CSS
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(10px); }
      }
      @keyframes fadeUp {
        0% { opacity:1; transform:translate(-50%,-50%) scale(1); }
        100% { opacity:0; transform:translate(-50%,-80%) scale(1.5); }
      }
    `;
    hudContainer.appendChild(style);

    const gameContainer = canvas.parentElement;
    gameContainer.appendChild(hudContainer);

    updateHUD();
  }

  function updateHUD() {
    if (!hudContainer) return;

    const entryVal = hudContainer.querySelector('#hud-entry-val');
    const progressVal = hudContainer.querySelector('#hud-progress-val');
    const progressBar = hudContainer.querySelector('#hud-progress-bar');
    const cashoutBtn = hudContainer.querySelector('#hud-cashout');
    const startScreen = hudContainer.querySelector('#hud-start');

    if (entryVal) entryVal.textContent = 'R$ ' + formatBRL(betAmount);

    const metaTotal = betAmount * 8; // 8x multiplier as goal
    const currentPrize = calculatePrize();
    prizeAmount = currentPrize;

    if (progressVal) progressVal.textContent = 'R$ ' + formatBRL(currentPrize) + ' / R$ ' + formatBRL(metaTotal);
    if (progressBar) progressBar.style.width = Math.min(100, (currentPrize / metaTotal) * 100) + '%';

    if (cashoutBtn) cashoutBtn.style.display = (gamePhase === 'playing' && platformsPassed > 0) ? 'block' : 'none';
    if (startScreen) startScreen.style.display = gamePhase === 'ready' ? 'block' : 'none';
  }

  function calculatePrize() {
    if (platformsPassed <= 0) return 0;
    // Progressive multiplier: each platform adds more
    let multiplier = 0;
    for (let i = 0; i < platformsPassed; i++) {
      multiplier += 0.15 + (i * 0.05); // starts at 0.15x, grows
    }
    return Math.round(betAmount * multiplier * 100) / 100;
  }

  function formatBRL(val) {
    return val.toFixed(2).replace('.', ',');
  }

  function showScorePopup(text) {
    const popup = hudContainer.querySelector('#hud-score-popup');
    if (popup) {
      popup.textContent = text;
      popup.style.opacity = '1';
      popup.style.animation = 'none';
      popup.offsetHeight; // reflow
      popup.style.animation = 'fadeUp 0.8s ease-out forwards';
    }
  }

  function showCombo(count) {
    const combo = hudContainer.querySelector('#hud-combo');
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
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onTouchDown, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    window.addEventListener('resize', resizeCanvas);
  }

  function removeEvents() {
    if (!canvas) return;
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mouseleave', onUp);
    canvas.removeEventListener('touchstart', onTouchDown);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onUp);
    window.removeEventListener('resize', resizeCanvas);
  }

  function onDown(e) {
    if (gamePhase === 'ready') {
      gamePhase = 'playing';
      ballVelY = 2;
      updateHUD();
    }
    isDragging = true;
    lastDragX = e.clientX;
  }

  function onMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - lastDragX;
    targetRotation += dx * dragSensitivity;
    lastDragX = e.clientX;
  }

  function onUp() {
    isDragging = false;
  }

  function onTouchDown(e) {
    e.preventDefault();
    if (gamePhase === 'ready') {
      gamePhase = 'playing';
      ballVelY = 2;
      updateHUD();
    }
    isDragging = true;
    lastDragX = e.touches[0].clientX;
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDragging) return;
    const dx = e.touches[0].clientX - lastDragX;
    targetRotation += dx * dragSensitivity;
    lastDragX = e.touches[0].clientX;
  }

  // ===================== GAME LOOP =====================
  function gameLoop() {
    if (!gameActive && gamePhase !== 'gameover') return;
    animFrame = requestAnimationFrame(gameLoop);

    update();
    draw();
  }

  function update() {
    // Smooth rotation
    towerRotation += (targetRotation - towerRotation) * 0.12;

    if (gamePhase === 'playing') {
      // Gravity
      ballVelY += GRAVITY;
      ballY += ballVelY;

      // Ball bounce animation decay
      ballBounceAnim *= 0.85;

      // Screen shake decay
      screenShake *= 0.9;

      // Combo timer
      if (comboTimer > 0) {
        comboTimer--;
        if (comboTimer <= 0) comboCount = 0;
      }

      // Camera follow ball
      towerY += (ballY - towerY - H * 0.3) * 0.08;

      // Check collisions
      checkCollisions();

      // Update color scheme based on depth
      const schemeIndex = Math.min(Math.floor(platformsPassed / 6), COLOR_SCHEMES.length - 1);
      if (schemeIndex !== currentColorScheme) {
        currentColorScheme = schemeIndex;
        const scheme = COLOR_SCHEMES[schemeIndex];
        backgroundColor = { ...scheme.bg };
      }

      // Check if passed all platforms
      if (ballY > (PLATFORM_COUNT - 1) * PLATFORM_SPACING + 200) {
        triggerGameOver(false);
      }
    }

    if (gamePhase === 'gameover') {
      gameOverTimer++;
    }

    // Update clouds
    clouds.forEach(c => {
      c.x += c.speed;
      if (c.x > W + c.size) c.x = -c.size;
    });

    // Update particles
    particles = particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life--;
      p.opacity = p.life / p.maxLife;
      return p.life > 0;
    });

    splashParticles = splashParticles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life--;
      p.opacity = p.life / p.maxLife;
      p.size *= 0.97;
      return p.life > 0;
    });

    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return; // only check when falling

    const ballWorldY = ballY;
    const ballAngle = getBallAngle();

    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.passed) continue;

      const platTop = p.y;
      const platBottom = p.y + 14; // platform thickness

      // Ball approaching platform from above
      if (ballWorldY >= platTop - BALL_RADIUS && ballWorldY <= platBottom + 5 && ballVelY > 0) {
        // Check if ball is in the gap
        const rotatedAngle = normalizeAngle(ballAngle - towerRotation);
        const gapStart = normalizeAngle(p.gapAngle);
        const gapEnd = normalizeAngle(p.gapAngle + p.gapSize * Math.PI * 2);

        let inGap;
        if (gapStart < gapEnd) {
          inGap = rotatedAngle >= gapStart && rotatedAngle <= gapEnd;
        } else {
          inGap = rotatedAngle >= gapStart || rotatedAngle <= gapEnd;
        }

        if (inGap) {
          // Pass through!
          p.passed = true;
          platformsPassed++;
          p.opacity = 0.3;

          // Combo system
          comboCount++;
          comboTimer = 60;

          if (comboCount >= 3) {
            showCombo(comboCount);
            screenShake = 5;
          }

          // Score popup
          const prize = calculatePrize();
          showScorePopup('+R$ ' + formatBRL(prize - (prizeAmount || 0)));

          // Particles through gap
          spawnPassParticles(p.y);

          if (typeof onPlatformPassed === 'function') {
            onPlatformPassed(platformsPassed);
          }
        } else {
          // Hit platform
          if (p.isDanger) {
            // Game over!
            screenShake = 15;
            spawnDeathParticles(ballWorldY);
            triggerGameOver(false);
            return;
          }

          // Bounce
          ballY = platTop - BALL_RADIUS;
          ballVelY = BOUNCE_FORCE;
          ballBounceAnim = 1;
          comboCount = 0;
          comboTimer = 0;

          // Bounce particles
          spawnBounceParticles(platTop);

          p.hitAnim = 1;
          screenShake = 3;
          break;
        }
      }
    }
  }

  function getBallAngle() {
    // Ball moves around the tower based on tower rotation
    return normalizeAngle(Math.PI * 0.5); // ball at fixed angle, tower rotates around it
  }

  function normalizeAngle(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  function triggerGameOver(won) {
    if (gamePhase === 'gameover') return;
    gamePhase = 'gameover';
    gameOverTimer = 0;

    setTimeout(() => {
      gameActive = false;
      if (typeof onGameEnd === 'function') {
        onGameEnd(platformsPassed, false);
      }
    }, 800);
  }

  // ===================== PARTICLES =====================
  function spawnBounceParticles(y) {
    const screenY = y - towerY;
    for (let i = 0; i < 8; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * 40,
        y: screenY,
        vx: (Math.random() - 0.5) * 6,
        vy: -(Math.random() * 4 + 1),
        life: 20 + Math.random() * 10,
        maxLife: 30,
        opacity: 1,
        color: COLOR_SCHEMES[currentColorScheme].platform,
        size: 3 + Math.random() * 4
      });
    }
  }

  function spawnPassParticles(y) {
    const screenY = y - towerY;
    for (let i = 0; i < 15; i++) {
      splashParticles.push({
        x: W / 2 + (Math.random() - 0.5) * 60,
        y: screenY,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 25 + Math.random() * 15,
        maxLife: 40,
        opacity: 1,
        color: '#00e676',
        size: 4 + Math.random() * 6
      });
    }
  }

  function spawnDeathParticles(y) {
    const screenY = y - towerY;
    for (let i = 0; i < 25; i++) {
      splashParticles.push({
        x: W / 2 + (Math.random() - 0.5) * 30,
        y: screenY,
        vx: (Math.random() - 0.5) * 12,
        vy: -(Math.random() * 8 + 2),
        life: 30 + Math.random() * 20,
        maxLife: 50,
        opacity: 1,
        color: '#ff1744',
        size: 3 + Math.random() * 5
      });
    }
  }

  // ===================== DRAW =====================
  function draw() {
    // Clear with background color
    const bg = backgroundColor;
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
    ctx.fillRect(0, 0, W, H);

    // Screen shake offset
    const shakeX = (Math.random() - 0.5) * screenShake;
    const shakeY = (Math.random() - 0.5) * screenShake;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Draw clouds (background)
    drawClouds();

    // Draw tower
    drawTower();

    // Draw platforms
    drawPlatforms();

    // Draw ball
    drawBall();

    // Draw particles
    drawParticles();

    ctx.restore();
  }

  function drawClouds() {
    ctx.save();
    clouds.forEach(c => {
      const cloudY = c.y - towerY * 0.1; // parallax
      const normalizedY = ((cloudY % (H * 2)) + H * 2) % (H * 2) - H * 0.5;

      ctx.globalAlpha = c.opacity;
      ctx.fillStyle = 'rgba(200,200,210,0.5)';

      // Draw cloud as group of circles
      const s = c.size;
      drawCloudShape(c.x, normalizedY, s);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawCloudShape(x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x - size * 0.3, y + size * 0.1, size * 0.3, 0, Math.PI * 2);
    ctx.arc(x + size * 0.3, y + size * 0.05, size * 0.35, 0, Math.PI * 2);
    ctx.arc(x - size * 0.15, y - size * 0.15, size * 0.25, 0, Math.PI * 2);
    ctx.arc(x + size * 0.15, y - size * 0.1, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTower() {
    const scheme = COLOR_SCHEMES[currentColorScheme];
    const cx = W / 2;
    const towerWidth = 32;

    // Draw central cylinder
    const gradient = ctx.createLinearGradient(cx - towerWidth, 0, cx + towerWidth, 0);
    gradient.addColorStop(0, darkenColor(scheme.tower, 0.7));
    gradient.addColorStop(0.3, scheme.tower);
    gradient.addColorStop(0.7, darkenColor(scheme.tower, 0.85));
    gradient.addColorStop(1, darkenColor(scheme.tower, 0.5));

    ctx.fillStyle = gradient;
    ctx.fillRect(cx - towerWidth / 2, 0, towerWidth, H);
  }

  function drawPlatforms() {
    const scheme = COLOR_SCHEMES[currentColorScheme];
    const cx = W / 2;

    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i];
      const screenY = p.y - towerY;

      // Skip if off screen
      if (screenY < -60 || screenY > H + 60) continue;

      // Platform animation
      if (p.hitAnim > 0) p.hitAnim *= 0.9;

      const perspective = 0.7; // Isometric-like
      const radiusX = TOWER_RADIUS + p.hitAnim * 10;
      const radiusY = TOWER_RADIUS * 0.35;
      const thickness = 14;

      // Draw platform ring with gap
      const rotation = towerRotation;
      const gapStart = p.gapAngle;
      const gapEnd = gapStart + p.gapSize * Math.PI * 2;

      ctx.save();
      ctx.globalAlpha = p.opacity;

      // Platform top surface
      const segments = 48;
      const segAngle = (Math.PI * 2) / segments;

      // Draw each segment except the gap
      for (let s = 0; s < segments; s++) {
        const a1 = s * segAngle + rotation;
        const a2 = (s + 1) * segAngle + rotation;

        // Check if this segment is in the gap
        const midAngle = normalizeAngle(a1 + segAngle / 2 - rotation);
        const gapS = normalizeAngle(gapStart);
        const gapE = normalizeAngle(gapEnd);

        let inGap;
        if (gapS < gapE) {
          inGap = midAngle >= gapS && midAngle <= gapE;
        } else {
          inGap = midAngle >= gapS || midAngle <= gapE;
        }

        if (inGap) continue;

        // Determine if this segment is facing front (visible)
        const midA = (a1 + a2) / 2;
        const facing = Math.sin(midA); // -1 to 1

        // Coordinates
        const x1 = cx + Math.cos(a1) * radiusX;
        const x2 = cx + Math.cos(a2) * radiusX;
        const y1Top = screenY + Math.sin(a1) * radiusY;
        const y2Top = screenY + Math.sin(a2) * radiusY;
        const y1Bot = y1Top + thickness;
        const y2Bot = y2Top + thickness;

        // Inner edge (near tower center)
        const innerR = 16;
        const innerRY = innerR * 0.35;
        const ix1 = cx + Math.cos(a1) * innerR;
        const ix2 = cx + Math.cos(a2) * innerR;
        const iy1 = screenY + Math.sin(a1) * innerRY;
        const iy2 = screenY + Math.sin(a2) * innerRY;

        let color;
        if (p.isDanger) {
          color = facing > 0 ?
            `rgba(40,40,40,${0.7 + facing * 0.3})` :
            `rgba(20,20,20,${0.7 + Math.abs(facing) * 0.2})`;
        } else {
          const brightness = 0.7 + facing * 0.3;
          color = adjustBrightness(scheme.platform, brightness);
        }

        // Draw top face
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ix1, iy1);
        ctx.lineTo(x1, y1Top);
        ctx.lineTo(x2, y2Top);
        ctx.lineTo(ix2, iy2);
        ctx.closePath();
        ctx.fill();

        // Draw side face (only for front-facing segments and bottom visible ones)
        if (facing > -0.3) {
          const sideColor = p.isDanger ?
            `rgba(30,0,0,0.9)` :
            adjustBrightness(scheme.platformDark, 0.6 + facing * 0.2);

          ctx.fillStyle = sideColor;
          ctx.beginPath();
          ctx.moveTo(x1, y1Top);
          ctx.lineTo(x2, y2Top);
          ctx.lineTo(x2, y2Bot);
          ctx.lineTo(x1, y1Bot);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Danger platform indicator
      if (p.isDanger && p.opacity > 0.5) {
        ctx.strokeStyle = 'rgba(255,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.ellipse(cx, screenY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }
  }

  function drawBall() {
    if (gamePhase === 'gameover' && gameOverTimer > 30) return;

    const cx = W / 2;
    const screenBallY = ballY - towerY;

    // Ball position on the tower edge
    const ballAngle = Math.PI * 0.5; // ball is always at "front"
    const ballScreenX = cx + Math.cos(ballAngle + towerRotation * 0.3) * (TOWER_RADIUS * 0.45);
    const squash = 1 + ballBounceAnim * 0.3;
    const stretch = 1 - ballBounceAnim * 0.15;

    const scheme = COLOR_SCHEMES[currentColorScheme];

    ctx.save();
    ctx.translate(ballScreenX, screenBallY);
    ctx.scale(stretch, squash);

    // Ball shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(2, BALL_RADIUS + 4, BALL_RADIUS * 0.8, BALL_RADIUS * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ball gradient
    const ballGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, BALL_RADIUS);
    ballGrad.addColorStop(0, lightenColor(scheme.ball, 1.4));
    ballGrad.addColorStop(0.5, scheme.ball);
    ballGrad.addColorStop(1, darkenColor(scheme.ball, 0.6));

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Ball highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(-4, -5, BALL_RADIUS * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    // Regular particles
    particles.forEach(p => {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - towerY, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Splash particles
    splashParticles.forEach(p => {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - towerY, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }

  // ===================== COLOR HELPERS =====================
  function darkenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * factor)},${Math.floor(g * factor)},${Math.floor(b * factor)})`;
  }

  function lightenColor(hex, factor) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) * factor);
    return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
  }

  function adjustBrightness(hex, factor) {
    if (hex.startsWith('rgb')) return hex;
    const r = Math.min(255, Math.floor(parseInt(hex.slice(1, 3), 16) * factor));
    const g = Math.min(255, Math.floor(parseInt(hex.slice(3, 5), 16) * factor));
    const b = Math.min(255, Math.floor(parseInt(hex.slice(5, 7), 16) * factor));
    return `rgb(${r},${g},${b})`;
  }

})();
