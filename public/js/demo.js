// ===================== HELIX JUMP 3D GAME - MODO DEMO ISOLADO =====================
(function() {
  'use strict';

  // Configurações travadas para o modo Demo (Versão Fácil / 60%)
  var CONFIG = {
    platformCount: 30, 
    platformSpacing: 2.2, 
    platformOuterRadius: 2.2,
    platformInnerRadius: 0.5, 
    platformHeight: 0.35, 
    postRadius: 0.5,
    postHeight: 5000, 
    ballRadius: 0.30, 
    ballBounceForce: 0.35, 
    gravity: 0.025,
    segmentsPerPlatform: 12, 
    
    // --- MUDANÇAS DA VERSÃO FÁCIL ---
    holeSegments: 3,         // AUMENTADO: O buraco de descida agora é maior (ocupa 3 fatias), facilitando muito a passagem.
    dangerStartLevel: 6,     // AUMENTADO: O jogador desce as primeiras 5 plataformas sem NENHUM perigo (tudo azul).
    dangerProgression: 10,   // AUMENTADO: Demora muito mais andares para o jogo adicionar mais fatias vermelhas.
    dangerMaxSlices: 2,      // REDUZIDO: O máximo de fatias vermelhas por andar nunca passa de 2 (sobrando muito espaço seguro).
    // --------------------------------
    
    cameraFov: 60, cameraDistance: 11.0, cameraHeight: 6.5, cameraOffsetDown: 3.5,
    postExtraTop: 20.0, cameraFollowSpeed: 0.15, rotationSensitivity: 0.008,
    targetMultiplier: 8, // Meta de R$ 80 (10 de entrada * 8)
    latheSegments: 32
  };

  var PALETTES = [
    { name:'Rose', platforms:0xFF9E9D, alt:0xFFBEB8, ball:0xFFFFFF, pole:0xE8294A, bgTop:'#FFE4EE', bgBottom:'#FFB3CB', killer:0x2A0010, topCap:0xE8294A },
    { name:'Ocean', platforms:0x7CB8E8, alt:0x9DD0F5, ball:0xFFFFFF, pole:0x2060A0, bgTop:'#E0F0FF', bgBottom:'#A0C8F0', killer:0x101030, topCap:0x2060A0 },
    { name:'Mint', platforms:0x8CE8A5, alt:0xB0F5C0, ball:0xFFFFFF, pole:0x208A40, bgTop:'#E0FFE8', bgBottom:'#A0F0B0', killer:0x102010, topCap:0x208A40 }
  ];

  var gameActive = false, betAmount = 10, platformsPassed = 0; // Valor de entrada travado em R$ 10
  var gamePhase = 'ready', prizeAmount = 0;
  var currentPaletteIndex = 0, comboCount = 0, comboTimer = 0;
  var scene, camera, renderer, helixGroup, postMesh, ballMesh, topCapMesh;
  var platforms = [], animFrame = null, splashParticles = [];
  var ballVelY = 0, ballWorldY = 0;
  var isDragging = false, lastDragX = 0, helixRotation = 0;
  var cameraTargetY = 0, hudContainer = null;
  var lastGeneratedPlatformIndex = 0; 
  var audioCtx = null; var audioUnlocked = false;

  // FUNÇÃO DE INÍCIO EXCLUSIVA DO DEMO
  window.startHelixDemo = function() {
    // Remove o popup se ele já estiver na tela
    var oldModal = document.getElementById('demoConversionModal');
    if (oldModal) oldModal.remove();

    platformsPassed = 0; prizeAmount = 0; comboCount = 0; comboTimer = 0;
    currentPaletteIndex = 0; gamePhase = 'ready'; helixRotation = 0;
    splashParticles = []; lastGeneratedPlatformIndex = 0; gameActive = true;
    
    initGame(); animate();
  };

  window.stopHelixDemo = function() {
    gameActive = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    removeEvents(); cleanupHUD(); cleanupThree();
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    updateBackground();
    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    createPost(); createTopCap();
    for (var i = 0; i < 20; i++) { generateSinglePlatform(i); }
    createBall();

    camera.position.set(0, ballWorldY + CONFIG.cameraHeight, CONFIG.cameraDistance);
    camera.lookAt(0, ballWorldY - CONFIG.cameraOffsetDown, 0);
    cameraTargetY = ballWorldY + CONFIG.cameraHeight;

    createHUD(); attachEvents();
  }

  function cleanupThree() {
    if (renderer) renderer.dispose();
    if (scene) {
      scene.traverse(function(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    scene = null; camera = null; renderer = null; helixGroup = null; 
    postMesh = null; ballMesh = null; topCapMesh = null;
    platforms = []; splashParticles = [];
  }

  function createPost() {
    var pal = PALETTES[currentPaletteIndex];
    var geo = new THREE.CylinderGeometry(CONFIG.postRadius, CONFIG.postRadius, CONFIG.postHeight, 32, 1, false);
    var mat = new THREE.MeshStandardMaterial({ color: pal.pole, roughness: 0.3, metalness: 0.1 });
    postMesh = new THREE.Mesh(geo, mat);
    postMesh.position.y = (-CONFIG.postHeight / 2) + CONFIG.postExtraTop;
    postMesh.receiveShadow = true; postMesh.castShadow = true;
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

    var pData = { y: y, holeStart: holeStart, holeSize: holeArc, passed: false, segments: [], group: new THREE.Group(), index: index };
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
      if (!isAngleInRange(sMid, holeStart, holeEnd)) validIndices.push(s);
    }

    var shuffled = validIndices.sort(function() { return 0.5 - Math.random() });
    var dangerIndices = shuffled.slice(0, dangerSlicesCount);

    for (var s = 0; s < CONFIG.segmentsPerPlatform; s++) {
      var sStart = s * segAngle;
      if (isAngleInRange(sStart + segAngle / 2, holeStart, holeEnd)) continue;

      var isDanger = dangerIndices.includes(s);
      var col = isDanger ? pal.killer : (s % 2 === 0 ? pal.platforms : pal.alt);
      var mesh = createRingSegment(CONFIG.platformInnerRadius, CONFIG.platformOuterRadius, CONFIG.platformHeight, sStart, segAngle, col);
      
      if(isDanger) { mesh.material.emissive = new THREE.Color(pal.killer); mesh.material.emissiveIntensity = 0.2; }
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
    var extrudeSettings = { depth: height - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 24 };
    var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.rotateX(-Math.PI / 2); geo.translate(0, - (extrudeSettings.depth / 2), 0);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, metalness: 0.1 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
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
    var c = document.createElement('canvas'); c.width = 2; c.height = 512;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, pal.bgTop); g.addColorStop(1, pal.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 512);
    var tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; scene.background = tex;
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
      splashParticles.push({ mesh: p, vx: (Math.random() - 0.5) * 0.2, vy: Math.random() * 0.15 + 0.05, vz: (Math.random() - 0.5) * 0.2, life: 30 });
    }
  }

  function updateSplash() {
    for (var i = splashParticles.length - 1; i >= 0; i--) {
      var sp = splashParticles[i];
      sp.mesh.position.x += sp.vx; sp.mesh.position.y += sp.vy; sp.mesh.position.z += sp.vz;
      sp.vy -= 0.01; sp.life--; sp.mesh.material.opacity = sp.life / 30;
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

    // UI Exclusiva do modo Demo (Sem botão de resgatar)
    var html = '<div style="position:absolute;top:12px;left:12px;z-index:100;background:rgba(0,0,0,0.55);color:#fff;padding:6px 14px;border-radius:12px;font-family:Inter,sans-serif;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">MODO DEMO</div>'
      + '<div style="font-size:16px;font-weight:800;">R$ 10,00</div></div>';

    html += '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.55);color:#fff;padding:8px 16px;border-radius:12px;font-family:Inter,sans-serif;min-width:160px;text-align:center;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);max-width:calc(100% - 140px);">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;">Acumulado / Meta</div>'
      + '<div style="font-size:14px;font-weight:800;" id="hud-progress-val">R$ 0,00 / R$ 80,00</div>'
      + '<div style="width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin-top:4px;overflow:hidden;">'
      + '<div id="hud-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#00e676,#69f0ae);border-radius:2px;transition:width 0.3s;"></div></div></div>';

    html += '<div id="hud-start" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:Inter,sans-serif;text-align:center;pointer-events:none;">'
      + '<div style="font-size:20px;font-weight:700;color:rgba(0,0,0,0.6);">Toque para testar</div>'
      + '<div style="font-size:28px;margin-top:8px;color:rgba(0,0,0,0.4);animation:helixBounce 1s infinite;">&#8595;</div></div>';

    html += '<div id="hud-combo" style="position:absolute;bottom:150px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:24px;font-weight:800;color:#ffab00;text-shadow:0 2px 8px rgba(255,171,0,0.5);opacity:0;transition:all 0.3s;"></div>';
    html += '<div id="hud-score-popup" style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);z-index:100;pointer-events:none;font-family:Inter,sans-serif;font-size:36px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.3);opacity:0;"></div>';

    hudContainer.innerHTML = html;
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
    var pv = document.getElementById('hud-progress-val');
    var pb = document.getElementById('hud-progress-bar');
    var ss = document.getElementById('hud-start');

    var prize = calcPrize(); prizeAmount = prize;

    if(pv) pv.textContent = 'R$ ' + fmtBRL(prize) + ' / R$ 80,00';
    if(pb) pb.style.width = Math.min(100, (prize / 80) * 100) + '%';
    if (ss) ss.style.display = gamePhase === 'ready' ? 'block' : 'none';
  }

  function calcPrize() {
    if (platformsPassed <= 0) return 0;
    var totalMultiplier = 0;
    for (var i = 0; i < platformsPassed; i++) { totalMultiplier += 0.15 + (i * 0.05); }
    return Math.round(betAmount * totalMultiplier * 100) / 100;
  }

  function fmtBRL(v) { return v.toFixed(2).replace('.', ','); }

  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      if (!audioCtx) { window.AudioContext = window.AudioContext || window.webkitAudioContext; audioCtx = new window.AudioContext(); }
      if (audioCtx.state === 'suspended') { audioCtx.resume(); }
      var osc = audioCtx.createOscillator(); var gainNode = audioCtx.createGain();
      gainNode.gain.value = 0; osc.connect(gainNode); gainNode.connect(audioCtx.destination);
      osc.start(0); osc.stop(audioCtx.currentTime + 0.001);
      audioUnlocked = true;
    } catch(e) { }
  }

  function playMoneySound() {
    if (!audioUnlocked || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      var osc1 = audioCtx.createOscillator(); var osc2 = audioCtx.createOscillator(); var gainNode = audioCtx.createGain();
      osc1.type = 'square'; osc2.type = 'sine';
      var note1 = 987.77; var note2 = 1318.51; 
      osc1.frequency.setValueAtTime(note1, now); osc1.frequency.setValueAtTime(note2, now + 0.08); 
      osc2.frequency.setValueAtTime(note1, now); osc2.frequency.setValueAtTime(note2, now + 0.08);
      osc2.detune.value = 8; 
      gainNode.gain.setValueAtTime(0, now); gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02); 
      gainNode.gain.setValueAtTime(0.15, now + 0.08); gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4); 
      osc1.connect(gainNode); osc2.connect(gainNode); gainNode.connect(audioCtx.destination);
      osc1.start(now); osc2.start(now); osc1.stop(now + 0.4); osc2.stop(now + 0.4);
    } catch(e) { }
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
    ['mousedown', 'touchstart', 'click'].forEach(function(evt) { document.body.addEventListener(evt, unlockAudio, { once: true, capture: true }); });
    c.addEventListener('mousedown', onDown); c.addEventListener('mousemove', onMove); c.addEventListener('mouseup', onUp); c.addEventListener('mouseleave', onUp);
    c.addEventListener('touchstart', onTouchDown, {passive:false}); c.addEventListener('touchmove', onTouchMove, {passive:false}); c.addEventListener('touchend', onUp); c.addEventListener('touchcancel', onUp); 
    window.addEventListener('resize', onResize);
  }

  function removeEvents() {
    var c = document.getElementById('gameCanvas');
    if (!c) return;
    c.removeEventListener('mousedown', onDown); c.removeEventListener('mousemove', onMove); c.removeEventListener('mouseup', onUp); c.removeEventListener('mouseleave', onUp);
    c.removeEventListener('touchstart', onTouchDown); c.removeEventListener('touchmove', onTouchMove); c.removeEventListener('touchend', onUp); c.removeEventListener('touchcancel', onUp);
    window.removeEventListener('resize', onResize);
  }

  function onDown(e) { unlockAudio(); if (gamePhase === 'gameover') return; if (gamePhase === 'ready') startPlaying(); isDragging = true; lastDragX = e.clientX; }
  function onMove(e) { if (gamePhase === 'gameover' || !isDragging) return; var dx = e.clientX - lastDragX; helixRotation += dx * CONFIG.rotationSensitivity; if(helixGroup) helixGroup.rotation.y = helixRotation; lastDragX = e.clientX; }
  function onUp() { isDragging = false; }
  function onTouchDown(e) { unlockAudio(); if (e.cancelable) e.preventDefault(); if (gamePhase === 'gameover') return; if (gamePhase === 'ready') startPlaying(); isDragging = true; lastDragX = e.touches[0].clientX; }
  function onTouchMove(e) { if (e.cancelable) e.preventDefault(); if (gamePhase === 'gameover') return; if(!isDragging) { isDragging = true; lastDragX = e.touches[0].clientX; return; } var dx = e.touches[0].clientX - lastDragX; helixRotation += dx * CONFIG.rotationSensitivity; if(helixGroup) helixGroup.rotation.y = helixRotation; lastDragX = e.touches[0].clientX; }
  function onResize() { if(!renderer||!camera) return; var ct=document.getElementById('gameCanvas').parentElement; var W=ct.clientWidth||window.innerWidth, H=ct.clientHeight||window.innerHeight; camera.aspect=W/H; camera.updateProjectionMatrix(); renderer.setSize(W,H); }
  
  function startPlaying() { gamePhase='playing'; ballVelY=0; updateHUD(); }

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
        ballMesh.position.z = (CONFIG.platformInnerRadius + CONFIG.platformOuterRadius) / 2; ballMesh.position.x = 0;
      }
      
      if (comboTimer > 0) { comboTimer--; if (comboTimer <= 0) comboCount = 0; }
      checkCollisions();
      
      if (Math.abs(ballWorldY) > (lastGeneratedPlatformIndex - 10) * CONFIG.platformSpacing) generateSinglePlatform(lastGeneratedPlatformIndex + 1);

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
          p.passed = true; platformsPassed++;
          comboCount++; comboTimer = 60;
          if (comboCount >= 3) showCombo(comboCount);
          
          var oldP = prizeAmount;
          var newP = calcPrize();
          prizeAmount = newP; 

          playMoneySound();
          showScorePopup('+R$ ' + fmtBRL(newP - oldP));
          
          p.segments.forEach(function(seg) { seg.mesh.material.transparent = true; seg.mesh.material.opacity = 0.2; });
          createSplash(p.y);

          // VERIFICA SE BATEU A META DE 80 REAIS NO DEMO
          if (newP >= 80) {
              if (ballMesh) ballMesh.visible = false;
              createSplash(ballWorldY);
              triggerGameOver(true); 
              return;
          }
        } else {
          var hitDanger = p.segments.some(seg => seg.isKiller && isAngleInRange(ballAngle, seg.startAngle - killMargin, seg.endAngle + killMargin));
          
          if (hitDanger) { 
            if (ballMesh) ballMesh.visible = false;
            createSplash(ballWorldY); createSplash(ballWorldY - 0.1); 
            triggerGameOver(false); 
            return; 
          }
          ballWorldY = platTop + CONFIG.ballRadius; ballVelY = -CONFIG.ballBounceForce;
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

  function triggerGameOver(isWin = false) {
    if (gamePhase === 'gameover') return;
    var finalScore = platformsPassed;
    var finalPrize = calcPrize(); 
    gamePhase = 'gameover'; 
    
    setTimeout(function() { gameActive = false; }, 1500); 

    setTimeout(function() {
      // GERA O POPUP DE CONVERSÃO DIRETAMENTE NA TELA DO JOGO
      showDemoConversionPopup(finalPrize, finalScore, isWin);
    }, 500); 
  }

  // --- POPUP INJETADO DIRETAMENTE VIA JS (SEM PRECISAR DE HTML NO INDEX) ---
  function showDemoConversionPopup(prize, score, isWin) {
      var gameScreen = document.getElementById('gameCanvas').parentElement;
      if (!gameScreen) return;

      var modal = document.createElement('div');
      modal.id = 'demoConversionModal';
      modal.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:15px; box-sizing:border-box; font-family: "Inter", sans-serif;';

      var iconHtml = isWin ? 
        '<div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg, #00e676, #1de9b6);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;font-weight:900;margin:0 auto 12px;box-shadow:0 0 20px rgba(0,230,118,0.4);flex-shrink:0;">🎉</div>' : 
        '<div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg, #ff5722, #ff9800);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;font-weight:900;margin:0 auto 12px;box-shadow:0 0 20px rgba(255,87,34,0.4);flex-shrink:0;">!</div>';

      var titleText = isWin ? 
        '<h2 style="color:#00e676;font-size:clamp(20px, 5vw, 24px);font-weight:900;margin-bottom:6px;text-transform:uppercase;">PARABÉNS!</h2>' : 
        '<h2 style="color:#fff;font-size:clamp(20px, 5vw, 24px);font-weight:900;margin-bottom:6px;text-transform:uppercase;">😔 QUE PENA!</h2>';

      var descText = isWin ? 
        '<p style="color:#a0a0c0;font-size:clamp(12px, 3.5vw, 14px);margin-bottom:15px;line-height:1.4;">Você bateu a meta e acumulou <b>R$ ' + fmtBRL(prize) + '</b>!<br>Crie sua conta para resgatar dinheiro de verdade.</p>' : 
        '<p style="color:#a0a0c0;font-size:clamp(12px, 3.5vw, 14px);margin-bottom:15px;line-height:1.4;">Você acumulou <b>R$ ' + fmtBRL(prize) + '</b> mas não resgatou a tempo.<br>Na próxima você consegue!</p>';

      var boxBorder = isWin ? 'rgba(0,230,118,0.2)' : 'rgba(255,100,100,0.2)';
      var prizeColor = isWin ? '#00e676' : '#ff7575';
      var boxLabel = isWin ? 'VOCÊ ACUMULOU' : 'VOCÊ PODERIA TER RESGATADO';

      var scrollStyle = '<style>#demoConversionModalInner::-webkit-scrollbar { display: none; } #demoConversionModalInner { -ms-overflow-style: none; scrollbar-width: none; }</style>';

      modal.innerHTML = scrollStyle + `
        <div id="demoConversionModalInner" style="background:#0f071a; border:1px solid rgba(255,255,255,0.05); border-radius:24px; padding:20px 15px; width:100%; max-width:400px; max-height:90vh; overflow-y:auto; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.5); box-sizing:border-box;">
          ${iconHtml}
          ${titleText}
          ${descText}

          <div style="background:rgba(255,255,255,0.03);border:1px solid ${boxBorder};border-radius:16px;padding:15px;margin-bottom:15px;">
            <div style="font-size:10px;text-transform:uppercase;color:#a0a0c0;letter-spacing:1px;font-weight:700;margin-bottom:5px;">${boxLabel}</div>
            <div style="font-size:clamp(30px, 8vw, 42px);font-weight:900;color:${prizeColor};line-height:1;">R$ ${fmtBRL(prize)}</div>
            <div style="font-size:12px;color:#a0a0c0;margin-top:5px;">${score} plataformas passadas</div>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:10px;margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:clamp(11px, 3.5vw, 13px);color:#d0d0e0;text-align:left;">
            <div style="color:#00e676;font-size:16px;flex-shrink:0;">✅</div>
            <div>Mais de <strong style="color:#00e676;">12.000 jogadores</strong> já resgataram prêmios esta semana</div>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:10px;margin-bottom:15px;display:flex;align-items:center;gap:8px;font-size:clamp(11px, 3.5vw, 13px);color:#d0d0e0;text-align:left;">
            <div style="font-size:16px;flex-shrink:0;">🎁</div>
            <div><strong style="color:#ff4081;">Ganhe 50% de bônus</strong> no primeiro depósito — oferta por tempo limitado!</div>
          </div>

          <p style="font-size:clamp(10px, 3vw, 12px);color:#a0a0c0;margin-bottom:15px;line-height:1.3;">Com uma conta real você pode resgatar de verdade. Não perca mais oportunidades!</p>

          <button onclick="window.sairDoDemo('#cadastro')" style="width:100%;background:linear-gradient(135deg, #ff4081, #d500f9);color:#fff;border:none;padding:clamp(12px, 3.5vw, 16px);border-radius:50px;font-size:clamp(12px, 3.5vw, 15px);font-weight:900;text-transform:uppercase;margin-bottom:10px;cursor:pointer;box-shadow:0 10px 20px rgba(213,0,249,0.3);display:flex;align-items:center;justify-content:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            CRIAR CONTA E GANHAR DE VERDADE
          </button>

          <button onclick="window.sairDoDemo('#login')" style="width:100%;background:rgba(255,255,255,0.05);color:#fff;border:1px solid rgba(255,255,255,0.1);padding:clamp(12px, 3.5vw, 16px);border-radius:50px;font-size:clamp(12px, 3.5vw, 14px);font-weight:700;text-transform:uppercase;margin-bottom:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
            JÁ TENHO CONTA — ENTRAR
          </button>

          <div style="font-size:9px;color:rgba(255,255,255,0.2);line-height:1.4;">Estes valores são fictícios e servem apenas para demonstração.<br>Nenhum valor foi debitado ou creditado em conta real.</div>
        </div>
      `;

      gameScreen.appendChild(modal);
  }

  // REDIRECIONAMENTO FINAL DO FUNIL
  window.sairDoDemo = function(hashTarget) {
      document.getElementById('page-game').classList.add('hidden'); // Esconde o canvas do jogo
      
      // Tenta achar a home page original pra ativar, se existir
      var landing = document.getElementById('page-landing');
      if(landing) landing.classList.add('active'); 
      
      var modal = document.getElementById('demoConversionModal');
      if (modal) modal.remove();
      
      window.location.hash = hashTarget; // Joga pra página de cadastro ou login
  };

  function updatePaletteColors() {
    var pal = PALETTES[currentPaletteIndex];
    if (postMesh) { postMesh.material.color.setHex(pal.pole); postMesh.material.needsUpdate = true; }
    if (topCapMesh) topCapMesh.material.color.setHex(pal.topCap);
    if (ballMesh) ballMesh.material.color.setHex(pal.ball);
    updateBackground();
    platforms.forEach(function(p) {
      if (p.passed) return;
      p.segments.forEach(function(seg, s) {
        if (seg.isKiller) {
            seg.mesh.material.color.setHex(pal.killer); seg.mesh.material.emissive.setHex(pal.killer);
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
