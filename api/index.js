const crypto = require('crypto');
const fs = require('fs');

// ===================== CONFIG =====================
const JWT_SECRET = process.env.JWT_SECRET || 'helix-cash-secret-2024';
const DB_FILE = '/tmp/helix-db.json';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

// CREDENCIAIS SAFEPIX (CHAVES REAIS DO USUÁRIO)
const SAFEPIX_PUBLIC_KEY = process.env.SAFEPIX_PUBLIC_KEY || 'safepix_live_MyPu6LlpTczGHIJt0aA9OF9gAfetvgnh';
const SAFEPIX_SECRET_KEY = process.env.SAFEPIX_SECRET_KEY || 'sk_live_aCX5fucV1Kjx98iTfaLH675KMpI7xiiH';

// ===================== SUPABASE HELPER =====================
async function supaFetch(path, method, body, extraHeaders) {
  if (!USE_SUPABASE) return null;
  var url = SUPABASE_URL + '/rest/v1/' + path;
  var opts = {
    method: method || 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(extraHeaders || {})
    }
  };
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    opts.body = JSON.stringify(body);
  }
  var res = await fetch(url, opts);
  var text = await res.text();
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text);
  return text ? JSON.parse(text) : null;
}

// ===================== DATABASE =====================
function createDefaultDB() {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin123', salt, 1000, 64, 'sha512').toString('hex');
  return {
    users: [{
      id: 1, name: 'Admin', email: 'admin@helixcash.com', phone: null,
      password: salt + ':' + hash, balance: 0, bonus_balance: 0,
      referral_code: 'ADMIN001', referred_by: null,
      is_admin: true, is_blocked: false, is_influencer: false,
      influencer_win_rate: 0, total_deposited: 0, total_withdrawn: 0, total_games: 0,
      created_at: new Date().toISOString(), last_login: null
    }],
    deposits: [],
    withdrawals: [],
    games: [],
    pending_games: [],
    referral_earnings: [],
    webhooks: [],
    settings: {
      min_deposit: '1', min_withdrawal: '20', max_multiplier: '7',
      referral_bonus: '20', house_edge: '15', influencer_house_edge: '5',
      site_name: 'Helix Cash',
      game_platform_count: '25', game_danger_start_level: '2', game_danger_progression: '5',
      game_danger_max_slices: '6', game_hole_segments: '1.5', game_rotation_sensitivity: '0.008',
      inf_game_danger_max_slices: '1', inf_game_danger_start_level: '10', inf_game_hole_segments: '3.0'
    },
    next_id: { users: 2, deposits: 1, withdrawals: 1, games: 1, pending_games: 1, referral_earnings: 1, webhooks: 1 }
  };
}

async function loadDB() {
  if (USE_SUPABASE) {
    try {
      var rows = await supaFetch('app_state?select=data&id=eq.1');
      if (rows && rows.length > 0 && rows[0].data) {
        var data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        if (!data.pending_games) data.pending_games = [];
        if (!data.webhooks) data.webhooks = [];
        if (!data.next_id.pending_games) data.next_id.pending_games = 1;
        try { fs.writeFileSync(DB_FILE, JSON.stringify(data)); } catch(e) {}
        return data;
      }
    } catch (e) { console.error('Supabase load error:', e.message); }
  }
  try {
    if (fs.existsSync(DB_FILE)) {
      var data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!data.pending_games) data.pending_games = [];
      if (!data.webhooks) data.webhooks = [];
      if (!data.next_id.pending_games) data.next_id.pending_games = 1;
      return data;
    }
  } catch (e) { console.error('DB load error:', e.message); }
  return createDefaultDB();
}

async function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {}
  if (USE_SUPABASE) {
    try {
      await supaFetch('app_state', 'POST',
        { id: 1, data: db, updated_at: new Date().toISOString() },
        { 'Prefer': 'return=minimal,resolution=merge-duplicates' }
      );
    } catch (e) { console.error('Supabase save error:', e.message); }
  }
}

// ===================== AUTH HELPERS =====================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  const test = crypto.pbkdf2Sync(password, parts[0], 1000, 64, 'sha512').toString('hex');
  return parts[1] === test;
}

function createToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ id: userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function verifyToken(token) {
  try {
    const p = token.split('.');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(p[0] + '.' + p[1]).digest('base64url');
    if (p[2] !== sig) return null;
    const data = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}

function parseBody(req) {
  if (req.body) return Promise.resolve(req.body);
  return new Promise(function (resolve) {
    let d = '';
    req.on('data', function (c) { d += c; });
    req.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
  });
}

function respond(res, code, data) {
  if (typeof res.status === 'function') return res.status(code).json(data);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function getUser(db, req) {
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return db.users.find(function (u) { return u.id === decoded.id; }) || null;
}

function num(v) { return parseFloat(v) || 0; }

// ===================== MAIN HANDLER =====================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return respond(res, 200, {});

  var db = await loadDB();
  var url = req.url.split('?')[0];
  var method = req.method;

  const safePixAuth = "Basic " + Buffer.from(`${SAFEPIX_PUBLIC_KEY}:${SAFEPIX_SECRET_KEY}`).toString("base64");

  try {
    // ==================== PUBLIC STATS ====================
    if (url === '/api/stats' && method === 'GET') {
      var nonAdmin = db.users.filter(function (u) { return !u.is_admin; });
      var todayGames = db.games.filter(function (g) {
        return g.created_at && g.created_at.startsWith(new Date().toISOString().split('T')[0]);
      });
      var todayPaid = todayGames.filter(function (g) { return g.result === 'win'; })
        .reduce(function (s, g) { return s + num(g.prize); }, 0);
      var maxWin = todayGames.filter(function (g) { return g.result === 'win'; })
        .reduce(function (max, g) { return Math.max(max, num(g.prize)); }, 0);
      return respond(res, 200, {
        online: Math.max(nonAdmin.length, Math.floor(Math.random() * 50) + 20),
        today_paid: todayPaid,
        max_win_today: maxWin
      });
    }

    // ==================== AUTH: REGISTER ====================
    if (url === '/api/auth/register' && method === 'POST') {
      var body = await parseBody(req);
      var name = (body.name || '').trim();
      var email = (body.email || '').trim().toLowerCase();
      var phone = (body.phone || '').trim();
      var password = body.password || '';
      var referralCode = (body.referral_code || '').trim();

      if (!name || !email || !password) return respond(res, 400, { error: 'Nome, email e senha sao obrigatorios' });
      if (password.length < 4) return respond(res, 400, { error: 'Senha deve ter pelo menos 4 caracteres' });

      var existing = db.users.find(function (u) { return u.email === email; });
      if (existing) return respond(res, 400, { error: 'Email ja cadastrado' });

      var code = 'HC' + crypto.randomBytes(3).toString('hex').toUpperCase();
      var newUser = {
        id: db.next_id.users++, name: name, email: email, phone: phone || null,
        password: hashPassword(password), balance: 0, bonus_balance: 0,
        referral_code: code, referred_by: referralCode || null,
        is_admin: false, is_blocked: false, is_influencer: false,
        influencer_win_rate: 0, total_deposited: 0, total_withdrawn: 0, total_games: 0,
        created_at: new Date().toISOString(), last_login: new Date().toISOString()
      };
      db.users.push(newUser);
      await saveDB(db);
      var token = createToken(newUser.id);
      return respond(res, 200, {
        token: token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, balance: 0, bonus_balance: 0, referral_code: code, is_admin: newUser.is_admin }
      });
    }

    // ==================== AUTH: LOGIN ====================
    if (url === '/api/auth/login' && method === 'POST') {
      var body = await parseBody(req);
      var email = (body.email || '').trim().toLowerCase();
      var password = body.password || '';

      if (!email || !password) return respond(res, 400, { error: 'Email e senha sao obrigatorios' });

      var user = db.users.find(function (u) { return u.email === email; });
      if (!user) return respond(res, 401, { error: 'Email ou senha incorretos' });
      if (!verifyPassword(password, user.password)) return respond(res, 401, { error: 'Email ou senha incorretos' });
      if (user.is_blocked) return respond(res, 403, { error: 'Conta bloqueada' });

      user.last_login = new Date().toISOString();
      await saveDB(db);

      var token = createToken(user.id);
      return respond(res, 200, {
        token: token,
        user: {
          id: user.id, name: user.name, email: user.email,
          balance: num(user.balance), bonus_balance: num(user.bonus_balance),
          referral_code: user.referral_code, is_admin: user.is_admin
        }
      });
    }

    // ==================== AUTH: ME ====================
    if ((url === '/api/auth/me' || url === '/api/user/me') && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, {
        id: user.id,
        name: user.name,
        email: user.email,
        balance: num(user.balance),
        bonus_balance: num(user.bonus_balance),
        referral_code: user.referral_code,
        is_admin: user.is_admin,
        is_influencer: user.is_influencer,
        referrals: db.users.filter(function (u) { return u.referred_by === user.referral_code; }).length
      });
    }

    // ==================== USER: BALANCE ====================
    if (url === '/api/user/balance' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, { balance: num(user.balance), bonus_balance: num(user.bonus_balance) });
    }

    // ==================== DEPOSIT ====================
    if (url === '/api/deposit' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      
      try {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const postbackUrl = `${protocol}://${host}/api/webhook/safepix`;

        const amountCents = Math.round(num(body.amount) * 100);
        const cleanCpf = body.cpf ? body.cpf.replace(/\D/g, '') : '';

        const payload = {
          amount: amountCents,
          payment_method: "pix",
          postback_url: postbackUrl,
          customer: {
            name: user.name,
            email: user.email,
            document: { type: "cpf", number: cleanCpf },
            phone: user.phone || "5511999999999"
          },
          items: [{
            title: "Creditos Helix Cash",
            unit_price: amountCents,
            quantity: 1,
            tangible: false
          }],
          metadata: { provider_name: "API Pix", user_id: String(user.id) }
        };

        const safeRes = await fetch('https://api.safepix.pro/v1/payment-transaction/create', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'authorization': safePixAuth
          },
          body: JSON.stringify(payload)
        });

        const jsonResponse = await safeRes.json();

        if (!safeRes.ok || !jsonResponse.success) {
          return respond(res, 400, { error: jsonResponse.message || 'Erro ao gerar pagamento SafePix' });
        }

        const safeData = jsonResponse.data;
        const pixString = safeData.pix ? safeData.pix.qr_code : "";
        const qrCodeImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(pixString)}&size=300`;

        var dep = {
          id: db.next_id.deposits++, 
          user_id: user.id, 
          amount: num(body.amount),
          status: 'pending', 
          pix_code: pixString, 
          transaction_id: safeData.id,
          qr_code_base64: qrCodeImageUrl,
          created_at: new Date().toISOString(), 
          updated_at: new Date().toISOString()
        };

        db.deposits.push(dep);
        await saveDB(db);

        return respond(res, 200, { 
          success: true, 
          deposit: dep, 
          pix_code: dep.pix_code, 
          qr_code_base64: qrCodeImageUrl,
          deposit_id: dep.id 
        });
      } catch (e) {
        return respond(res, 500, { error: 'Erro de conexao SafePix' });
      }
    }

    // ==================== CHECK DEPOSIT STATUS ====================
    if (url === '/api/deposit/status' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var depId = body.deposit_id;

      var dep = db.deposits.find(function(d) { return d.id === depId && d.user_id === user.id; });
      if (!dep) return respond(res, 404, { error: 'Deposito nao encontrado' });

      return respond(res, 200, {
        status: dep.status, amount: num(dep.amount), new_balance: num(user.balance),
        pix_code: dep.pix_code, qr_code_base64: dep.qr_code_base64
      });
    }

    // ==================== WEBHOOK SAFEPIX ====================
    if (url === '/api/webhook/safepix' && method === 'POST') {
      var body = await parseBody(req);
      db.webhooks.push({ id: db.next_id.webhooks++, data: body, created_at: new Date().toISOString() });
      await saveDB(db);

      const txId = body.Id || body.id;
      const status = body.Status || body.status;

      if (txId && (status === 'PAID')) {
        var dep = db.deposits.find(d => String(d.transaction_id) === String(txId) && d.status === 'pending');
        if (dep) {
          dep.status = 'approved';
          dep.updated_at = new Date().toISOString();
          var user = db.users.find(u => u.id === dep.user_id);
          if (user) {
            user.balance = parseFloat((num(user.balance) + num(dep.amount)).toFixed(2));
            if (num(user.total_deposited) === 0 && num(dep.amount) >= 50 && user.referred_by) {
              var referrer = db.users.find(u => u.referral_code === user.referred_by);
              if (referrer) {
                referrer.balance = parseFloat((num(referrer.balance) + 20).toFixed(2));
                db.referral_earnings.push({
                  id: db.next_id.referral_earnings++, user_id: referrer.id, from_user_id: user.id, amount: 20, created_at: new Date().toISOString()
                });
              }
            }
            user.total_deposited = (user.total_deposited || 0) + num(dep.amount);
          }
          await saveDB(db);
        }
      }
      return respond(res, 200, { success: true });
    }

    // ==================== REFERRALS ====================
    if (url === '/api/referrals' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });

      var referredUsers = db.users.filter(u => u.referred_by === user.referral_code);
      var earnings = db.referral_earnings.filter(e => e.user_id === user.id);
      var totalEarned = earnings.reduce((s, e) => s + num(e.amount), 0);

      var list = referredUsers.map(u => {
        var hasContributed = earnings.some(e => e.from_user_id === u.id);
        return {
          name: u.name,
          created_at: u.created_at,
          status: hasContributed ? 'Confirmado' : 'Pendente (Aguardando R$ 50)',
          amount: hasContributed ? 20.00 : 0
        };
      });

      return respond(res, 200, {
        total_earned: totalEarned,
        count_total: referredUsers.length,
        referrals: list
      });
    }

    // ==================== WITHDRAW ====================
    if (url === '/api/withdraw' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var amount = num(body.amount);
      var pixKey = (body.pix_key || '').trim();
      var minWd = num(db.settings.min_withdrawal) || 20;

      if (!pixKey) return respond(res, 400, { error: 'Chave PIX obrigatoria' });
      if (num(user.balance) < amount) return respond(res, 400, { error: 'Saldo insuficiente' });
      if (amount < minWd) return respond(res, 400, { error: 'Saque minimo: R$' + minWd });

      try {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const postbackUrl = `${protocol}://${host}/api/webhook/safepix_withdrawal`;

        const payoutRes = await fetch('https://api.safepix.pro/v1/wallet-transaction/create/withdrawal', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'authorization': safePixAuth
          },
          body: JSON.stringify({
            pix_key: pixKey,
            pix_type: body.pix_type || 'cpf',
            amount: amount,
            postback_url: postbackUrl
          })
        });

        const payoutData = await payoutRes.json();
        
        if (!payoutRes.ok || !payoutData.success) {
          return respond(res, 400, { error: payoutData.message || 'Erro Saque SafePix' });
        }

        user.balance = parseFloat((num(user.balance) - amount).toFixed(2));
        db.withdrawals.push({
          id: db.next_id.withdrawals++, user_id: user.id, amount,
          pix_key: pixKey, status: 'processing', 
          transaction_id: payoutData.data ? payoutData.data.id : payoutData.Id,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        });
        await saveDB(db);
        return respond(res, 200, { success: true, message: 'Saque enviado para processamento!' });
      } catch (e) {
        return respond(res, 500, { error: 'Erro ao processar saque' });
      }
    }

    // ==================== GAME ROUTES ====================
    if (url === '/api/game/config' && method === 'GET') {
      var user = getUser(db, req);
      var s = db.settings;
      var houseEdge = num(s.house_edge);

      var config = {
        ...s,
        win_rate: 100 - houseEdge,
        difficulty_curve: {
          start_speed: 1.0,
          max_speed_boost: houseEdge / 100, 
          danger_increase_step: houseEdge > 60 ? 3 : 6, 
          min_hole_size: Math.max(1.1, 2.5 - (houseEdge / 40))
        }
      };

      if (user && user.is_influencer) {
        config.win_rate = num(user.influencer_win_rate) || 100;
        config.difficulty_curve = { start_speed: 1.0, max_speed_boost: 0, danger_increase_step: 99, min_hole_size: 2.5 };
      }
      return respond(res, 200, config);
    }

    if (url === '/api/game/start' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var betAmount = num(body.bet_amount);

      if (!betAmount || betAmount <= 0) return respond(res, 400, { error: 'Valor invalido' });
      if (betAmount > num(user.balance)) return respond(res, 400, { error: 'Saldo insuficiente' });

      user.balance = parseFloat((num(user.balance) - betAmount).toFixed(2));
      var pg = {
        id: db.next_id.pending_games++, user_id: user.id,
        bet_amount: betAmount, created_at: new Date().toISOString()
      };
      db.pending_games.push(pg);
      await saveDB(db);

      return respond(res, 200, { game_id: pg.id, new_balance: user.balance });
    }

    if (url === '/api/game/finish' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);

      var gameId = body.game_id;
      var platformsReached = num(body.platforms_reached) || 0;
      var pgIndex = db.pending_games.findIndex(p => p.id === gameId && p.user_id === user.id);
      var pg = pgIndex >= 0 ? db.pending_games[pgIndex] : null;
      var betAmount = pg ? num(pg.bet_amount) : num(body.bet_amount);
      if (!betAmount || betAmount <= 0) return respond(res, 400, { error: 'Jogo nao encontrado' });

      if (pgIndex >= 0) db.pending_games.splice(pgIndex, 1);

      var prize = num(body.prize); 
      
      // Correção Aplicada: O sistema de "house_edge" (probabilidade de perda) estava
      // cancelando o prêmio e forçando prize = 0 no backend MESMO APÓS o jogador ter
      // ganho e clicado em "Resgatar". A trava randômica foi removida para garantir
      // que o que o jogador ganhou na tela seja 100% computado no saldo principal.

      var result = prize > 0 ? 'win' : 'loss';
      
      // O saldo é atualizado com precisão absoluta para evitar travamentos de decimais
      user.balance = parseFloat((num(user.balance) + prize).toFixed(2));
      user.total_games = (user.total_games || 0) + 1;

      var game = {
        id: db.next_id.games++, user_id: user.id, bet_amount: betAmount, 
        multiplier: prize > 0 ? (prize / betAmount).toFixed(2) : 0,
        platforms_reached: platformsReached, prize: prize, result: result, created_at: new Date().toISOString()
      };
      db.games.push(game);
      await saveDB(db);

      return respond(res, 200, { result: result, prize: prize, new_balance: num(user.balance) });
    }

    // ==================== ADMIN ROUTES ====================
    var admin = getUser(db, req);
    if (url.startsWith('/api/admin') && (!admin || !admin.is_admin)) {
      return respond(res, 401, { error: 'Acesso negado' });
    }

    // DASHBOARD ADMIN (FILTROS DE PERÍODO IMPLEMENTADOS)
    if (url === '/api/admin/dashboard' && method === 'GET') {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const range = q.get('range') || 'today';
      const now = new Date();
      let start = new Date(0);

      if (range === 'today') start = new Date(now.setHours(0,0,0,0));
      else if (range === '7days') start = new Date(now.setDate(now.getDate() - 7));
      else if (range === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);

      const fDeps = db.deposits.filter(d => d.status === 'approved' && new Date(d.created_at) >= start);
      const fWds = db.withdrawals.filter(w => w.status === 'approved' && new Date(w.created_at) >= start);
      const fGames = db.games.filter(g => new Date(g.created_at) >= start);
      
      const totalBet = fGames.reduce((s, g) => s + num(g.bet_amount), 0);
      const totalPrize = fGames.reduce((s, g) => s + num(g.prize), 0);
      
      return respond(res, 200, {
        summary: {
          deposits: fDeps.reduce((s, d) => s + num(d.amount), 0),
          withdrawals: fWds.reduce((s, w) => s + num(w.amount), 0),
          profit: fDeps.reduce((s, d) => s + num(d.amount), 0) - fWds.reduce((s, w) => s + num(w.amount), 0),
          ggr: totalBet - totalPrize,
          users: db.users.length,
          games_count: fGames.length
        },
        chart: fGames.slice(-50).map(g => ({ t: g.created_at, b: g.bet_amount, p: g.prize }))
      });
    }

    // LISTAR USUÁRIOS
    if (url === '/api/admin/users' && method === 'GET') {
      return respond(res, 200, db.users.map(u => {
        const uDeps = db.deposits.filter(d => d.user_id === u.id && d.status === 'approved');
        const uWds = db.withdrawals.filter(w => w.user_id === u.id && w.status === 'approved');
        const uGames = db.games.filter(g => g.user_id === u.id);
        return {
          id: u.id, name: u.name, email: u.email, balance: num(u.balance), 
          is_influencer: !!u.is_influencer, influencer_win_rate: num(u.influencer_win_rate),
          is_admin: !!u.is_admin, is_blocked: !!u.is_blocked, created_at: u.created_at,
          total_deposited: uDeps.reduce((s, d) => s + num(d.amount), 0),
          total_withdrawn: uWds.reduce((s, w) => s + num(w.amount), 0),
          games_count: uGames.length
        };
      }));
    }

    // ATUALIZAR USUÁRIO
    if (url === '/api/admin/user/update' && method === 'POST') {
      var body = await parseBody(req);
      var u = db.users.find(x => x.id === parseInt(body.id));
      if (!u) return respond(res, 404, { error: 'Usuario nao encontrado' });
      if (body.balance !== undefined) u.balance = num(body.balance);
      if (body.is_influencer !== undefined) u.is_influencer = (body.is_influencer === true || body.is_influencer === 'true');
      if (body.is_admin !== undefined) u.is_admin = (body.is_admin === true || body.is_admin === 'true');
      if (body.influencer_win_rate !== undefined) u.influencer_win_rate = num(body.influencer_win_rate);
      if (body.is_blocked !== undefined) u.is_blocked = (body.is_blocked === true || body.is_blocked === 'true');
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    // LISTAR DEPÓSITOS (REVERSE: RECENTES PRIMEIRO)
    if (url === '/api/admin/deposits' && method === 'GET') {
      const deps = db.deposits.map(d => {
        const u = db.users.find(x => x.id === d.user_id);
        return { ...d, user_name: u ? u.name : 'Desconhecido', user_email: u ? u.email : '-' };
      });
      return respond(res, 200, deps.reverse());
    }

    // LISTAR SAQUES (REVERSE: RECENTES PRIMEIRO)
    if (url === '/api/admin/withdrawals' && method === 'GET') {
      const wds = db.withdrawals.map(w => {
        const u = db.users.find(x => x.id === w.user_id);
        return { ...w, user_name: u ? u.name : 'Desconhecido', user_email: u ? u.email : '-' };
      });
      return respond(res, 200, wds.reverse());
    }

    // LISTAR JOGOS (REVERSE: RECENTES PRIMEIRO)
    if (url === '/api/admin/games' && method === 'GET') {
      const games = db.games.map(g => {
        const u = db.users.find(x => x.id === g.user_id);
        return { ...g, user_name: u ? u.name : 'Desconhecido', user_email: u ? u.email : '-' };
      });
      return respond(res, 200, games.reverse());
    }

    // AFILIADOS / INFLUENCIADORES
    if (url === '/api/admin/affiliates' && method === 'GET') {
      const influencers = db.users.filter(u => u.is_influencer || u.id === 1);
      const host = req.headers.host || 'helix-cash.com';
      const affData = influencers.map(i => {
        const refs = db.users.filter(u => u.referred_by === i.referral_code);
        let totalDep = 0;
        let depositantes = 0;
        refs.forEach(r => {
          const userDeps = db.deposits.filter(d => d.user_id === r.id && d.status === 'approved');
          if (userDeps.length > 0) depositantes++;
          totalDep += userDeps.reduce((s, d) => s + num(d.amount), 0);
        });
        return {
          id: i.id, name: i.name, email: i.email, code: i.referral_code,
          count_total: refs.length,
          count_depositors: depositantes,
          total_deposited: totalDep,
          link: `https://${host}/#cadastro?ref=${i.referral_code}`
        };
      });
      return respond(res, 200, affData);
    }

    // CONFIGURAÇÕES
    if (url === '/api/admin/settings' && method === 'GET') return respond(res, 200, db.settings || {});
    if (url === '/api/admin/settings' && method === 'POST') {
      db.settings = { ...db.settings, ...(await parseBody(req)) };
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    return respond(res, 404, { error: 'Rota nao encontrada' });
  } catch (err) {
    console.error('API Error:', err);
    return respond(res, 500, { error: 'Erro interno no servidor: ' + err.message });
  }
};
