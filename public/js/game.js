// ===================== HELIX JUMP 3D GAME =====================
// Three.js WebGL Helix Jump - ring-shaped platforms, fixed collision
(function() {
  'use strict';

  const CONFIG = {
    platformCount: 25,
    platformSpacing: 2.5,
    platformOuterRadius: 2.8,
    platformInnerRadius: 0.55,
    platformHeight: 0.35,
    postRadius: 0.35,
    postHeight: 200,
    ballRadius: 0.32,
    ballBounceForce: 0.22,
    gravity: 0.011,
    segmentsPerPlatform: 8,
    holeSegments: 1.5,
    cameraFov: 60,
    cameraZ: 9,
    cameraFollowSpeed: 0.08,
    rotationSensitivity: 0.008,
    dangerChance: 0.12,
    targetMultiplier: 8,
    latheSegments: 24
  };

  const PALETTES = [
    { name:'Rose', platforms:0xFF9E9D, alt:0xFFBEB8, ball:0xE8294A, pole:0xD12550, bgTop:'#FFE4EE', bgBottom:'#FFB3CB', killer:0x3A0015 },
    { name:'Ocean', platforms:0x7CB8E8, alt:0x9DD0F5, ball:0x2060A0, pole:0x1A4A80, bgTop:'#E0F0FF', bgBottom:'#A0C8F0', killer:0x101030 },
    { name:'Mint', platforms:0x8CE8A5, alt:0xB0F5C0, ball:0x208A40, pole:0x1A6A30, bgTop:'#E0FFE8', bgBottom:'#A0F0B0', killer:0x102010 },
    { name:'Sunset', platforms:0xE8C88C, alt:0xF5DCA0, ball:0xC07820, pole:0x905A18, bgTop:'#FFF5E0', bgBottom:'#F0D0A0', killer:0x2A1A0A },
    { name:'Lavender', platforms:0xC88CE8, alt:0xDCA0F5, ball:0x8030B0, pole:0x6A2090, bgTop:'#F0E0FF', bgBottom:'#D0A0F0', killer:0x1A0A2A },
  ];

  // ===================== STATE =====================
  let gameActive = false, betAmount = 0, platformsPassed = 0;
  let isCashingOut = false, gamePhase = 'ready', prizeAmount = 0;
  let currentPaletteIndex = 0, comboCount = 0, comboTimer = 0;
  let scene, camera, renderer, helixGroup, postMesh, ballMesh;
  let platforms = [], animFrame = null, cloudMeshes = [];
  let ballVelY = 0, ballWorldY = 0;
  let isDragging = false, lastDragX = 0, helixRotation = 0;
  let cameraTargetY = 0, hudContainer = null;

  // ===================== PUBLIC API =====================
  window.startHelixGame = function(bet) {
    betAmount = bet; platformsPassed = 0; isCashingOut = false;
    gameActive = true; prizeAmount = 0; comboCount = 0; comboTimer = 0;
    currentPaletteIndex = 0; gamePhase = 'ready'; helixRotation = 0;
    initGame(); animate();
  };

  window.stopHelixGame = function() {
    gameActive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null; removeEvents(); cleanupHUD(); cleanupThree();
  };

  window.helixGameCashOut = function() {
    if (!gameActive || gamePhase !== 'playing') return;
    isCashingOut = true; gameActive = false; gamePhase = 'gameover';
    if (typeof onGameEnd === 'function') onGameEnd(platformsPassed, true);
  };

  // ===================== INIT =====================
  function initGame() {
    cleanupThree();
    const canvas = document.getElementById('gameCanvas');
    const container = canvas.parentElement;
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, W / H, 0.1, 1000);
    camera.position.set(0, 2, CONFIG.cameraZ);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 8);
    scene.add(dirLight);

    updateBackground();

    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    createPost();
    createPlatforms();
    createBall();
    createClouds();

    ballWorldY = CONFIG.ballRadius + CONFIG.platformHeight / 2 + 0.05;
    if (ballMesh) ballMesh.position.y = ballWorldY;
    cameraTargetY = 2;
    camera.position.y = 2;

    createHUD();
    attachEvents();
  }

  function cleanupThree() {
    if (renderer) renderer.dispose();
    if (scene) {
      scene.traverse(function(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(function(m){m.dispose();});
          else obj.material.dispose();
        }
      });
    }
    scene = null; camera = null; renderer = null;
    helixGroup = null; postMesh = null; ballMesh = null;
    platforms = []; cloudMeshes = [];
  }

  // ===================== CREATE OBJECTS =====================
  function createPost() {
    var pal = PALETTES[currentPaletteIndex];
    var geo = new THREE.CylinderGeometry(CONFIG.postRadius, CONFIG.postRadius, CONFIG.postHeight, 16, 1, false);
    var mat = new THREE.MeshPhongMaterial({ color: pal.pole, shininess: 30 });
    postMesh = new THREE.Mesh(geo, mat);
    postMesh.position.y = -CONFIG.postHeight / 2;
    helixGroup.add(postMesh);
  }

  // Create ring-shaped platform segment using LatheGeometry
  function createRingSegment(innerR, outerR, height, startAngle, arcAngle, color) {
    var pts = [
      new THREE.Vector2(innerR, -height / 2),
      new THREE.Vector2(outerR, -height / 2),
      new THREE.Vector2(outerR, height / 2),
      new THREE.Vector2(innerR, height / 2)
    ];
    var geo = new THREE.LatheGeometry(pts, CONFIG.latheSegments, startAngle, arcAngle);
    var mat = new THREE.MeshPhongMaterial({ color: color, shininess: 20 });
    return new THREE.Mesh(geo, mat);
  }

  function createPlatforms() {
    platforms = [];
    var pal = PALETTES[currentPaletteIndex];
    var segAngle = (Math.PI * 2) / CONFIG.segmentsPerPlatform;
    var holeArc = CONFIG.holeSegments * segAngle;

    for (var i = 0; i < CONFIG.platformCount; i++) {
      var y = -(i + 1) * CONFIG.platformSpacing;
      var holeStart = Math.random() * Math.PI * 2;
      var isDanger = i > 2 && Math.random() < CONFIG.dangerChance;

      var pData = {
        y: y, holeStart: holeStart, holeSize: holeArc,
        isDanger: isDanger, passed: false, segments: [],
        group: new THREE.Group()
      };
      pData.group.position.y = y;
      helixGroup.add(pData.group);

      var holeEnd = holeStart + holeArc;

      for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
        var sStart = s * segAngle;
        var sMid = sStart + segAngle / 2;

        if (isAngleInRange(sMid, holeStart, holeEnd)) continue;

        var col = isDanger ? pal.killer : (s % 2 === 0 ? pal.platforms : pal.alt);
        var mesh = createRingSegment(
          CONFIG.platformInnerRadius, CONFIG.platformOuterRadius,
          CONFIG.platformHeight, sStart, segAngle, col
        );
        pData.group.add(mesh);
        pData.segments.push({ mesh: mesh, startAngle: sStart, endAngle: sStart + segAngle, isKiller: isDanger });
      }
      platforms.push(pData);
    }
  }

  function createBall() {
    var pal = PALETTES[currentPaletteIndex];
    var geo = new THREE.SphereGeometry(CONFIG.ballRadius, 32, 32);
    var mat = new THREE.MeshPhongMaterial({ color: pal.ball, shininess: 60, specular: 0x444444 });
    ballMesh = new THREE.Mesh(geo, mat);
    // Place ball on outer part of the ring
    var ballZ = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2;
    ballMesh.position.set(0, CONFIG.ballRadius + 0.1, ballZ);
    scene.add(ballMesh);
    ballWorldY = ballMesh.position.y;
  }

  function createClouds() {
    cloudMeshes = [];
    var cGeo = new THREE.SphereGeometry(1, 8, 8);
    var cMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    for (var i = 0; i < 6; i++) {
      var cg = new THREE.Group();
      var bs = 0.8 + Math.random() * 1.0;
      for (var j = 0; j < 3; j++) {
        var p = new THREE.Mesh(cGeo, cMat.clone());
        p.scale.set(bs * (0.5 + Math.random() * 0.6), bs * (0.3 + Math.random() * 0.3), bs * (0.5 + Math.random() * 0.5));
        p.position.x = (Math.random() - 0.5) * bs;
        p.position.y = (Math.random() - 0.5) * bs * 0.2;
        cg.add(p);
      }
      cg.position.set((Math.random()-0.5)*20, -(Math.random()*CONFIG.platformCount*CONFIG.platformSpacing), -6 - Math.random()*8);
      scene.add(cg);
      cloudMeshes.push({ mesh: cg, speed: 0.002 + Math.random()*0.004, baseX: cg.position.x });
    }
  }

  function updateBackground() {
    var pal = PALETTES[currentPaletteIndex];
    var c = document.createElement('canvas');
    c.width = 2; c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0,0,0,256);
    g.addColorStop(0, pal.bgTop); g.addColorStop(1, pal.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0,0,2,256);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    scene.background = tex;
  }

  // ===================== HUD =====================
  function createHUD() {
    cleanupHUD();
    var container = document.getElementById('gameCanvas').parentElement;
    hudContainer = document.createElement('div');
    hudContainer.id = 'helix-hud';
    hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
    hudContainer.innerHTML = '<div style="position:absolute;top:12px;left:12px;z-index:100;pointer-events:auto;background:rgba(20,20,40,0.85);color:#fff;padding:6px 14px;border-radius:10px;font-family:Inter,sans-serif;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Entrada</div><div style="font-size:18px;font-weight:800;" id="hud-entry-val">R$ 0,00</div></div>'
    + '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(20,20,40,0.85);color:#fff;padding:8px 16px;border-radius:12px;font-family:Inter,sans-serif;min-width:180px;text-align:center;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);max-width:calc(100% - 150px);"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Progresso da Meta</div><div style="font-size:16px;font-weight:800;" id="hud-progress-val">R$ 0,00 / R$ 0,00</div><div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;"><div id="hud-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#00e676,#69f0ae);border-radius:2px;transition:width 0.3s;"></div></div></div>'
    + '<div id="hud-cashout" style="position:absolute;top:12px;right:12px;z-index:100;pointer-events:auto;background:linear-gradient(135deg,#00e676,#00c853);color:#000;padding:10px 14px;border-radius:10px;font-family:Inter,sans-serif;cursor:pointer;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:1px;border:none;box-shadow:0 4px 15px rgba(0,230,118,0.3);display:none;" onclick="helixGameCashOut()">Resgatar</div>'
    + '<div id="hud-start" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:Inter,sans-serif;text-align:center;color:#333;pointer-events:none;"><div style="font-size:22px;font-weight:600;">Toque para jogar</div><div style="font-size:32px;margin-top:8px;animation:helixBounce 1s infinite;">&#8595;</div></div>'
    + '<div id="hud-combo" style="position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:24px;font-weight:800;color:#ffab00;text-shadow:0 2px 8px rgba(255,171,0,0.5);opacity:0;transition:all 0.3s;"></div>'
    + '<div id="hud-score-popup" style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:36px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.3);opacity:0;"></div>';

    var style = document.createElement('style');
    style.textContent = '@keyframes helixBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}@keyframes helixFadeUp{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-80%) scale(1.5)}}';
    hudContainer.appendChild(style);
    container.appendChild(hudContainer);
    updateHUD();
  }

  function cleanupHUD() {
    if (hudContainer && hudContainer.parentNode) { hudContainer.parentNode.removeChild(hudContainer); hudContainer = null; }
  }

  function updateHUD() {
    if (!hudContainer) return;
    var ev = document.getElementById('hud-entry-val');
    var pv = document.getElementById('hud-progress-val');
    var pb = document.getElementById('hud-progress-bar');
    var cb = document.getElementById('hud-cashout');
    var ss = document.getElementById('hud-start');
    if (ev) ev.textContent = 'R$ ' + fmtBRL(betAmount);
    var meta = betAmount * CONFIG.targetMultiplier;
    var prize = calcPrize(); prizeAmount = prize;
    if (pv) pv.textContent = 'R$ ' + fmtBRL(prize) + ' / R$ ' + fmtBRL(meta);
    if (pb) pb.style.width = Math.min(100, (prize / (meta||1)) * 100) + '%';
    if (cb) cb.style.display = (gamePhase === 'playing' && platformsPassed > 0) ? 'block' : 'none';
    if (ss) ss.style.display = gamePhase === 'ready' ? 'block' : 'none';
  }

  function calcPrize() {
    if (platformsPassed <= 0) return 0;
    var m = 0;
    for (var i = 0; i < platformsPassed; i++) m += 0.15 + (i * 0.05);
    return Math.round(betAmount * m * 100) / 100;
  }

  function fmtBRL(v) { return v.toFixed(2).replace('.', ','); }

  function showScorePopup(text) {
    var el = document.getElementById('hud-score-popup');
    if (el) { el.textContent = text; el.style.opacity = '1'; el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'helixFadeUp 0.8s ease-out forwards'; }
  }

  function showCombo(n) {
    var el = document.getElementById('hud-combo');
    if (el) { el.textContent = n + 'x COMBO!'; el.style.opacity = '1'; el.style.transform = 'translateX(-50%) scale(1.2)'; setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(-50%) scale(1)';},800); }
  }

  // ===================== EVENTS =====================
  function attachEvents() {
    var c = document.getElementById('gameCanvas');
    c.addEventListener('mousedown', onDown);
    c.addEventListener('mousemove', onMove);
    c.addEventListener('mouseup', onUp);
    c.addEventListener('mouseleave', onUp);
    c.addEventListener('touchstart', onTouchDown, {passive:false});
    c.addEventListener('touchmove', onTouchMove, {passive:false});
    c.addEventListener('touchend', onUp);
    window.addEventListener('resize', onResize);
  }

  function removeEvents() {
    var c = document.getElementById('gameCanvas');
    if (!c) return;
    c.removeEventListener('mousedown', onDown);
    c.removeEventListener('mousemove', onMove);
    c.removeEventListener('mouseup', onUp);
    c.removeEventListener('mouseleave', onUp);
    c.removeEventListener('touchstart', onTouchDown);
    c.removeEventListener('touchmove', onTouchMove);
    c.removeEventListener('touchend', onUp);
    window.removeEventListener('resize', onResize);
  }

  function onDown(e) { if (gamePhase==='ready') startPlaying(); isDragging=true; lastDragX=e.clientX; }
  function onMove(e) { if (!isDragging) return; var dx=e.clientX-lastDragX; helixRotation+=dx*CONFIG.rotationSensitivity; if(helixGroup)helixGroup.rotation.y=helixRotation; lastDragX=e.clientX; }
  function onUp() { isDragging=false; }
  function onTouchDown(e) { e.preventDefault(); if(gamePhase==='ready')startPlaying(); isDragging=true; lastDragX=e.touches[0].clientX; }
  function onTouchMove(e) { e.preventDefault(); if(!isDragging)return; var dx=e.touches[0].clientX-lastDragX; helixRotation+=dx*CONFIG.rotationSensitivity; if(helixGroup)helixGroup.rotation.y=helixRotation; lastDragX=e.touches[0].clientX; }
  function onResize() {
    if(!renderer||!camera) return;
    var ct=document.getElementById('gameCanvas').parentElement;
    var W=ct.clientWidth||window.innerWidth, H=ct.clientHeight||window.innerHeight;
    camera.aspect=W/H; camera.updateProjectionMatrix(); renderer.setSize(W,H);
  }
  function startPlaying() { gamePhase='playing'; ballVelY=0; updateHUD(); }

  // ===================== GAME LOOP =====================
  function animate() {
    if (!gameActive && gamePhase !== 'gameover') return;
    animFrame = requestAnimationFrame(animate);
    update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function update() {
    if (gamePhase === 'playing') {
      ballVelY += CONFIG.gravity;
      ballWorldY -= ballVelY;
      if (ballMesh) {
        ballMesh.position.y = ballWorldY;
        var ballZ = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2;
        ballMesh.position.z = ballZ;
        ballMesh.position.x = 0;
      }
      if (comboTimer > 0) { comboTimer--; if (comboTimer <= 0) comboCount = 0; }
      checkCollisions();
      if (ballWorldY < -(CONFIG.platformCount + 2) * CONFIG.platformSpacing) triggerGameOver();
    }

    if (camera && gamePhase !== 'ready') {
      cameraTargetY = ballWorldY + 2;
      camera.position.y += (cameraTargetY - camera.position.y) * CONFIG.cameraFollowSpeed;
      camera.lookAt(0, camera.position.y - 2, 0);
    }

    cloudMeshes.forEach(function(c) { c.mesh.position.x = c.baseX + Math.sin(Date.now() * c.speed) * 2; });

    var np = Math.min(Math.floor(platformsPassed / 5), PALETTES.length - 1);
    if (np !== currentPaletteIndex) { currentPaletteIndex = np; updatePaletteColors(); }
    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return;

    // Ball angle in helix-local space using LatheGeometry/CylinderGeometry convention
    // LatheGeo: x = r*sin(phi), z = r*cos(phi) => phi = atan2(x, z)
    // Ball world pos: (0, y, ballZ). Transform to local:
    var bz = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2;
    var localX = -bz * Math.sin(helixRotation);
    var localZ = bz * Math.cos(helixRotation);
    var ballAngle = normAngle(Math.atan2(localX, localZ));

    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.passed) continue;

      var platTop = p.y + CONFIG.platformHeight / 2;
      var platBottom = p.y - CONFIG.platformHeight / 2;

      if (ballWorldY <= platTop + CONFIG.ballRadius && ballWorldY >= platBottom - 0.15 && ballVelY > 0) {
        // Check if in hole
        var hEnd = p.holeStart + p.holeSize;
        var inHole = isAngleInRange(ballAngle, p.holeStart, hEnd);

        if (inHole) {
          p.passed = true;
          platformsPassed++;
          comboCount++; comboTimer = 60;
          if (comboCount >= 3) showCombo(comboCount);

          var oldP = prizeAmount;
          var newP = calcPrize();
          showScorePopup('+R$ ' + fmtBRL(newP - oldP));

          p.segments.forEach(function(seg) { seg.mesh.material.transparent = true; seg.mesh.material.opacity = 0.25; });
          if (typeof onPlatformPassed === 'function') onPlatformPassed(platformsPassed);
        } else {
          if (p.isDanger) { triggerGameOver(); return; }
          ballWorldY = platTop + CONFIG.ballRadius;
          ballVelY = -CONFIG.ballBounceForce;
          comboCount = 0; comboTimer = 0;
          if (ballMesh) {
            ballMesh.scale.set(1.15, 0.75, 1.15);
            setTimeout(function(){ if(ballMesh) ballMesh.scale.set(1,1,1); }, 100);
          }
          break;
        }
      }
    }
  }

  function triggerGameOver() {
    if (gamePhase === 'gameover') return;
    gamePhase = 'gameover';
    setTimeout(function() {
      gameActive = false;
      if (typeof onGameEnd === 'function') onGameEnd(platformsPassed, false);
    }, 500);
  }

  function updatePaletteColors() {
    var pal = PALETTES[currentPaletteIndex];
    if (postMesh) postMesh.material.color.setHex(pal.pole);
    if (ballMesh) ballMesh.material.color.setHex(pal.ball);
    updateBackground();
    platforms.forEach(function(p) {
      if (p.passed) return;
      p.segments.forEach(function(seg, s) {
        if (seg.isKiller) seg.mesh.material.color.setHex(pal.killer);
        else seg.mesh.material.color.setHex(s % 2 === 0 ? pal.platforms : pal.alt);
      });
    });
  }

  // ===================== HELPERS =====================
  function normAngle(a) { a = a % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a; }

  function isAngleInRange(angle, start, end) {
    angle = normAngle(angle); start = normAngle(start); end = normAngle(end);
    if (start <= end) return angle >= start && angle <= end;
    else return angle >= start || angle <= end;
  }
})();
