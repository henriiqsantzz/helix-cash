// ===================== HELIX JUMP 3D GAME =====================
// Three.js WebGL Helix Jump - Modo Infinito com Dificuldade via Admin
(function() {
  'use strict';

  var CONFIG = {
    platformCount: 30, // Quantidade de plataformas visíveis simultaneamente
    platformSpacing: 2.2,
    platformOuterRadius: 2.2,
    platformInnerRadius: 0.5,
    platformHeight: 0.35,
    postRadius: 0.5,
    postHeight: 5000, // Poste estendido para permitir descida infinita
    ballRadius: 0.30,
    ballBounceForce: 0.35,
    gravity: 0.025,
    segmentsPerPlatform: 12,
    holeSegments: 2,
    
    // VARIÁVEIS BASE DO PAINEL ADMIN
    dangerStartLevel: 2,
    dangerProgression: 5,
    dangerMaxSlices: 6,
    
    // CÂMERA E ENQUADRAMENTO
    cameraFov: 60,
    cameraDistance: 11.0,
    cameraHeight: 6.5,
    cameraOffsetDown: 3.5,
    postExtraTop: 20.0,
    
    cameraFollowSpeed: 0.15,
    rotationSensitivity: 0.008,
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
  var lastGeneratedPlatformIndex = 0; // Controle para geração infinita
  
  // Variáveis de controle de Áudio para compatibilidade iOS/Android
  var audioCtx = null; 
  var audioUnlocked = false;

  window.startHelixGame = function(bet, serverConfig) {
    // 1. Reseta os valores base antes de aplicar configurações para não acumular dificuldade
    CONFIG.dangerStartLevel = 2;
    CONFIG.dangerProgression = 5;
    CONFIG.dangerMaxSlices = 6;
    
    var winRate = 50; // Padrão (50% de facilidade)

    // 2. Extrai as configurações enviadas pelo servidor (Node.js/App)
    if (serverConfig) {
      if (serverConfig.win_rate !== undefined) winRate = parseFloat(serverConfig.win_rate);
      if (serverConfig.influencer_win_rate !== undefined) winRate = parseFloat(serverConfig.influencer_win_rate);

      Object.keys(serverConfig).forEach(function(k) {
        if (k === 'game_platform_count') CONFIG.platformCount = parseInt(serverConfig[k]);
        if (k === 'game_gravity') CONFIG.gravity = parseFloat(serverConfig[k]);
        if (k === 'game_bounce_force') CONFIG.ballBounceForce = parseFloat(serverConfig[k]);
        if (k === 'game_hole_segments') CONFIG.holeSegments = parseFloat(serverConfig[k]);
        if (k === 'game_danger_start_level') CONFIG.dangerStartLevel = parseInt(serverConfig[k]);
        if (k === 'game_danger_max_slices') CONFIG.dangerMaxSlices = parseInt(serverConfig[k]);
        if (k === 'game_rotation_sensitivity') CONFIG.rotationSensitivity = parseFloat(serverConfig[k]);
        if (k === 'game_platform_spacing') CONFIG.platformSpacing = parseFloat(serverConfig[k]);
        if (k === 'max_multiplier') CONFIG.targetMultiplier = parseFloat(serverConfig[k]);
      });
    }

    // 3. --- SISTEMA DE DIFICULDADE DINÂMICA (INFLUENCIADOR) ---
    if (winRate > 50) {
      // FACILITAR
      var easyFactor = (winRate - 50) / 50; 
      CONFIG.dangerStartLevel += Math.floor(easyFactor * 40); 
      CONFIG.dangerMaxSlices = Math.max(1, Math.floor(CONFIG.dangerMaxSlices * (1 - easyFactor))); 
      CONFIG.dangerProgression = Math.max(1, CONFIG.dangerProgression * (1 - easyFactor)); 
      
    } else if (winRate < 50) {
      // DIFICULTAR
      var hardFactor = (50 - winRate) / 50; 
      CONFIG.dangerStartLevel = Math.max(1, CONFIG.dangerStartLevel - Math.floor(hardFactor * 2)); 
      CONFIG.dangerMaxSlices = Math.min(CONFIG.segmentsPerPlatform - 2, CONFIG.dangerMaxSlices + Math.floor(hardFactor * 6)); 
      CONFIG.dangerProgression += hardFactor * 10; 
    }

    // Inicia os parâmetros do jogo
    betAmount = parseFloat(bet); platformsPassed = 0; isCashingOut = false;
    gameActive = true; prizeAmount = 0; comboCount = 0; comboTimer = 0;
    currentPaletteIndex = 0; gamePhase = 'ready'; helixRotation = 0;
    splashParticles = [];
    lastGeneratedPlatformIndex = 0;
    
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
    
    var finalScore = platformsPassed;
    var finalPrize = calcPrize();

    isCashingOut = true; 
    gamePhase = 'gameover'; 
    
    // Desliga a renderização após 0.5s para poupar processamento
    setTimeout(function() { gameActive = false; }, 500);
    
    var cb = document.getElementById('hud-cashout');
    if (cb) {
        cb.style.background = 'rgba(255,255,255,0.9)';
        cb.style.color = '#000000';
        cb.style.border = 'none';
        cb.innerHTML = '<span style="font-weight:900;">PROCESSANDO...</span>';
        cb.style.pointerEvents = 'none';
        cb.style.animation = 'none';
        cb.style.boxShadow = 'none';
    }
    
    if (typeof window.onGameEnd === 'function') {
      window.onGameEnd(finalScore, true, finalPrize);
    } else if (typeof onGameEnd === 'function') {
      onGameEnd(finalScore, true, finalPrize);
    }
  };

  function initGame() {
    cleanupThree();
    var canvas = document.getElementById('gameCanvas');
    var container = canvas.parentElement;
    var W = container.clientWidth || window.innerWidth;
    var H = container.clientHeight || window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, W / H, 0.1, 5000);
    
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
    
    // Inicia com as primeiras plataformas visíveis
    for (var i = 0; i < 20; i++) {
      generateSinglePlatform(i);
    }
    
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

  function generateSinglePlatform(index) {
    var pal = PALETTES[currentPaletteIndex];
    var y = -index * CONFIG.platformSpacing;
    var segAngle = (Math.PI * 2) / CONFIG.segmentsPerPlatform;
    var holeArc = CONFIG.holeSegments * segAngle;
    var holeStart = Math.random() * Math.PI * 2;
    var holeEnd = holeStart + holeArc;

    var pData = {
      y: y, holeStart: holeStart, holeSize: holeArc,
      passed: false, segments: [],
      group: new THREE.Group(),
      index: index
    };
    pData.group.position.y = y;
    helixGroup.add(pData.group);

    var dangerSlicesCount = 0;
    if (index >= CONFIG.dangerStartLevel) {
      var andaresDeRisco = index - CONFIG.dangerStartLevel + 1;
      var minRed = Math.floor(andaresDeRisco * (CONFIG.dangerProgression / 4));
      dangerSlicesCount = Math.min(CONFIG.dangerMaxSlices, minRed + Math.floor(Math.random() * 3));
    }

    var validIndices = [];
    for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
      var sMid = (s * segAngle) + segAngle / 2;
      if (!isAngleInRange(sMid, holeStart, holeEnd)) {
        validIndices.push(s);
      }
    }

    var shuffled = validIndices.sort(function() { return 0.5 - Math.random() });
    var dangerIndices = shuffled.slice(0, dangerSlicesCount);

    for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
      var sStart = s * segAngle;
      if (isAngleInRange(sStart + segAngle / 2, holeStart, holeEnd)) continue;

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
    lastGeneratedPlatformIndex = index;
  }

  function createRingSegment(innerR, outerR, height, startAngle, arcAngle, color) {
    var shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, startAngle, startAngle + arcAngle, false);
    shape.absarc(0, 0, innerR, startAngle + arcAngle, startAngle, true);

    var bevelThickness = 0.04;
    var extrudeSettings = {
      depth: height - (bevelThickness * 2),
      bevelEnabled: true,
      bevelThickness: bevelThickness,
      bevelSize: 0.04,
      bevelSegments: 3,
      curveSegments: 24
    };

    var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.rotateX(-Math.PI / 2); 
    geo.translate(0, - (extrudeSettings.depth / 2), 0);

    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, metalness: 0.1 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
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

    html += '<button id="hud-cashout" style="position:absolute;bottom:85px;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:auto;background:linear-gradient(135deg,#FFD700,#FFB300);color:#000000;padding:12px 24px;border-radius:50px;font-family:Inter,sans-serif;cursor:pointer;font-weight:800;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;border:1px solid #FFECB3;box-shadow:0 0 20px rgba(255,215,0,0.6);display:none;align-items:center;justify-content:center;gap:10px;white-space:nowrap;transition:all 0.3s;" onpointerdown="window.helixGameCashOut(event)" ontouchstart="window.helixGameCashOut(event)" onclick="window.helixGameCashOut(event)">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>'
      + '<span style="font-weight:900;">RESGATAR</span> <span id="hud-cashout-val" style="background:rgba(0,0,0,0.1);padding:3px 8px;border-radius:12px;font-weight:900;">R$ 0,00</span></button>';

    html += '<div id="hud-start" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:Inter,sans-serif;text-align:center;pointer-events:none;">'
      + '<div style="font-size:20px;font-weight:700;color:rgba(0,0,0,0.6);">Toque para jogar</div>'
      + '<div style="font-size:28px;margin-top:8px;color:rgba(0,0,0,0.4);animation:helixBounce 1s infinite;">&#8595;</div></div>';

    html += '<div id="hud-combo" style="position:absolute;bottom:150px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:24px;font-weight:800;color:#ffab00;text-shadow:0 2px 8px rgba(255,171,0,0.5);opacity:0;transition:all 0.3s;"></div>';

    html += '<div id="hud-score-popup" style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:36px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.3);opacity:0;"></div>';

    html += '<div style="position:absolute;bottom:30px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.4);color:#fff;padding:6px 16px;border-radius:20px;font-family:Inter,sans-serif;backdrop-filter:blur(6px);font-size:13px;font-weight:600;">'
      + '<span id="hud-platform-count">0</span> plataformas</div>';

    hudContainer.innerHTML = html;

    var style = document.createElement('style');
    style.textContent = '@keyframes helixBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}@keyframes helixFadeUp{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-80%) scale(1.5)}}@keyframes pulseGolden{0%,100%{box-shadow:0 0 15px rgba(255,215,0,0.6); transform:translateX(-50%) scale(1)}50%{box-shadow:0 0 35px rgba(255,215,0,1); transform:translateX(-50%) scale(1.04)}}';
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
    var cv = document.getElementById('hud-cashout-val');
    var ss = document.getElementById('hud-start');
    var pc = document.getElementById('hud-platform-count');

    if (ev) ev.textContent = 'R$ ' + fmtBRL(betAmount);

    var meta = betAmount * CONFIG.targetMultiplier;
    var prize = calcPrize(); prizeAmount = prize;

    if (pv) pv.textContent = 'R$ ' + fmtBRL(prize) + ' / R$ ' + fmtBRL(meta);
    if (pb) pb.style.width = Math.min(100, (prize / (meta || 1)) * 100) + '%';
    
    if (cv) cv.textContent = 'R$ ' + fmtBRL(prize);

    if (cb) {
      var goalReached = prize >= meta && meta > 0;
      cb.style.display = (gamePhase === 'playing' && goalReached) ? 'flex' : 'none';
      if (goalReached) cb.style.animation = 'pulseGolden 2s infinite ease-in-out';
    }

    if (ss) ss.style.display = gamePhase === 'ready' ? 'block' : 'none';
    if (pc) pc.textContent = platformsPassed;
  }

  function calcPrize() {
    if (platformsPassed <= 0) return 0;
    var totalMultiplier = 0;
    for (var i = 0; i < platformsPassed; i++) {
      totalMultiplier += 0.15 + (i * 0.05);
    }
    return Math.round(betAmount * totalMultiplier * 100) / 100;
  }

  function fmtBRL(v) { return v.toFixed(2).replace('.', ','); }

  // FUNÇÃO DE ÁUDIO NATIVO DESBLOQUEADO (Compatível com iOS/Android)
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      if (!audioCtx) {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new window.AudioContext();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      // Toca um som vazio super rápido apenas para o iOS registrar que o áudio foi liberado
      var osc = audioCtx.createOscillator();
      var gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start(0);
      osc.stop(audioCtx.currentTime + 0.001);
      
      audioUnlocked = true;
    } catch(e) {
      console.warn("Áudio não pôde ser desbloqueado", e);
    }
  }

  // ====================================================================
  // NOVO SOM DE MOEDA (Estilo Clássico / Arcade - Quadrada + Senoidal)
  // ====================================================================
  function playMoneySound() {
    if (!audioUnlocked || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;

      // Usamos dois osciladores para criar o som de "Moeda" 
      var osc1 = audioCtx.createOscillator();
      var osc2 = audioCtx.createOscillator();
      var gainNode = audioCtx.createGain();

      // Onda quadrada: responsável pelo tom metálico clássico 8-bit (estilo Mario)
      osc1.type = 'square';
      // Onda senoidal: encorpa o som
      osc2.type = 'sine';

      // Frequências clássicas de moeda: Começa em B5 e pula rapidamente para E6
      var note1 = 987.77; // Si
      var note2 = 1318.51; // Mi

      osc1.frequency.setValueAtTime(note1, now);
      osc1.frequency.setValueAtTime(note2, now + 0.08); // Pulo da nota
      
      osc2.frequency.setValueAtTime(note1, now);
      osc2.frequency.setValueAtTime(note2, now + 0.08);

      // Desafina levemente a senoidal para dar brilho de "ouro" batendo
      osc2.detune.value = 8; 

      // Configuração de volume: Ataque imediato, sustentação curta e eco suave (fade out)
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02); // Sobe o volume rápido
      gainNode.gain.setValueAtTime(0.15, now + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4); // Desaparece aos poucos

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.4);
      osc2.stop(now + 0.4);
    } catch(e) { 
      // Silencioso em caso de falha de hardware
    }
  }

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
    // Adiciona o desbloqueio de áudio em TODOS os eventos de interação inicial
    ['mousedown', 'touchstart', 'click'].forEach(function(evt) {
        document.body.addEventListener(evt, unlockAudio, { once: true, capture: true });
    });

    c.addEventListener('mousedown', onDown);
    c.addEventListener('mousemove', onMove);
    c.addEventListener('mouseup', onUp);
    c.addEventListener('mouseleave', onUp);
    c.addEventListener('touchstart', onTouchDown, {passive:false});
    c.addEventListener('touchmove', onTouchMove, {passive:false});
    c.addEventListener('touchend', onUp);
    c.addEventListener('touchcancel', onUp); 
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
    c.removeEventListener('touchcancel', onUp);
    window.removeEventListener('resize', onResize);
  }

  function onDown(e) { 
    unlockAudio(); // Força desbloqueio caso o listener global falhe
    if (e.target && (e.target.id === 'hud-cashout' || e.target.closest('#hud-cashout'))) return;
    if (gamePhase === 'gameover') return; 
    if (gamePhase === 'ready') startPlaying(); 
    isDragging = true; 
    lastDragX = e.clientX; 
  }
  
  function onMove(e) { 
    if (gamePhase === 'gameover') return; 
    if (!isDragging) return; 
    var dx = e.clientX - lastDragX; 
    helixRotation += dx * CONFIG.rotationSensitivity; 
    if(helixGroup) helixGroup.rotation.y = helixRotation; 
    lastDragX = e.clientX; 
  }
  
  function onUp() { isDragging = false; }
  
  function onTouchDown(e) { 
    unlockAudio(); // Força desbloqueio no touch também
    if (e.target && (e.target.id === 'hud-cashout' || e.target.closest('#hud-cashout'))) return;
    if (e.cancelable) e.preventDefault(); 
    if (gamePhase === 'gameover') return; 
    if (gamePhase === 'ready') startPlaying(); 
    isDragging = true; 
    lastDragX = e.touches[0].clientX; 
  }
  
  function onTouchMove(e) { 
    if (e.cancelable) e.preventDefault(); 
    if (gamePhase === 'gameover') return; 
    
    if(!isDragging) {
      isDragging = true;
      lastDragX = e.touches[0].clientX;
      return;
    } 
    
    var dx = e.touches[0].clientX - lastDragX; 
    helixRotation += dx * CONFIG.rotationSensitivity; 
    if(helixGroup) helixGroup.rotation.y = helixRotation; 
    lastDragX = e.touches[0].clientX; 
  }

  function onResize() {
    if(!renderer||!camera) return;
    var ct=document.getElementById('gameCanvas').parentElement;
    var W=ct.clientWidth||window.innerWidth, H=ct.clientHeight||window.innerHeight;
    camera.aspect=W/H; camera.updateProjectionMatrix(); renderer.setSize(W,H);
  }
  
  function startPlaying() { 
    gamePhase='playing'; ballVelY=0; updateHUD(); 
  }

  function animate() {
    if (!gameActive) return; 
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
      
      if (Math.abs(ballWorldY) > (lastGeneratedPlatformIndex - 10) * CONFIG.platformSpacing) {
          generateSinglePlatform(lastGeneratedPlatformIndex + 1);
      }

      for (var i = platforms.length - 1; i >= 0; i--) {
          if (platforms[i].y > ballWorldY + 15) {
              helixGroup.remove(platforms[i].group);
              platforms[i].group.traverse(obj => { if(obj.geometry) obj.geometry.dispose(); if(obj.material) obj.material.dispose(); });
              platforms.splice(i, 1);
          }
      }
    }

    if (camera && gamePhase !== 'ready') {
      cameraTargetY = ballWorldY + CONFIG.cameraHeight;
      camera.position.y += (cameraTargetY - camera.position.y) * CONFIG.cameraFollowSpeed;
      camera.lookAt(0, camera.position.y - CONFIG.cameraHeight - CONFIG.cameraOffsetDown, 0);
    }

    updateSplash();

    var np = Math.min(Math.floor(platformsPassed / 5), PALETTES.length - 1);
    if (np !== currentPaletteIndex) { currentPaletteIndex = np; updatePaletteColors(); }
    updateHUD();
  }

  function checkCollisions() {
    if (ballVelY <= 0) return;
    var ballAngle = normAngle((3 * Math.PI / 2) - helixRotation);
    
    var ballRadiusAngle = Math.asin(CONFIG.ballRadius / ((CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2));
    var killMargin = ballRadiusAngle * 0.6; 

    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.passed) continue;
      var platTop = p.y + CONFIG.platformHeight / 2;
      var platBottom = p.y - CONFIG.platformHeight / 2;
      if (ballWorldY <= platTop + (CONFIG.ballRadius * 0.5) && ballWorldY >= platBottom && ballVelY > 0) {
        var inHole = isAngleInRange(ballAngle, p.holeStart, p.holeStart + p.holeSize);
        if (inHole) {
          p.passed = true;
          platformsPassed++;
          comboCount++; comboTimer = 60;
          if (comboCount >= 3) showCombo(comboCount);
          var oldP = prizeAmount;
          var newP = calcPrize();
          
          // Som de moeda garantido e melhorado
          playMoneySound();
          
          showScorePopup('+R$ ' + fmtBRL(newP - oldP));
          p.segments.forEach(function(seg) { seg.mesh.material.transparent = true; seg.mesh.material.opacity = 0.2; });
          createSplash(p.y);
          if (typeof onPlatformPassed === 'function') onPlatformPassed(platformsPassed);
        } else {
          var hitDanger = p.segments.some(seg => seg.isKiller && isAngleInRange(ballAngle, seg.startAngle - killMargin, seg.endAngle + killMargin));
          
          if (hitDanger) { 
            if (ballMesh) ballMesh.visible = false;
            createSplash(ballWorldY);
            createSplash(ballWorldY - 0.1); 
            
            triggerGameOver(); 
            return; 
          }
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
    var finalScore = platformsPassed;
    var finalPrize = 0; 
    gamePhase = 'gameover'; 
    var cb = document.getElementById('hud-cashout');
    if (cb) cb.style.display = 'none';
    
    setTimeout(function() {
        gameActive = false;
    }, 1500); 

    setTimeout(function() {
      if (typeof window.onGameEnd === 'function') window.onGameEnd(finalScore, false, finalPrize);
      else if (typeof onGameEnd === 'function') onGameEnd(finalScore, false, finalPrize);
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
