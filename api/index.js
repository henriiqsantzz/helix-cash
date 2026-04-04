const crypto = require('crypto');

// ===================== CONFIG =====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Use a service_role key
const JWT_SECRET = process.env.JWT_SECRET || 'helix-cash-secret-2024';

// ===================== SUPABASE REST CLIENT =====================
async function supabaseRequest(path, method, body, extraHeaders) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const opts = {
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
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text);
  return text ? JSON.parse(text) : null;
}

// DB Helper
const db = {
  async select(table, filters, order) {
    let q = 'select=*';
    if (filters) q += '&' + filters;
    q += '&order=' + (order || 'id.desc');
    return await supabaseRequest(table + '?' + q);
  },

  async selectOne(table, filters) {
    let q = 'select=*&' + filters + '&limit=1';
    const rows = await supabaseRequest(table + '?' + q);
    return (rows && rows.length > 0) ? rows[0] : null;
  },

  async selectJoin(table, joinTable, joinFields, filters, order) {
    let q = 'select=*,' + joinTable + '(' + joinFields + ')';
    if (filters) q += '&' + filters;
    q += '&order=' + (order || 'created_at.desc');
    return await supabaseRequest(table + '?' + q);
  },

  async insert(table, data) {
    return await supabaseRequest(table, 'POST', data, {
      'Prefer': 'return=representation'
    });
  },

  async update(table, filters, data) {
    return await supabaseRequest(table + '?' + filters, 'PATCH', data, {
      'Prefer': 'return=representation'
    });
  },

  async getSettings() {
    const rows = await supabaseRequest('settings?select=*');
    const obj = {};
    if (rows) rows.forEach(function(r) { obj[r.key] = r.value; });
    return obj;
  },

  async saveSettings(settings) {
    const data = Object.entries(settings).map(function(e) {
      return { key: e[0], value: String(e[1]) };
    });
    return await supabaseRequest('settings', 'POST', data, {
      'Prefer': 'return=representation,resolution=merge-duplicates'
    });
  }
};

// ===================== AUTH HELPERS =====================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  const salt = parts[0];
  const hash = parts[1];
  const test = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === test;
}

function createToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: userId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET)
    .update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    const sig = crypto.createHmac('sha256', JWT_SECRET)
      .update(parts[0] + '.' + parts[1]).digest('base64url');
    if (parts[2] !== sig) return null;
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}

// ===================== BODY PARSER =====================
function parseBody(req) {
  if (req.body) return Promise.resolve(req.body);
  return new Promise(function(resolve) {
    let data = '';
    req.on('data', function(chunk) { data += chunk; });
    req.on('end', function() {
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
  });
}

// ===================== RESPONSE HELPER =====================
function respond(res, code, data) {
  if (typeof res.status === 'function') {
    return res.status(code).json(data);
  }
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ===================== AUTH MIDDLEWARE =====================
async function authenticate(req) {
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return await db.selectOne('users', 'id=eq.' + decoded.id);
}

// ===================== INIT (create admin if needed) =====================
let _initDone = false;
async function ensureInit() {
  if (_initDone) return;
  try {
    const admins = await db.select('users', 'is_admin=eq.true', 'id.asc');
    if (!admins || admins.length === 0) {
      await db.insert('users', {
        name: 'Admin',
        email: 'admin@helixcash.com',
        password: hashPassword('admin123'),
        referral_code: 'ADMIN001',
        is_admin: true,
        is_blocked: false,
        is_influencer: false,
        balance: 0,
        bonus_balance: 0,
        influencer_win_rate: 0,
        total_deposited: 0,
        total_withdrawn: 0,
        total_games: 0
      });
    }
    _initDone = true;
  } catch (e) {
    console.error('Init error:', e.message);
  }
}

// ===================== NUM HELPER =====================
function num(v) { return parseFloat(v) || 0; }

// ===================== MAIN HANDLER =====================
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return respond(res, 200, {});

  // Check config
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return respond(res, 500, { error: 'Banco de dados nao configurado. Configure SUPABASE_URL e SUPABASE_KEY.' });
  }

  await ensureInit();

  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    // ==================== AUTH ROUTES ====================

    // REGISTER
    if (url === '/api/auth/register' && method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const phone = (body.phone || '').trim();
      const password = body.password || '';
      const referral = (body.referral_code || '').trim();

      if (!name || !email || !password) {
        return respond(res, 400, { error: 'Nome, email e senha sao obrigatorios' });
      }
      if (password.length < 4) {
        return respond(res, 400, { error: 'Senha deve ter pelo menos 4 caracteres' });
      }

      const existing = await db.selectOne('users', 'email=eq.' + encodeURIComponent(email));
      if (existing) return respond(res, 400, { error: 'Email ja cadastrado' });

      const code = 'HC' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const userData = {
        name: name, email: email, phone: phone || null,
        password: hashPassword(password),
        balance: 0, bonus_balance: 0,
        referral_code: code, referred_by: referral || null,
        is_admin: false, is_blocked: false, is_influencer: false,
        influencer_win_rate: 0, total_deposited: 0, total_withdrawn: 0, total_games: 0
      };

      const inserted = await db.insert('users', userData);
      const newUser = inserted[0];

      if (referral) {
        const referrer = await db.selectOne('users', 'referral_code=eq.' + encodeURIComponent(referral));
        if (referrer) {
          const settings = await db.getSettings();
          const bonus = num(settings.referral_bonus) || 5;
          await db.update('users', 'id=eq.' + referrer.id, {
            bonus_balance: num(referrer.bonus_balance) + bonus
          });
          await db.insert('referral_earnings', {
            user_id: referrer.id, from_user_id: newUser.id, amount: bonus
          });
        }
      }

      const token = createToken(newUser.id);
      return respond(res, 200, {
        token: token,
        user: {
          id: newUser.id, name: newUser.name, email: newUser.email,
          balance: 0, bonus_balance: 0, referral_code: code, is_admin: false
        }
      });
    }

    // LOGIN
    if (url === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!email || !password) {
        return respond(res, 400, { error: 'Email e senha sao obrigatorios' });
      }

      const user = await db.selectOne('users', 'email=eq.' + encodeURIComponent(email));
      if (!user) return respond(res, 401, { error: 'Email ou senha incorretos' });
      if (!verifyPassword(password, user.password)) {
        return respond(res, 401, { error: 'Email ou senha incorretos' });
      }
      if (user.is_blocked) return respond(res, 403, { error: 'Conta bloqueada' });

      await db.update('users', 'id=eq.' + user.id, { last_login: new Date().toISOString() });

      const token = createToken(user.id);
      return respond(res, 200, {
        token: token,
        user: {
          id: user.id, name: user.name, email: user.email,
          balance: num(user.balance), bonus_balance: num(user.bonus_balance),
          referral_code: user.referral_code, is_admin: user.is_admin
        }
      });
    }

    // ME
    if (url === '/api/auth/me' && method === 'GET') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, {
        id: user.id, name: user.name, email: user.email,
        balance: num(user.balance), bonus_balance: num(user.bonus_balance),
        referral_code: user.referral_code, is_admin: user.is_admin
      });
    }

    // ==================== USER ROUTES ====================

    // BALANCE
    if (url === '/api/user/balance' && method === 'GET') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, { balance: num(user.balance), bonus_balance: num(user.bonus_balance) });
    }

    // DEPOSIT
    if (url === '/api/deposit' && method === 'POST') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      const body = await parseBody(req);
      const amount = num(body.amount);
      const pix_key = (body.pix_key || '').trim();

      const settings = await db.getSettings();
      if (!amount || amount < num(settings.min_deposit)) {
        return respond(res, 400, { error: 'Deposito minimo: R$' + settings.min_deposit });
      }

      const dep = await db.insert('deposits', {
        user_id: user.id, amount: amount, method: 'pix', status: 'pending', pix_key: pix_key
      });
      return respond(res, 200, { success: true, deposit: dep[0] });
    }

    // WITHDRAW
    if (url === '/api/withdraw' && method === 'POST') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      const body = await parseBody(req);
      const amount = num(body.amount);
      const pix_key = (body.pix_key || '').trim();

      if (!pix_key) return respond(res, 400, { error: 'Chave PIX obrigatoria' });

      const settings = await db.getSettings();
      if (!amount || amount < num(settings.min_withdrawal)) {
        return respond(res, 400, { error: 'Saque minimo: R$' + settings.min_withdrawal });
      }
      if (num(user.balance) < amount) {
        return respond(res, 400, { error: 'Saldo insuficiente' });
      }

      await db.update('users', 'id=eq.' + user.id, { balance: num(user.balance) - amount });

      const wd = await db.insert('withdrawals', {
        user_id: user.id, amount: amount, pix_key: pix_key, status: 'pending'
      });
      return respond(res, 200, { success: true, withdrawal: wd[0] });
    }

    // USER DEPOSITS LIST
    if (url === '/api/deposits' && method === 'GET') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      const deposits = await db.select('deposits', 'user_id=eq.' + user.id, 'created_at.desc');
      return respond(res, 200, deposits.map(function(d) {
        return { id: d.id, amount: num(d.amount), method: d.method, status: d.status, pix_key: d.pix_key, created_at: d.created_at };
      }));
    }

    // USER WITHDRAWALS LIST
    if (url === '/api/withdrawals' && method === 'GET') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      const wds = await db.select('withdrawals', 'user_id=eq.' + user.id, 'created_at.desc');
      return respond(res, 200, wds.map(function(w) {
        return { id: w.id, amount: num(w.amount), pix_key: w.pix_key, status: w.status, created_at: w.created_at };
      }));
    }

    // GAME FINISH
    if (url === '/api/game/finish' && method === 'POST') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      const body = await parseBody(req);
      const bet_amount = num(body.bet_amount);
      const multiplier = num(body.multiplier);
      const balance = num(user.balance);

      if (!bet_amount || bet_amount <= 0 || bet_amount > balance) {
        return respond(res, 400, { error: 'Valor de aposta invalido' });
      }

      const settings = await db.getSettings();
      const maxMul = num(settings.max_multiplier) || 7;
      const safeMul = Math.min(multiplier || 1, maxMul);

      var houseEdge = num(settings.house_edge) || 15;
      if (user.is_influencer && num(user.influencer_win_rate) > 0) {
        houseEdge = 100 - num(user.influencer_win_rate);
      }

      const rand = Math.random() * 100;
      const isWin = rand >= houseEdge;

      var prize = 0;
      var newBalance = balance - bet_amount;
      var result = 'loss';

      if (isWin) {
        prize = bet_amount * safeMul;
        newBalance = balance + prize - bet_amount;
        result = 'win';
      }
      newBalance = Math.max(0, newBalance);

      await db.update('users', 'id=eq.' + user.id, {
        balance: newBalance,
        total_games: (user.total_games || 0) + 1
      });

      await db.insert('games', {
        user_id: user.id, bet_amount: bet_amount, multiplier: safeMul, prize: prize, result: result
      });

      return respond(res, 200, { result: result, prize: prize, balance: newBalance });
    }

    // REFERRAL
    if (url === '/api/referral' && method === 'GET') {
      const user = await authenticate(req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });

      const earnings = await db.select('referral_earnings', 'user_id=eq.' + user.id, 'created_at.desc');
      const referred = await db.select('users', 'referred_by=eq.' + encodeURIComponent(user.referral_code), 'id.desc');
      const totalEarned = earnings.reduce(function(s, e) { return s + num(e.amount); }, 0);

      return respond(res, 200, {
        code: user.referral_code, total_earned: totalEarned,
        referred_count: referred.length,
        earnings: earnings.map(function(e) {
          return { id: e.id, amount: num(e.amount), created_at: e.created_at };
        })
      });
    }

    // ==================== ADMIN ROUTES ====================

    // DASHBOARD
    if (url === '/api/admin/dashboard' && method === 'GET') {
      const admin = await authenticate(req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      const results = await Promise.all([
        db.select('users', 'is_admin=eq.false', 'id.desc'),
        db.select('deposits', '', 'id.desc'),
        db.select('withdrawals', '', 'id.desc'),
        db.select('games', '', 'id.desc'),
        db.getSettings()
      ]);

      const users = results[0] || [];
      const deposits = results[1] || [];
      const withdrawals = results[2] || [];
      const games = results[3] || [];
