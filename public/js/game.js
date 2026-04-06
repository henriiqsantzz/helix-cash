// ===================== HELIX JUMP 3D GAME =====================
// Three.js WebGL Helix Jump - Premium UI & Physics
(function() {
  'use strict';

  // CONFIGURAÇÕES 100% HELIX JUMP (Câmera distante e bola no topo)
  var CONFIG = {
    platformCount: 30,
    platformSpacing: 2.5,
    platformOuterRadius: 2.4,
    platformInnerRadius: 0.6,
    platformHeight: 0.35,
    postRadius: 0.6,
    postHeight: 200,
    ballRadius: 0.35,
    ballBounceForce: 0.22,
    gravity: 0.015,
    segmentsPerPlatform: 12,
    holeSegments: 2,
    
    // === NOVOS AJUSTES DE CÂMERA E PILAR ===
    cameraFov: 65,            // Ângulo um pouco mais aberto para ver mais
    cameraDistance: 10.0,     // Câmera BEM mais longe da tela
    cameraHeight: 6.5,        // Altura da câmera
    cameraOffsetDown: 4.5,    // Quanto a câmera olha para baixo (Joga a bola pro topo da tela)
    postExtraTop: 3.5,        // Extensão do pilar para cima (Até sumir da tela)
    
    cameraFollowSpeed: 0.08,
    rotationSensitivity: 0.008,
    dangerChance: 0.12,
    targetMultiplier: 8,
    latheSegments: 32
  };

  window.helixGameConfig = CONFIG;

  var PALETTES = [
    { name:'Rose', platforms:0xFF9E9D, alt:0xFFBEB8, ball:0xFFFFFF, pole:0xE8294A, bgTop:'#FFE4EE', bgBottom:'#FFB3CB', killer:0x2A0010, topCap:0xE8294A },
    { name:'Ocean', platforms:0x7CB8E8, alt:0x9DD0F5, ball:0xFFFFFF, pole:0x2060A0, bgTop:'#E0F0FF', bgBottom:'#A0C8F0', killer:0x101030, topCap:0x2060A0 },
    { name:'Mint', platforms:0x8CE8A5, alt:0xB0F5C0, ball:0xFFFFFF, pole:0x208A40, bgTop:'#E0FFE8', bgBottom:'#A0F0B0', killer:0x102010, topCap:0x208A40 },
    { name:'Sunset', platforms:0xE8C88C, alt:0xF5DCA0, ball:0xFFFFFF, pole:0xC07820, bgTop:'#FFF5E0', bgBottom:'#F0D0A0', killer:0x2A1A0A, topCap:0xC07820 },
    { name:'Lavender', platforms:0xC88CE8, alt:0xDCA0F5, ball:0xFFFFFF, pole:0x8030B0, bgTop:'#F0E0FF', bgBottom:'#D0A0F0', killer:0x1A0A2A, topCap:0x8030B0 },
  ];

  var gameActive = false, betAmount = 0, platformsPassed = 0;
  var isCashingOut = false, gamePhase = 'ready', prizeAmount = 0;
  var currentPaletteIndex = 0, comboCount = 0, comboTimer = 0;
  var scene, camera, renderer, helixGroup, postMesh, ballMesh, topCapMesh;
  var platforms = [], animFrame = null, splashParticles = [];
  var ballVelY = 0, ballWorldY = 0;
  var isDragging = false, lastDragX = 0, helixRotation = 0;
  var cameraTargetY = 0, hudContainer = null;

  window.startHelixGame = function(bet, serverConfig) {
    if (serverConfig) {
      Object.keys(serverConfig).forEach(function(k) {
        if (CONFIG.hasOwnProperty(k)) CONFIG[k] = serverConfig[k];
      });
    }
    betAmount = bet; platformsPassed = 0; isCashingOut = false;
    gameActive = true; prizeAmount = 0; comboCount = 0; comboTimer = 0;
    currentPaletteIndex = 0; gamePhase = 'ready'; helixRotation = 0;
    splashParticles = [];
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

  function initGame() {
    cleanupThree();
    var canvas = document.getElementById('gameCanvas');
    var container = canvas.parentElement;
    var W = container.clientWidth || window.innerWidth;
    var H = container.clientHeight || window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, W / H, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    var dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    scene.add(dirLight);

    updateBackground();

    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    createPost();
    createTopCap();
    createPlatforms();
    createBall();

    // AJUSTE: Câmera nasce longe e olha para BAIXO, colocando a bola no topo
    camera.position.set(0, ballWorldY + CONFIG.cameraHeight, CONFIG.cameraDistance);
    camera.lookAt(0, ballWorldY - CONFIG.cameraOffsetDown, 0);
    cameraTargetY = ballWorldY + CONFIG.cameraHeight;

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
    helixGroup = null; postMesh = null; ballMesh = null; topCapMesh = null;
    platforms = []; splashParticles = [];
  }

  function createPost() {
    var pal = PALETTES[currentPaletteIndex];
    var geo = new THREE.CylinderGeometry(CONFIG.postRadius, CONFIG.postRadius, CONFIG.postHeight, 32, 1, false);
    var mat = new THREE.MeshStandardMaterial({ color: pal.pole, roughness: 0.3, metalness: 0.1 });
    postMesh = new THREE.Mesh(geo, mat);
    
    // AJUSTE: Sobe o pilar para ele varar o topo da tela
    postMesh.position.y = (-CONFIG.postHeight / 2) + CONFIG.postExtraTop;
    postMesh.receiveShadow = true;
    postMesh.castShadow = true;
    helixGroup.add(postMesh);
  }

  function createTopCap() {
    var pal = PALETTES[currentPaletteIndex];
    var capGeo = new THREE.SphereGeometry(CONFIG.postRadius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    var capMat = new THREE.MeshStandardMaterial({ color: pal.topCap, roughness: 0.3, metalness: 0.1 });
    topCapMesh = new THREE.Mesh(capGeo, capMat);
    
    // Acompanha a ponta do pilar novo
    topCapMesh.position.y = CONFIG.postExtraTop; 
    helixGroup.add(topCapMesh);
  }

  function createRingSegment(innerR, outerR, height, startAngle, arcAngle, color) {
    var pts = [
      new THREE.Vector2(innerR, -height / 2),
      new THREE.Vector2(outerR, -height / 2),
      new THREE.Vector2(outerR, height / 2),
      new THREE.Vector2(innerR, height / 2)
    ];
    var geo = new THREE.LatheGeometry(pts, CONFIG.latheSegments, startAngle, arcAngle);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, metalness: 0.1 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createPlatforms() {
    platforms = [];
    var pal = PALETTES[currentPaletteIndex];
    var segAngle = (Math.PI * 2) / CONFIG.segmentsPerPlatform;
    var holeArc = CONFIG.holeSegments * segAngle;

    for (var i = 0; i < CONFIG.platformCount; i++) {
      var y = -i * CONFIG.platformSpacing; 
      var holeStart = Math.random() * Math.PI * 2;
      var isDanger = i > 1 && Math.random() < CONFIG.dangerChance;

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
        
        if(isDanger) {
            mesh.material.emissive = new THREE.Color(pal.killer);
            mesh.material.emissiveIntensity = 0.2;
        }

        pData.group.add(mesh);
        pData.segments.push({ mesh: mesh, startAngle: sStart, endAngle: sStart + segAngle, isKiller: isDanger });
      }
      platforms.push(pData);
    }
  }

  function createBall() {
    var pal = PALETTES[currentPaletteIndex];
    var geo = new THREE.SphereGeometry(CONFIG.ballRadius, 32, 32);
    var mat = new THREE.MeshStandardMaterial({ color: pal.ball, roughness: 0.1, metalness: 0.2 });
    ballMesh = new THREE.Mesh(geo, mat);
    ballMesh.castShadow = true;
    
    var ballZ = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2;
    ballWorldY = (CONFIG.platformHeight / 2) + CONFIG.ballRadius; 
    ballMesh.position.set(0, ballWorldY, ballZ);
    scene.add(ballMesh);
  }

  function updateBackground() {
    var pal = PALETTES[currentPaletteIndex];
    var c = document.createElement('canvas');
    c.width = 2; c.height = 512;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, pal.bgTop); g.addColorStop(1, pal.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 512);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    scene.background = tex;
  }

  function createSplash(y) {
    var pal = PALETTES[currentPaletteIndex];
    for (var i = 0; i < 8; i++) {
      var geo = new THREE.SphereGeometry(0.08, 8, 8);
      var mat = new THREE.MeshBasicMaterial({ color: pal.platforms, transparent: true, opacity: 0.9 });
      var p = new THREE.Mesh(geo, mat);
      var angle = Math.random() * Math.PI * 2;
      var bz = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2;
      p.position.set(Math.sin(angle) * bz * 0.3, y + 0.1, Math.cos(angle) * bz * 0.3);
      scene.add(p);
      splashParticles.push({
        mesh: p,
        vx: (Math.random() - 0.5) * 0.2,
        vy: Math.random() * 0.15 + 0.05,
        vz: (Math.random() - 0.5) * 0.2,
        life: 30
      });
    }
  }

  function updateSplash() {
    for (var i = splashParticles.length - 1; i >= 0; i--) {
      var sp = splashParticles[i];
      sp.mesh.position.x += sp.vx;
      sp.mesh.position.y += sp.vy;
      sp.mesh.position.z += sp.vz;
      sp.vy -= 0.01;
      sp.life--;
      sp.mesh.material.opacity = sp.life / 30;
      if (sp.life <= 0) {
        scene.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        sp.mesh.material.dispose();
        splashParticles.splice(i, 1);
      }
    }
  }

  // ===================== HUD =====================
  function createHUD() {
    cleanupHUD();
    var container = document.getElementById('gameCanvas').parentElement;
    hudContainer = document.createElement('div');
    hudContainer.id = 'helix-hud';
    hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';

    var html = '<div style="position:absolute;top:12px;left:12px;z-index:100;pointer-events:auto;background:rgba(0,0,0,0.55);color:#fff;padding:6px 14px;border-radius:12px;font-family:Inter,sans-serif;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Entrada</div>'
      + '<div style="font-size:16px;font-weight:800;" id="hud-entry-val">R$ 0,00</div></div>';

    html += '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.55);color:#fff;padding:8px 16px;border-radius:12px;font-family:Inter,sans-serif;min-width:160px;text-align:center;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);max-width:calc(100% - 140px);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Progresso</div>'
      + '<div style="font-size:14px;font-weight:800;" id="hud-progress-val">R$ 0,00 / R$ 0,00</div>'
      + '<div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;">'
      + '<div id="hud-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#00e676,#69f0ae);border-radius:2px;transition:width 0.3s;"></div></div></div>';

    html += '<div id="hud-cashout" style="position:absolute;top:12px;right:12px;z-index:100;pointer-events:auto;background:linear-gradient(135deg,#00e676,#00c853);color:#000;padding:10px 16px;border-radius:12px;font-family:Inter,sans-serif;cursor:pointer;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:1px;border:none;box-shadow:0 4px 15px rgba(0,230,118,0.4);display:none;" onclick="helixGameCashOut()">Resgatar</div>';

    html += '<div id="hud-start" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:Inter,sans-serif;text-align:center;pointer-events:none;">'
      + '<div style="font-size:20px;font-weight:700;color:rgba(0,0,0,0.6);">Toque para jogar</div>'
      + '<div style="font-size:28px;margin-top:8px;color:rgba(0,0,0,0.4);animation:helixBounce 1s infinite;">&#8595;</div></div>';

    html += '<div id="hud-combo" style="position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:24px;font-weight:800;color:#ffab00;text-shadow:0 2px 8px rgba(255,171,0,0.5);opacity:0;transition:all 0.3s;"></div>';

    html += '<div id="hud-score-popup" style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:36px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.3);opacity:0;"></div>';

    html += '<div style="position:absolute;bottom:30px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.4);color:#fff;padding:6px 16px;border-radius:20px;font-family:Inter,sans-serif;backdrop-filter:blur(6px);font-size:13px;font-weight:600;">'
      + '<span id="hud-platform-count">0</span> plataformas</div>';

    hudContainer.innerHTML = html;

    var style = document.createElement('style');
    style.textContent = '@keyframes helixBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}@keyframes helixFadeUp{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-80%) scale(1.5)}}@keyframes helixPulse{0%,100%{box-shadow:0 4px 15px rgba(0,230,118,0.4)}50%{box-shadow:0 4px 25px rgba(0,230,118,0.7)}}';
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
    var pc = document.getElementById('hud-platform-count');

    if (ev) ev.textContent = 'R$ ' + fmtBRL(betAmount);

    var meta = betAmount * CONFIG.targetMultiplier;
    var prize = calcPrize(); prizeAmount = prize;

    if (pv) pv.textContent = 'R$ ' + fmtBRL(prize) + ' / R$ ' + fmtBRL(meta);
    if (pb) pb.style.width = Math.min(100, (prize / (meta || 1)) * 100) + '%';

    if (cb) {
      var goalReached = prize >= meta && meta > 0;
      cb.style.display = (gamePhase === 'playing' && goalReached) ? 'block' : 'none';
      if (goalReached) cb.style.animation = 'helixPulse 1s infinite';
    }

    if (ss) ss.style.display = gamePhase === 'ready' ? 'block' : 'none';
    if (pc) pc.textContent = platformsPassed;
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

    // AJUSTE CÂMERA: Acompanha mantendo a bola na tela superior
    if (camera && gamePhase !== 'ready') {
      cameraTargetY = ballWorldY + CONFIG.cameraHeight;
      camera.position.y += (cameraTargetY - camera.position.y) * CONFIG.cameraFollowSpeed;
      // O segredo do enquadramento: a câmera "olha" pro chão, não pra bola
      camera.lookAt(0, camera.position.y - CONFIG.cameraHeight - CONFIG.cameraOffsetDown, 0);
    }

    updateSplash();

    var np = Math.min(Math.floor(platformsPassed / 5), PALETTES.length - 1);
    if (np !== currentPaletteIndex) { currentPaletteIndex = np; updatePaletteColors(); }
    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return;

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

          p.segments.forEach(function(seg) { seg.mesh.material.transparent = true; seg.mesh.material.opacity = 0.2; });
          createSplash(p.y);

          if (typeof onPlatformPassed === 'function') onPlatformPassed(platformsPassed);
        } else {
          if (p.isDanger) { triggerGameOver(); return; }
          ballWorldY = platTop + CONFIG.ballRadius;
          ballVelY = -CONFIG.ballBounceForce;
          comboCount = 0; comboTimer = 0;
          
          if (ballMesh) {
            ballMesh.scale.set(1.3, 0.6, 1.3);
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
    if (postMesh) {
        postMesh.material.color.setHex(pal.pole);
        postMesh.material.needsUpdate = true;
    }
    if (topCapMesh) topCapMesh.material.color.setHex(pal.topCap);
    if (ballMesh) ballMesh.material.color.setHex(pal.ball);
    updateBackground();
    platforms.forEach(function(p) {
      if (p.passed) return;
      p.segments.forEach(function(seg, s) {
        if (seg.isKiller) {
            seg.mesh.material.color.setHex(pal.killer);
            seg.mesh.material.emissive.setHex(pal.killer);
        } else {
            seg.mesh.material.color.setHex(s % 2 === 0 ? pal.platforms : pal.alt);
        }
      });
    });
  }

  function normAngle(a) { a = a % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a; }

  function isAngleInRange(angle, start, end) {
    angle = normAngle(angle); start = normAngle(start); end = normAngle(end);
    if (start <= end) return angle >= start && angle <= end;
    else return angle >= start || angle <= end;
  }
})();
