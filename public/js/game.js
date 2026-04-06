// ===================== HELIX JUMP 3D GAME =====================
// Three.js WebGL Helix Jump - Blindado contra Atrasos de Clique (DevTools/Mobile)
(function() {
  'use strict';

  var CONFIG = {
    platformCount: 30,
    platformSpacing: 2.2,
    platformOuterRadius: 2.2,
    platformInnerRadius: 0.5,
    platformHeight: 0.35,
    postRadius: 0.5,
    postHeight: 200,
    ballRadius: 0.30,
    ballBounceForce: 0.22,
    gravity: 0.015,
    segmentsPerPlatform: 12,
    holeSegments: 2,
    
    // VARIÁVEIS DINÂMICAS (Sincronizadas com Admin)
    dangerStartLevel: 2,
    dangerProgression: 5,
    dangerMaxSlices: 6,
    holeSegments: 1.5,
    rotationSensitivity: 0.008,
    
    // CÂMERA E ENQUADRAMENTO
    cameraFov: 60,
    cameraDistance: 11.0,
    cameraHeight: 6.5,
    cameraOffsetDown: 3.5,
    postExtraTop: 20.0,
    
    cameraFollowSpeed: 0.08,
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

  // FUNÇÃO DE INICIALIZAÇÃO CORRIGIDA PARA DIFICULDADE ADMIN
  window.startHelixGame = function(bet, serverConfig) {
    if (serverConfig) {
      // Aplica as configurações do Admin (Seja usuário normal ou influencer)
      // O backend já envia os valores de "inf_" se o usuário for influencer
      Object.keys(serverConfig).forEach(function(k) {
        // Mapeia os campos do servidor para o CONFIG do jogo
        if (k === 'game_platform_count') CONFIG.platformCount = parseInt(serverConfig[k]);
        if (k === 'game_gravity') CONFIG.gravity = parseFloat(serverConfig[k]);
        if (k === 'game_bounce_force') CONFIG.ballBounceForce = parseFloat(serverConfig[k]);
        if (k === 'game_hole_segments') CONFIG.holeSegments = parseFloat(serverConfig[k]);
        if (k === 'game_danger_start_level') CONFIG.dangerStartLevel = parseInt(serverConfig[k]);
        if (k === 'game_danger_max_slices') CONFIG.dangerMaxSlices = parseInt(serverConfig[k]);
        if (k === 'game_rotation_sensitivity') CONFIG.rotationSensitivity = parseFloat(serverConfig[k]);
        if (k === 'game_platform_spacing') CONFIG.platformSpacing = parseFloat(serverConfig[k]);
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
    if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
    }
    removeEvents(); cleanupHUD(); cleanupThree();
  };

  window.helixGameCashOut = function(e) {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }
    if (isCashingOut) return;
    if (!gameActive || gamePhase === 'gameover') return;
    
    if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
    }

    isCashingOut = true; 
    gamePhase = 'gameover'; 
    gameActive = false; 
    
    var cb = document.getElementById('hud-cashout');
    if (cb) {
        cb.style.background = '#ffffff';
        cb.style.color = '#000000';
        cb.innerText = 'PROCESSANDO...';
        cb.style.pointerEvents = 'none';
    }
    
    if (typeof window.onGameEnd === 'function') {
      window.onGameEnd(platformsPassed, true);
    }
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
    scene.add(dirLight);

    updateBackground();

    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    createPost();
    createTopCap();
    createPlatforms();
    createBall();

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
    topCapMesh.position.y = CONFIG.postExtraTop; 
    helixGroup.add(topCapMesh);
  }

  function createRingSegment(innerR, outerR, height, startAngle, arcAngle, color) {
    var shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, startAngle, startAngle + arcAngle, false);
    shape.absarc(0, 0, innerR, startAngle + arcAngle, startAngle, true);

    var extrudeSettings = {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 3,
      curveSegments: 24
    };

    var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.rotateX(-Math.PI / 2); 
    geo.translate(0, 0, 0);

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
    
    // Buraco dinâmico baseado no Admin
    var holeArc = CONFIG.holeSegments * segAngle;

    for (var i = 0; i < CONFIG.platformCount; i++) {
      var y = -i * CONFIG.platformSpacing; 
      var holeStart = Math.random() * Math.PI * 2;
      var holeEnd = holeStart + holeArc;

      var pData = {
        y: y, holeStart: holeStart, holeSize: holeArc,
        passed: false, segments: [],
        group: new THREE.Group()
      };
      pData.group.position.y = y;
      helixGroup.add(pData.group);

      var dangerSlicesCount = 0;
      if (i >= CONFIG.dangerStartLevel) { 
        var minRed = Math.floor((i - CONFIG.dangerStartLevel) / 5); 
        dangerSlicesCount = Math.min(CONFIG.dangerMaxSlices, minRed + 1);
      }

      var validSegmentsIndices = [];
      for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
        var sMid = (s * segAngle) + segAngle / 2;
        if (!isAngleInRange(sMid, holeStart, holeEnd)) validSegmentsIndices.push(s);
      }

      var shuffled = validSegmentsIndices.sort(function() { return 0.5 - Math.random() });
      var dangerIndices = shuffled.slice(0, dangerSlicesCount);

      for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
        var sStart = s * segAngle;
        var sMid = sStart + segAngle / 2;
        if (isAngleInRange(sMid, holeStart, holeEnd)) continue;

        var isDanger = dangerIndices.includes(s);
        var col = isDanger ? pal.killer : (s % 2 === 0 ? pal.platforms : pal.alt);
        
        var mesh = createRingSegment(CONFIG.platformInnerRadius, CONFIG.platformOuterRadius, CONFIG.platformHeight, sStart, segAngle, col);
        
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

  function updateSplash() {
    for (var i = splashParticles.length - 1; i >= 0; i--) {
      var sp = splashParticles[i];
      sp.mesh.position.x += sp.vx; sp.mesh.position.y += sp.vy; sp.mesh.position.z += sp.vz;
      sp.vy -= 0.01; sp.life--;
      sp.mesh.material.opacity = sp.life / 30;
      if (sp.life <= 0) {
        scene.remove(sp.mesh); sp.mesh.geometry.dispose(); sp.mesh.material.dispose();
        splashParticles.splice(i, 1);
      }
    }
  }

  function createHUD() {
    cleanupHUD();
    var container = document.getElementById('gameCanvas').parentElement;
    hudContainer = document.createElement('div');
    hudContainer.id = 'helix-hud';
    hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';

    var html = '<div style="position:absolute;top:12px;left:12px;z-index:100;pointer-events:auto;background:rgba(0,0,0,0.55);color:#fff;padding:6px 14px;border-radius:12px;font-family:Inter,sans-serif;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Entrada</div>'
      + '<div style="font-size:16px;font-weight:800;" id="hud-entry-val">R$ 0,00</div></div>';

    html += '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.55);color:#fff;padding:8px 16px;border-radius:12px;font-family:Inter,sans-serif;min-width:160px;text-align:center;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Progresso</div>'
      + '<div style="font-size:14px;font-weight:800;" id="hud-progress-val">R$ 0,00</div>'
      + '<div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;"><div id="hud-progress-bar" style="width:0%;height:100%;background:#00e676;"></div></div></div>';

    html += '<button id="hud-cashout" style="position:absolute;top:12px;right:12px;z-index:9999;pointer-events:auto;background:#00e676;color:#000;padding:16px 28px;border-radius:12px;font-family:Inter,sans-serif;cursor:pointer;font-weight:900;font-size:16px;border:none;display:none;" onpointerdown="window.helixGameCashOut(event)">RESGATAR</button>';

    html += '<div id="hud-start" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:Inter,sans-serif;text-align:center;"><div style="font-size:20px;font-weight:700;color:rgba(0,0,0,0.6);">Toque para jogar</div></div>';

    hudContainer.innerHTML = html;
    container.appendChild(hudContainer);
    updateHUD();
  }

  function cleanupHUD() {
    if (hudContainer && hudContainer.parentNode) { hudContainer.parentNode.removeChild(hudContainer); hudContainer = null; }
  }

  function updateHUD() {
    if (!hudContainer) return;
    document.getElementById('hud-entry-val').textContent = 'R$ ' + fmtBRL(betAmount);
    var prize = calcPrize();
    document.getElementById('hud-progress-val').textContent = 'R$ ' + fmtBRL(prize);
    
    var cb = document.getElementById('hud-cashout');
    if (cb) cb.style.display = (gamePhase === 'playing' && prize > 0) ? 'block' : 'none';
    
    var ss = document.getElementById('hud-start');
    if (ss) ss.style.display = gamePhase === 'ready' ? 'block' : 'none';
  }

  function calcPrize() {
    if (platformsPassed <= 0) return 0;
    var m = 0;
    for (var i = 0; i < platformsPassed; i++) m += 0.15 + (i * 0.05);
    return Math.round(betAmount * m * 100) / 100;
  }

  function fmtBRL(v) { return parseFloat(v).toFixed(2).replace('.', ','); }

  function attachEvents() {
    var c = document.getElementById('gameCanvas');
    c.addEventListener('mousedown', onDown);
    c.addEventListener('mousemove', onMove);
    c.addEventListener('mouseup', onUp);
    c.addEventListener('touchstart', onTouchDown, {passive:false});
    c.addEventListener('touchmove', onTouchMove, {passive:false});
    c.addEventListener('touchend', onUp);
    window.addEventListener('resize', onResize);
  }

  function onDown(e) { if(gamePhase==='ready')startPlaying(); isDragging=true; lastDragX=e.clientX; }
  function onMove(e) { if(!isDragging)return; var dx=e.clientX-lastDragX; helixRotation+=dx*CONFIG.rotationSensitivity; if(helixGroup)helixGroup.rotation.y=helixRotation; lastDragX=e.clientX; }
  function onUp() { isDragging=false; }
  function onTouchDown(e) { e.preventDefault(); if(gamePhase==='ready')startPlaying(); isDragging=true; lastDragX=e.touches[0].clientX; }
  function onTouchMove(e) { e.preventDefault(); if(!isDragging)return; var dx=e.touches[0].clientX-lastDragX; helixRotation+=dx*CONFIG.rotationSensitivity; if(helixGroup)helixGroup.rotation.y=helixRotation; lastDragX=e.touches[0].clientX; }
  function onResize() {
    if(!renderer||!camera) return;
    var ct=document.getElementById('gameCanvas').parentElement;
    var W=ct.clientWidth, H=ct.clientHeight;
    camera.aspect=W/H; camera.updateProjectionMatrix(); renderer.setSize(W,H);
  }
  function startPlaying() { gamePhase='playing'; ballVelY=0; updateHUD(); }

  function animate() {
    if (!gameActive && gamePhase !== 'gameover') return;
    animFrame = requestAnimationFrame(animate);
    update();
    if (renderer) renderer.render(scene, camera);
  }

  function update() {
    if (gamePhase === 'playing') {
      ballVelY += CONFIG.gravity;
      ballWorldY -= ballVelY;
      if (ballMesh) { ballMesh.position.y = ballWorldY; }
      checkCollisions();
      if (ballWorldY < -(CONFIG.platformCount + 1) * CONFIG.platformSpacing) window.helixGameCashOut();
    }
    if (camera && gamePhase !== 'ready') {
      cameraTargetY = ballWorldY + CONFIG.cameraHeight;
      camera.position.y += (cameraTargetY - camera.position.y) * CONFIG.cameraFollowSpeed;
      camera.lookAt(0, camera.position.y - CONFIG.cameraHeight - CONFIG.cameraOffsetDown, 0);
    }
    updateSplash();
    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return;
    var ballAngle = normAngle((3 * Math.PI / 2) - helixRotation);

    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.passed) continue;
      var platTop = p.y + CONFIG.platformHeight / 2;
      
      if (ballWorldY <= platTop + 0.1 && ballWorldY >= p.y - 0.1) {
        if (isAngleInRange(ballAngle, p.holeStart, p.holeStart + p.holeSize)) {
          p.passed = true; platformsPassed++;
          p.segments.forEach(function(s){s.mesh.visible=false;});
        } else {
          var hitDanger = false;
          p.segments.forEach(function(s){ if(isAngleInRange(ballAngle, s.startAngle, s.endAngle) && s.isKiller) hitDanger=true; });
          if (hitDanger) { triggerGameOver(); return; }
          ballWorldY = platTop + CONFIG.ballRadius;
          ballVelY = -CONFIG.ballBounceForce;
          break;
        }
      }
    }
  }

  function triggerGameOver() {
    gamePhase = 'gameover'; 
    var cb = document.getElementById('hud-cashout');
    if (cb) cb.style.display = 'none';
    setTimeout(function() {
      gameActive = false;
      if (typeof window.onGameEnd === 'function') window.onGameEnd(platformsPassed, false);
    }, 500);
  }

  function normAngle(a) { a = a % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a; }
  function isAngleInRange(angle, start, end) {
    angle = normAngle(angle); start = normAngle(start); end = normAngle(end);
    if (start <= end) return angle >= start && angle <= end;
    else return angle >= start || angle <= end;
  }
})();
