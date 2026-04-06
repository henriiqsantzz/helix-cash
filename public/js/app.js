// ===================== STATE =====================
let token = localStorage.getItem('hc_token');
let user = JSON.parse(localStorage.getItem('hc_user') || 'null');
let currentBet = 0;
let currentGameId = null;
let currentDepositId = null;
let depositCheckInterval = null;

// ===================== ROUTER =====================
function navigate(hash) {
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
window.addEventListener('load', () => { navigate(location.hash); loadPublicStats(); });

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
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value, email: form.email.value,
        phone: form.phone.value, password: form.password.value,
        referral_code: form.referral_code.value
      })
    });
    token = data.token; user = data.user;
    localStorage.setItem('hc_token', token);
    localStorage.setItem('hc_user', JSON.stringify(user));
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
  localStorage.removeItem('hc_token'); localStorage.removeItem('hc_user');
  location.hash = '#';
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
  document.getElementById('referralCode').textContent = user.referral_code;
  document.getElementById('refCount').textContent = user.referrals || 0;
}

// ===================== STATS =====================
async function loadPublicStats() {
  try {
    const stats = await api('/api/stats');
    document.getElementById('stat-online').textContent = stats.online.toLocaleString('pt-BR');
    document.getElementById('stat-users').textContent = stats.online.toLocaleString('pt-BR');
    document.getElementById('stat-paid').textContent = 'R$ ' + stats.today_paid.toLocaleString('pt-BR');
    document.getElementById('stat-maxwin').textContent = 'R$ ' + stats.max_win_today.toLocaleString('pt-BR');
  } catch (e) { /* silent */ }
}

async function loadStats() {
  try {
    const stats = await api('/api/stats');
    const el = document.getElementById('panelOnline');
    if (el) el.textContent = stats.online;
  } catch (e) { /* silent */ }
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
  document.getElementById('perPlatform').textContent = currentBet > 0 ? 'R$ ' + formatMoney(currentBet * 0.5) : '\u2014';
  document.getElementById('platMeta').textContent = currentBet > 0 ? '14' : '\u2014';
}

// ===================== PLAY GAME =====================
document.getElementById('btnPlay').addEventListener('click', async () => {
  if (currentBet <= 0) return showToast('Selecione um valor de aposta!', 'error');
  if (!user || user.balance < currentBet) return showToast('Saldo insuficiente! Faca um deposito.', 'error');

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

async function onGameEnd(platformsReached, cashed) {
  try {
    const data = await api('/api/game/finish', {
      method: 'POST',
      body: JSON.stringify({
        game_id: currentGameId,
        platforms_reached: platformsReached,
        cashed_out: cashed
      })
    });

    user.balance = data.new_balance;
    updateUI();

    const overlay = document.getElementById('gameOverOverlay');
    overlay.classList.remove('hidden');

    if (cashed && data.prize > 0) {
      document.getElementById('resultTitle').textContent = 'Resgatado!';
      document.getElementById('resultTitle').style.color = 'var(--primary)';
      document.getElementById('resultIcon').textContent = '\uD83D\uDCB0';
    } else if (data.prize > 0) {
      document.getElementById('resultTitle').textContent = 'Parabens!';
      document.getElementById('resultTitle').style.color = 'var(--primary)';
      document.getElementById('resultIcon').textContent = '\uD83C\uDF89';
    } else {
      document.getElementById('resultTitle').textContent = 'Fim de Jogo!';
      document.getElementById('resultTitle').style.color = '#ff4444';
      document.getElementById('resultIcon').textContent = '\uD83D\uDCA5';
    }

    document.getElementById('resultPrize').textContent = 'R$ ' + formatMoney(data.prize);
    document.getElementById('resultDetails').textContent =
      'Plataformas: ' + data.platforms_reached + ' | Multiplicador: ' + data.multiplier + 'x | Aposta: R$ ' + formatMoney(data.bet_amount);

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

// ===================== DEPOSIT (CORRIGIDO) =====================

// Escuta cliques nos botões de valores pré-definidos (R$ 10, 20, etc)
document.querySelectorAll('.amount-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.amount-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const val = btn.dataset.amount || btn.textContent.replace('R$', '').trim();
    document.getElementById('depositAmount').value = val;
  });
});

// Função para gerar o depósito
document.getElementById('btnDeposit').addEventListener('click', async () => {
  const amountInput = document.getElementById('depositAmount');
  const amount = parseFloat(amountInput.value);
  const cpfEl = document.getElementById('depositCpf');
  const cpf = cpfEl ? cpfEl.value.trim() : '';
  
  if (!amount || amount < 10) return showToast('Deposito minimo: R$10,00', 'error');
  if (!cpf || cpf.length < 11) return showToast('Informe um CPF válido para gerar o PIX', 'error');

  const btn = document.getElementById('btnDeposit');
  btn.disabled = true; 
  btn.innerHTML = '<span class="loader"></span>';

  try {
    const data = await api('/api/deposit', {
  method: 'POST', body: JSON.stringify({ amount, cpf })
});

currentDepositId = data.deposit_id || (data.deposit ? data.deposit.id : null);

// 1. Pega o código PIX Texto (Copia e Cola)
const pixCode = data.pix_code || (data.deposit && data.deposit.pix_code);
if (document.getElementById('pixCode')) {
    document.getElementById('pixCode').textContent = pixCode || 'Erro ao gerar código';
}

// 2. EXIBIÇÃO DO QR CODE (Ajuste aqui)
const qrImg = document.getElementById('pixQrImage');
const qrLoading = document.getElementById('qrLoading');

if (qrImg) {
    // Tenta pegar o base64 de todos os lugares possíveis que o servidor pode mandar
    let qrSource = data.qr_code_base64 || 
                   (data.deposit && data.deposit.qr_code_base64) || 
                   data.qr_code_image || 
                   (data.deposit && data.deposit.qr_code_image);
    
    if (qrSource && qrSource.length > 50) {
        // Remove espaços e garante o cabeçalho data:image
        qrSource = qrSource.replace(/\s/g, ''); 
        const finalSrc = qrSource.startsWith('data:') ? qrSource : `data:image/png;base64,${qrSource}`;
        
        qrImg.src = finalSrc;
        qrImg.style.display = 'block';
        if (qrLoading) qrLoading.style.display = 'none';
        
        console.log("QR Code carregado com sucesso.");
    } else {
        console.error("Imagem Base64 não encontrada no JSON de resposta:", data);
        qrImg.style.display = 'none';
        if (qrLoading) qrLoading.style.display = 'block';
    }
}

    // Abre o modal
    const modal = document.getElementById('pixModal');
    if (modal) modal.classList.remove('hidden');

    // Inicia verificação de status
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
  if (!amount || amount < 20) return showToast('Saque minimo: R$20,00', 'error');
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
      listEl.innerHTML = '<div class="referral-card" style="text-align:center;color:var(--text-secondary)">Nenhum indicado ainda. Compartilhe seu codigo!</div>';
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
