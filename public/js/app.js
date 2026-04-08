// ===================== STATE =====================
let token = localStorage.getItem('hc_token');
let user = JSON.parse(localStorage.getItem('hc_user') || 'null');
let currentBet = 0;
let currentGameId = null;
let currentDepositId = null;
let depositCheckInterval = null;

// ===================== ROUTER =====================
function navigate(rawHash) {
  // Limpa o hash para remover parâmetros da URL (Ex: transforma "#cadastro?ref=123" em "#cadastro")
  let hash = rawHash.split('?')[0];

  const routes = {
    '': 'page-landing',
    '#': 'page-landing',
    '#login': 'page-login',
    '#cadastro': 'page-register',
    '#painel': 'page-panel',
    '#jogo': 'page-game'
  };

  if ((hash === '#painel' || hash === '#jogo') && !token) hash = '#login';
  if (token && (hash === '' || hash === '#' || hash === '#login' || hash === '#cadastro')) hash = '#painel';

  const pageId = routes[hash] || 'page-landing';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) { 
    page.classList.add('active'); 
    page.classList.remove('hidden'); 
  }
  if (hash === '#painel') { loadUserData(); loadStats(); }
}

window.addEventListener('hashchange', () => navigate(location.hash));

window.addEventListener('load', () => { 
  // Captura o código de indicação da query normal (?ref=) ou de dentro do Hash (#cadastro?ref=)
  let refCode = new URLSearchParams(window.location.search).get('ref');
  if (!refCode && window.location.hash.includes('?')) {
      refCode = new URLSearchParams(window.location.hash.split('?')[1]).get('ref');
  }

  if (refCode) {
    localStorage.setItem('hc_pending_ref', refCode);
    
    // Tenta preencher no input se ele já existir na tela
    const refInput = document.getElementById('registerReferralInput');
    if (refInput) refInput.value = refCode;
    
    // Se a pessoa acessou com link de indicação e não está logada, força o redirecionamento pro cadastro
    if (!token) {
        window.location.hash = '#cadastro';
    }
  }
  
  navigate(window.location.hash); 
  loadPublicStats(); 
});

// ===================== API HELPER =====================
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  } catch (e) { throw e; }
}

// ===================== AUTH =====================
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('registerError');
  errEl.classList.add('hidden');
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
  
  // Pega o código de indicação salvo no localStorage
  const pendingRef = localStorage.getItem('hc_pending_ref') || '';

  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value, 
        email: form.email.value,
        phone: form.phone.value, 
        password: form.password.value,
        referral_code: pendingRef
      })
    });
    token = data.token; user = data.user;
    localStorage.setItem('hc_token', token);
    localStorage.setItem('hc_user', JSON.stringify(user));
    localStorage.removeItem('hc_pending_ref');
    showToast('Conta criada com sucesso!');
    location.hash = '#painel';
  } catch (e) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
  finally { btn.disabled = false; btn.textContent = 'CRIAR CONTA'; }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.email.value, password: form.password.value })
    });
    token = data.token; user = data.user;
    localStorage.setItem('hc_token', token);
    localStorage.setItem('hc_user', JSON.stringify(user));
    if (user.is_admin) { window.location.href = '/admin.html'; return; }
    showToast('Bem-vindo de volta!');
    location.hash = '#painel';
  } catch (e) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
  finally { btn.disabled = false; btn.textContent = 'ENTRAR'; }
});

function logout() {
  token = null; user = null;
  localStorage.removeItem('hc_token'); 
  localStorage.removeItem('hc_user');
  
  // Fecha o menu se estiver aberto
  const menu = document.getElementById('sideMenu');
  const overlay = document.getElementById('menuOverlay');
  if (menu) menu.classList.remove('active');
  if (overlay) overlay.classList.remove('active');

  // Direciona para o login e força atualização para zerar o estado
  window.location.hash = '#login';
  window.location.reload();
}

// ===================== USER DATA =====================
async function loadUserData() {
  try {
    const data = await api('/api/user/me');
    user = data;
    localStorage.setItem('hc_user', JSON.stringify(user));
    updateUI();
  } catch (e) {
    if (e.message.includes('Token') || e.message.includes('Usuário')) logout();
  }
}

function updateUI() {
  if (!user) return;
  document.getElementById('userBalance').textContent = formatMoney(user.balance);
  document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
  document.getElementById('withdrawBalance').textContent = 'R$ ' + formatMoney(user.balance);
  
  // Atualiza o link de indicação dinâmico
  const referralLinkDisplay = document.getElementById('referralLinkDisplay');
  if (referralLinkDisplay) {
    const baseUrl = window.location.origin;
    referralLinkDisplay.textContent = `${baseUrl}/#cadastro?ref=${user.referral_code}`;
  }
  
  document.getElementById('refCount').textContent = user.referrals || 0;
}

// ===================== MENU LATERAL (PROFILE) =====================
function toggleMenu() {
  const menu = document.getElementById('sideMenu');
  const overlay = document.getElementById('menuOverlay');
  if (!menu || !overlay) return;

  const isActive = menu.classList.toggle('active');
  overlay.classList.toggle('active');

  if (isActive) {
    const currentUser = JSON.parse(localStorage.getItem('hc_user') || '{}');
    if (document.getElementById('menuUserName')) document.getElementById('menuUserName').textContent = currentUser.name || 'Usuário';
    if (document.getElementById('menuUserEmail')) document.getElementById('menuUserEmail').textContent = currentUser.email || '';
    if (document.getElementById('menuBalance')) document.getElementById('menuBalance').textContent = formatMoney(currentUser.balance);
    if (document.getElementById('menuBonus')) document.getElementById('menuBonus').textContent = formatMoney(currentUser.bonus_balance);
    if (document.getElementById('menuAvatar')) document.getElementById('menuAvatar').textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
    
    const adminArea = document.getElementById('adminMenuArea');
    if (adminArea) {
      adminArea.style.display = currentUser.is_admin ? 'block' : 'none';
    }
  }
}

// ===================== STATS =====================
function updateFakeStats() {
  // Oscila entre 10.000 e 100.000 online
  const online = Math.floor(Math.random() * (100000 - 10000 + 1)) + 10000;
  // Valores altos para o ganho
  const paid = Math.floor(Math.random() * (850000 - 350000 + 1)) + 350000; 
  const maxwin = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000; 

  const statOnline = document.getElementById('stat-online');
  if (statOnline) statOnline.textContent = online.toLocaleString('pt-BR');
  
  const statUsers = document.getElementById('stat-users');
  if (statUsers) statUsers.textContent = online.toLocaleString('pt-BR');
  
  const panelOnline = document.getElementById('panelOnline');
  if (panelOnline) panelOnline.textContent = online.toLocaleString('pt-BR');
  
  const statPaid = document.getElementById('stat-paid');
  if (statPaid) statPaid.textContent = 'R$ ' + paid.toLocaleString('pt-BR') + ',00';
  
  const statMaxwin = document.getElementById('stat-maxwin');
  if (statMaxwin) statMaxwin.textContent = 'R$ ' + maxwin.toLocaleString('pt-BR') + ',00';
}

async function loadPublicStats() {
  updateFakeStats();
  if (!window.fakeStatsInterval) {
    window.fakeStatsInterval = setInterval(updateFakeStats, 5000);
  }
}

async function loadStats() {
  updateFakeStats();
}

// ===================== BET SELECTION =====================
document.querySelectorAll('.bet-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bet-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBet = parseFloat(btn.dataset.amount);
    updateBetDisplay();
  });
});

function updateBetDisplay() {
  document.getElementById('betAmount').textContent = formatMoney(currentBet);
  const meta = currentBet * 7;
  document.getElementById('metaGanho').textContent = 'R$ ' + formatMoney(meta);
  document.getElementById('perPlatform').textContent = currentBet > 0 ? 'R$ ' + formatMoney(currentBet * 0.5) : '—';
  document.getElementById('platMeta').textContent = currentBet > 0 ? '14' : '—';
}

// ===================== PLAY GAME =====================
document.getElementById('btnPlay').addEventListener('click', async () => {
  if (currentBet <= 0) return showToast('Selecione um valor de aposta!', 'error');
  if (!user || user.balance < currentBet) return showToast('Saldo insuficiente! Faça um depósito.', 'error');

  const btn = document.getElementById('btnPlay');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';

  try {
    const data = await api('/api/game/start', {
      method: 'POST', body: JSON.stringify({ bet_amount: currentBet })
    });
    currentGameId = data.game_id;
    user.balance = data.new_balance;
    updateUI();

    document.getElementById('page-game').classList.remove('hidden');
    document.getElementById('gameOverOverlay').classList.add('hidden');

    let serverConfig = null;
    try {
      const settings = await api('/api/game/config');
      if (settings) serverConfig = settings;
    } catch(e) { }

    startHelixGame(currentBet, serverConfig);
  } catch (e) { showToast(e.message, 'error'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> JOGAR AGORA';
  }
});

function onPlatformPassed(count) { }

async function onGameEnd(platformsReached, cashed, prizeFromGame) {
  try {
    const data = await api('/api/game/finish', {
      method: 'POST',
      body: JSON.stringify({
        game_id: currentGameId,
        platforms_reached: platformsReached,
        cashed_out: cashed,
        prize: prizeFromGame
      })
    });

    user.balance = data.new_balance;
    updateUI();

    const overlay = document.getElementById('gameOverOverlay');
    overlay.classList.remove('hidden');

    const resultTitle = document.getElementById('resultTitle');
    const resultIcon = document.getElementById('resultIcon');

    if (cashed && (prizeFromGame > 0 || data.prize > 0)) {
      resultTitle.textContent = 'Resgatado!';
      resultTitle.style.color = 'var(--primary)';
      resultIcon.textContent = '💰';
    } else if ((prizeFromGame > 0 || data.prize > 0)) {
      resultTitle.textContent = 'Parabéns!';
      resultTitle.style.color = 'var(--primary)';
      resultIcon.textContent = '🎉';
    } else {
      resultTitle.textContent = 'Fim de Jogo!';
      resultTitle.style.color = '#ff4444';
      resultIcon.textContent = '💥';
    }

    document.getElementById('resultPrize').textContent = 'R$ ' + formatMoney(prizeFromGame || data.prize);
    
    const finalPlats = platformsReached !== undefined ? platformsReached : (data.platforms_reached || 0);
    const finalMult = prizeFromGame > 0 ? (prizeFromGame / currentBet).toFixed(2) : (data.multiplier || 0);

    document.getElementById('resultDetails').textContent =
      'Plataformas: ' + finalPlats + ' | Multiplicador: ' + finalMult + 'x | Aposta: R$ ' + formatMoney(currentBet);

  } catch (e) { showToast(e.message, 'error'); }
}

function cashOut() {
  if (typeof helixGameCashOut === 'function') helixGameCashOut();
}

function closeGame() {
  document.getElementById('page-game').classList.add('hidden');
  if (typeof stopHelixGame === 'function') stopHelixGame();
  currentGameId = null;
  loadUserData();
}

// ===================== DEPOSIT =====================
document.querySelectorAll('.amount-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.amount-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const val = btn.dataset.amount || btn.textContent.replace('R$', '').trim();
    document.getElementById('depositAmount').value = val;
  });
});

document.getElementById('btnDeposit').addEventListener('click', async () => {
  const amountInput = document.getElementById('depositAmount');
  const amount = parseFloat(amountInput.value);
  const cpfEl = document.getElementById('depositCpf');
  
  // Limpa o CPF para enviar apenas números (SafePix costuma rejeitar pontos e traços)
  const cpf = cpfEl ? cpfEl.value.replace(/\D/g, '') : '';
  
  if (!amount || amount < 1) return showToast('Depósito mínimo: R$ 1,00', 'error');
  if (!cpf || cpf.length < 11) return showToast('Informe um CPF válido para gerar o PIX', 'error');

  const btn = document.getElementById('btnDeposit');
  btn.disabled = true; 
  btn.innerHTML = '<span class="loader"></span>';

  try {
    // IMPORTANTE: Enviamos o amount como FLOAT, o seu index.js fará a conversão para centavos
    const data = await api('/api/deposit', {
      method: 'POST', 
      body: JSON.stringify({ 
        amount: amount, 
        cpf: cpf 
      })
    });

    // Ajuste para ler os campos exatos que a SafePix retorna
    currentDepositId = data.deposit_id || (data.deposit ? data.deposit.id : null);

    // SafePix retorna o código PIX em campos específicos
    const pixCode = data.pix_code || (data.deposit && data.deposit.pix_code);
    
    if (document.getElementById('pixCode')) {
        document.getElementById('pixCode').textContent = pixCode || 'Erro ao carregar código';
    }

    const qrImg = document.getElementById('pixQrImage');
    const qrLoading = document.getElementById('qrLoading');

    if (qrImg) {
        // Pega a URL vinda do backend ou tenta gerar via fallback seguro se o Google Charts falhar
        let qrSource = data.qr_code_base64 || (data.deposit && data.deposit.qr_code_base64);
        
        if (qrSource) {
            // Se for link do google charts antigo, o PIX longo pode quebrar. 
            // Se notar erro 404 na imagem, o backend deve ser atualizado para quickchart.io
            qrImg.src = qrSource;
            
            qrImg.onload = function() {
                qrImg.style.display = 'block';
                if (qrLoading) qrLoading.style.display = 'none';
            };

            qrImg.onerror = function() {
                // Caso a URL do Google Charts dê 404 (comum em códigos PIX longos), tenta QuickChart
                console.warn("Google Charts falhou, tentando QuickChart...");
                qrImg.src = `https://quickchart.io/qr?text=${encodeURIComponent(pixCode)}&size=300`;
            };
        }
    }

    const modal = document.getElementById('pixModal');
    if (modal) modal.classList.remove('hidden');

    if (currentDepositId) {
      if (depositCheckInterval) clearInterval(depositCheckInterval);
      depositCheckInterval = setInterval(checkDepositStatus, 5000);
    }

    showToast('PIX gerado com sucesso!');

  } catch (e) { 
    showToast(e.message, 'error'); 
  } finally { 
    btn.disabled = false; 
    btn.textContent = 'GERAR PIX'; 
  }
});

async function checkDepositStatus() {
  if (!currentDepositId) return;
  try {
    const data = await api('/api/deposit/status', {
      method: 'POST', body: JSON.stringify({ deposit_id: currentDepositId })
    });

    if (data.status === 'approved') {
      clearInterval(depositCheckInterval); depositCheckInterval = null;
      user.balance = data.new_balance; updateUI();
      showToast('Pagamento confirmado! Saldo atualizado.');
      const modal = document.getElementById('pixModal');
      if (modal) modal.classList.add('hidden');
      currentDepositId = null;
    } else if (data.status === 'rejected' || data.status === 'expired') {
      clearInterval(depositCheckInterval); depositCheckInterval = null;
      showToast('PIX expirado ou rejeitado. Tente novamente.', 'error');
      const modal = document.getElementById('pixModal');
      if (modal) modal.classList.add('hidden');
      currentDepositId = null;
    }
  } catch (e) { }
}

// ===================== WITHDRAW =====================
document.getElementById('btnWithdraw').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const pixKey = document.getElementById('pixKey').value;
  const pixType = document.getElementById('pixType').value;
  if (!amount || amount < 20) return showToast('Saque mínimo: R$ 20,00', 'error');
  if (!pixKey) return showToast('Informe a chave PIX', 'error');

  const btn = document.getElementById('btnWithdraw');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
  try {
    const data = await api('/api/withdraw', {
      method: 'POST', body: JSON.stringify({ amount, pix_key: pixKey, pix_type: pixType })
    });
    showToast(data.message); loadUserData();
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('pixKey').value = '';
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'SOLICITAR SAQUE'; }
});

// ===================== REFERRALS =====================
async function loadReferrals() {
  try {
    const data = await api('/api/referrals');
    document.getElementById('refEarned').textContent = 'R$ ' + formatMoney(data.total_earned);
    const listEl = document.getElementById('referralList');
    if (data.referrals.length === 0) {
      listEl.innerHTML = '<div class="referral-card" style="text-align:center;color:var(--text-secondary)">Nenhum indicado ainda. Compartilhe seu link!</div>';
    } else {
      listEl.innerHTML = data.referrals.map(r =>
        '<div class="history-item"><div class="left"><span class="type">' + r.name + '</span><span class="date">' + new Date(r.created_at).toLocaleDateString('pt-BR') + '</span></div><span class="amount positive">+R$ ' + formatMoney(r.amount || 0) + '</span></div>'
      ).join('');
    }
  } catch (e) { }
}

// ===================== NAVIGATION =====================
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const panel = btn.dataset.panel;
    document.querySelectorAll('.panel-sub').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    const target = document.getElementById('panel-' + panel);
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
    if (panel === 'referral') loadReferrals();
    if (panel === 'withdraw') updateUI();
  });
});

// ===================== HELPERS =====================
function formatMoney(val) { return parseFloat(val || 0).toFixed(2).replace('.', ','); }

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return console.log("Toast:", message);
  toast.textContent = message;
  toast.className = 'toast toast-' + type;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}
