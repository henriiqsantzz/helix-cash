const crypto = require('crypto');
const fs = require('fs');

// ===================== CONFIG =====================
const JWT_SECRET = process.env.JWT_SECRET || 'helix-cash-secret-2024';
const DB_FILE = '/tmp/helix-db.json';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const PENGUIMPAY_KEY = process.env.PENGUIMPAY_KEY || 'pk_c31cb3b5ca7dbbf11e75f30ba70ebf470c31446488264380e40f194b185a6feb';

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

// ===================== DATABASE (DUAL: /tmp + Supabase) =====================
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
    settings: {
      min_deposit: '10', min_withdrawal: '20', max_multiplier: '7',
      referral_bonus: '5', house_edge: '15', influencer_house_edge: '5',
      site_name: 'Helix Cash'
    },
    next_id: { users: 2, deposits: 1, withdrawals: 1, games: 1, pending_games: 1, referral_earnings: 1 }
  };
}

async function loadDB() {
  if (USE_SUPABASE) {
    try {
      var rows = await supaFetch('app_state?select=data&id=eq.1');
      if (rows && rows.length > 0 && rows[0].data) {
        var data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        if (!data.pending_games) data.pending_games = [];
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

      if (referralCode) {
        var referrer = db.users.find(function (u) { return u.referral_code === referralCode; });
        if (referrer) {
          var bonus = num(db.settings.referral_bonus) || 5;
          referrer.bonus_balance = num(referrer.bonus_balance) + bonus;
          db.referral_earnings.push({
            id: db.next_id.referral_earnings++, user_id: referrer.id,
            from_user_id: newUser.id, amount: bonus, created_at: new Date().toISOString()
          });
        }
      }

      await saveDB(db);
      var token = createToken(newUser.id);
      return respond(res, 200, {
        token: token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, balance: 0, bonus_balance: 0, referral_code: code, is_admin: false }
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
        id: user.id, name: user.name, email: user.email,
        balance: num(user.balance), bonus_balance: num(user.bonus_balance),
        referral_code: user.referral_code, is_admin: user.is_admin,
        referrals: db.users.filter(function (u) { return u.referred_by === user.referral_code; }).length
      });
    }

    // ==================== USER: BALANCE ====================
    if (url === '/api/user/balance' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, { balance: num(user.balance), bonus_balance: num(user.bonus_balance) });
    }

    // ==================== DEPOSIT (PenguimPay PIX IN) ====================
    if (url === '/api/deposit' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var amount = num(body.amount);
      var minDep = num(db.settings.min_deposit) || 10;
      var cpf = (body.cpf || '').trim();
      var cpfRaw = cpf.replace(/\D/g, '');

      if (!amount || amount < minDep) return respond(res, 400, { error: 'Deposito minimo: R$' + minDep });
      if (!cpfRaw) return respond(res, 400, { error: 'CPF obrigatorio para gerar PIX' });

      var dep = {
        id: db.next_id.deposits++, user_id: user.id, amount: amount,
        method: 'pix', status: 'pending', pix_key: '', pix_code: '',
        transaction_id: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };

      if (PENGUIMPAY_KEY) {
        try {
          var ppRes = await fetch('https://api.penguimpay.com/api/external/pix/deposit', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + PENGUIMPAY_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount, client: { name: user.name || 'User', document: cpfRaw, email: user.email || 'user@email.com' } })
          });
          var rawText = await ppRes.text();
          var ppData = {}; try { ppData = JSON.parse(rawText); } catch(e) {}
          if (!ppRes.ok) return respond(res, 400, { error: 'Erro PenguimPay: ' + (ppData.message || ppData.error || 'Dados invalidos') });

          // MAPEMAENTO CORRETO PARA O FRONTEND NÃO DAR "INDISPONÍVEL"
          dep.transaction_id = ppData.transactionId || ppData.id || '';
          dep.pix_code = ppData.pixCopiaECola || ppData.qrCode || ppData.pix_key || '';
          dep.qr_code_image = ppData.qrCodeImage || ppData.qrCodeBase64 || '';
        } catch (e) {
          console.error('PenguimPay error:', e.message);
          return respond(res, 500, { error: 'Erro de conexao com gateway.' });
        }
      } else {
        dep.pix_code = 'HELIX_FAKE_' + Date.now();
      }

      db.deposits.push(dep);
      await saveDB(db);
      return respond(res, 200, { success: true, pix_code: dep.pix_code, qr_code_image: dep.qr_code_image, transaction_id: dep.transaction_id, deposit: dep });
    }

    // ==================== PENGUIMPAY WEBHOOK ====================
    if (url === '/api/webhook/penguimpay' && method === 'POST') {
      var body = await parseBody(req);
      if (body.event === 'PAYMENT' && body.data) {
        var txId = body.data.transactionId || body.data.externalId || '';
        var status = (body.data.status || '').toUpperCase();
        if (status === 'PAID_OUT' || status === 'APPROVED' || status === 'COMPLETED') {
          var dep = db.deposits.find(d => d.transaction_id === txId && d.status === 'pending');
          if (dep) {
            dep.status = 'approved'; dep.updated_at = new Date().toISOString();
            var u = db.users.find(u => u.id === dep.user_id);
            if (u) { u.balance = num(u.balance) + num(dep.amount); u.total_deposited = num(u.total_deposited) + num(dep.amount); }
            await saveDB(db);
          }
        }
      }
      return respond(res, 200, { received: true });
    }

    // ==================== CHECK DEPOSIT STATUS ====================
    if (url === '/api/deposit/status' && method === 'POST') {
      var user = getUser(db, req); if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var dep = db.deposits.find(d => d.id === body.deposit_id && d.user_id === user.id);
      if (!dep) return respond(res, 404, { error: 'Nao encontrado' });

      if (dep.status === 'pending' && dep.transaction_id && PENGUIMPAY_KEY) {
        try {
          var checkRes = await fetch('https://api.penguimpay.com/api/external/pix/deposit/' + dep.transaction_id, { headers: { 'Authorization': 'Bearer ' + PENGUIMPAY_KEY } });
          var checkData = await checkRes.json();
          var txStatus = (checkData.status || '').toUpperCase();
          if (txStatus === 'PAID_OUT' || txStatus === 'APPROVED' || txStatus === 'COMPLETED') {
            dep.status = 'approved'; dep.updated_at = new Date().toISOString();
            user.balance = num(user.balance) + num(dep.amount); user.total_deposited = num(user.total_deposited) + num(dep.amount);
            await saveDB(db);
          }
        } catch (e) {}
      }
      return respond(res, 200, { status: dep.status, new_balance: num(user.balance) });
    }

    // ==================== WITHDRAW (MANUAL) ====================
    if (url === '/api/withdraw' && method === 'POST') {
      var user = getUser(db, req); if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var amount = num(body.amount);
      if (amount < (num(db.settings.min_withdrawal) || 20)) return respond(res, 400, { error: 'Saque minimo invalido' });
      if (num(user.balance) < amount) return respond(res, 400, { error: 'Saldo insuficiente' });
      user.balance = num(user.balance) - amount;
      db.withdrawals.push({ id: db.next_id.withdrawals++, user_id: user.id, amount: amount, pix_key: body.pix_key, pix_type: body.pix_type, status: 'pending', created_at: new Date().toISOString() });
      await saveDB(db);
      return respond(res, 200, { success: true, message: 'Solicitado com sucesso' });
    }

    // ==================== GAME LOGIC ====================
    if (url === '/api/game/config' && method === 'GET') return respond(res, 200, db.settings);
    if (url === '/api/game/start' && method === 'POST') {
      var user = getUser(db, req); if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var bet = num(body.bet_amount);
      if (bet <= 0 || bet > num(user.balance)) return respond(res, 400, { error: 'Aposta invalida' });
      user.balance = num(user.balance) - bet;
      var pg = { id: db.next_id.pending_games++, user_id: user.id, bet_amount: bet, created_at: new Date().toISOString() };
      db.pending_games.push(pg); await saveDB(db);
      return respond(res, 200, { game_id: pg.id, new_balance: user.balance });
    }
    if (url === '/api/game/finish' && method === 'POST') {
      var user = getUser(db, req); if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var pgIdx = db.pending_games.findIndex(p => p.id === body.game_id && p.user_id === user.id);
      if (pgIdx < 0) return respond(res, 400, { error: 'Jogo expirado' });
      var pg = db.pending_games.splice(pgIdx, 1)[0];
      var platforms = num(body.platforms_reached);
      var multiplier = Math.min(1 + (platforms * 0.5), num(db.settings.max_multiplier) || 7);
      var prize = (body.cashed_out && (Math.random() * 100 >= (num(db.settings.house_edge) || 15))) ? Math.round(pg.bet_amount * multiplier * 100)/100 : 0;
      user.balance = num(user.balance) + prize;
      db.games.push({ id: db.next_id.games++, user_id: user.id, bet_amount: pg.bet_amount, prize: prize, result: prize > 0 ? 'win' : 'loss', created_at: new Date().toISOString() });
      await saveDB(db);
      return respond(res, 200, { prize: prize, new_balance: user.balance });
    }

    // ==================== LISTS (USER) ====================
    if (url === '/api/deposits' && method === 'GET') { var u = getUser(db, req); return respond(res, 200, db.deposits.filter(d => d.user_id === u.id).reverse()); }
    if (url === '/api/withdrawals' && method === 'GET') { var u = getUser(db, req); return respond(res, 200, db.withdrawals.filter(w => w.user_id === u.id).reverse()); }
    if (url === '/api/referrals' && method === 'GET') {
      var u = getUser(db, req);
      var refs = db.users.filter(usr => usr.referred_by === u.referral_code);
      var earns = db.referral_earnings.filter(e => e.user_id === u.id);
      return respond(res, 200, { total_earned: earns.reduce((s, e) => s + num(e.amount), 0), referrals: refs });
    }

    // ==================== ADMIN ROUTES ====================
    var admin = isAdminUser(req);
    if (admin) {
      if (url === '/api/admin/dashboard' && method === 'GET') {
        var users = db.users.filter(u => !u.is_admin);
        var approvedDep = db.deposits.filter(d => d.status === 'approved').reduce((s, d) => s + num(d.amount), 0);
        var approvedWd = db.withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + num(w.amount), 0);
        return respond(res, 200, { users: users.length, deposits: { total: approvedDep }, withdrawals: { total: approvedWd }, profit: approvedDep - approvedWd });
      }
      if (url === '/api/admin/users' && method === 'GET') return respond(res, 200, db.users.filter(u => !u.is_admin));
      if (url === '/api/admin/deposits' && method === 'GET') return respond(res, 200, db.deposits.slice().reverse());
      if (url === '/api/admin/withdrawals' && method === 'GET') return respond(res, 200, db.withdrawals.slice().reverse());
      
      // ADMIN ACTIONS
      var depMatch = url.match(/^\/api\/admin\/deposit\/(\d+)\/(approve|reject)$/);
      if (depMatch) {
        var d = db.deposits.find(x => x.id === parseInt(depMatch[1]));
        if (d && d.status === 'pending') {
          d.status = depMatch[2] === 'approve' ? 'approved' : 'rejected';
          if (d.status === 'approved') { var u = db.users.find(x => x.id === d.user_id); u.balance += d.amount; }
          await saveDB(db);
        }
        return respond(res, 200, { success: true });
      }
      
      var wdMatch = url.match(/^\/api\/admin\/withdrawal\/(\d+)\/(approve|reject)$/);
      if (wdMatch) {
        var w = db.withdrawals.find(x => x.id === parseInt(wdMatch[1]));
        if (w && w.status === 'pending') {
          w.status = wdMatch[2] === 'approve' ? 'approved' : 'rejected';
          if (w.status === 'reject') { var u = db.users.find(x => x.id === w.user_id); u.balance += w.amount; }
          await saveDB(db);
        }
        return respond(res, 200, { success: true });
      }

      if (url === '/api/admin/settings' && method === 'POST') {
        var body = await parseBody(req); Object.keys(body).forEach(k => { db.settings[k] = body[k]; });
        await saveDB(db); return respond(res, 200, { success: true });
      }
      if (url === '/api/admin/settings' && method === 'GET') return respond(res, 200, db.settings);
    }

    return respond(res, 404, { error: 'Rota nao encontrada' });
  } catch (err) {
    console.error('API Error:', err);
    return respond(res, 500, { error: 'Erro interno' });
  }
};
