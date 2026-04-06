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

    // ==================== DEPOSIT (CONECTADO AO PHP NA HOSTINGER) ====================
    if (url === '/api/deposit' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      
      try {
        // Chamada para o seu script PHP na Hostinger
        var phpRes = await fetch('https://kitbrinde.online/gerar_deposito.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: body.amount,
            cpf: body.cpf,
            name: user.name,
            email: user.email
          })
        });

        var dataFromPhp = await phpRes.json();

        if (!phpRes.ok) {
          return respond(res, 400, { error: dataFromPhp.error || 'Erro ao gerar PIX via PHP' });
        }

        // Criamos o registro no banco local para controle
        var dep = {
          id: db.next_id.deposits++, 
          user_id: user.id, 
          amount: num(body.amount),
          method: 'pix', 
          status: 'pending', 
          pix_code: dataFromPhp.pix_code,
          transaction_id: dataFromPhp.transaction_id, 
          qr_code_image: dataFromPhp.qr_code_image,
          created_at: new Date().toISOString(), 
          updated_at: new Date().toISOString()
        };

        db.deposits.push(dep);
        await saveDB(db);

        // Retornamos os dados para o app.js
        return respond(res, 200, {
          success: true,
          pix_code: dep.pix_code,
          qr_code_image: dep.qr_code_image,
          transaction_id: dep.transaction_id,
          deposit_id: dep.id,
          deposit: dep
        });

      } catch (e) {
        console.error('PHP Bridge Error:', e.message);
        return respond(res, 500, { error: 'Erro de conexao com o servidor de pagamentos (PHP).' });
      }
    }

    // ==================== DEBUG: Test PenguimPay raw response ====================
    if (url === '/api/debug/pix-test' && method === 'GET') {
      try {
        var ppRes = await fetch('https://api.penguimpay.com/api/external/pix/deposit', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + PENGUIMPAY_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1.00, client: { name: 'Debug Test', document: '12345678900', email: 'debug@test.com' } })
        });
        var rawText = await ppRes.text();
        return respond(res, 200, { status: ppRes.status, raw: rawText, parsed: (function(){ try { return JSON.parse(rawText); } catch(e) { return null; } })() });
      } catch(e) { return respond(res, 500, { error: e.message }); }
    }

    // ==================== PENGUIMPAY WEBHOOK ====================
    if (url === '/api/webhook/penguimpay' && method === 'POST') {
      var body = await parseBody(req);
      console.log('PenguimPay Webhook Recebido:', JSON.stringify(body));

      if (body.event === 'PAYMENT' && body.data) {
        var txId = body.data.transactionId || body.data.externalId || '';
        var status = (body.data.status || '').toUpperCase();

        if (status === 'PAID_OUT' || status === 'APPROVED' || status === 'COMPLETED') {
          var dep = db.deposits.find(d => d.transaction_id === txId && d.status === 'pending');
          
          if (dep) {
            dep.status = 'approved';
            dep.updated_at = new Date().toISOString();

            var depositUser = db.users.find(u => u.id === dep.user_id);
            if (depositUser) {
              depositUser.balance = num(depositUser.balance) + num(dep.amount);
              depositUser.total_deposited = num(depositUser.total_deposited) + num(dep.amount);
            }
            await saveDB(db);
          }
        }
      }
      return respond(res, 200, { received: true });
    }

    // ==================== CHECK DEPOSIT STATUS ====================
    if (url === '/api/deposit/status' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var depId = body.deposit_id;

      var dep = db.deposits.find(function(d) { return d.id === depId && d.user_id === user.id; });
      if (!dep) return respond(res, 404, { error: 'Deposito nao encontrado' });

      if (dep.status === 'pending' && dep.transaction_id && PENGUIMPAY_KEY) {
        try {
          var checkRes = await fetch('https://api.penguimpay.com/api/external/pix/deposit/' + dep.transaction_id, {
            headers: { 'Authorization': 'Bearer ' + PENGUIMPAY_KEY }
          });
          var checkData = await checkRes.json();
          var txStatus = (checkData.status || '').toUpperCase();

          if (txStatus === 'PAID_OUT' || txStatus === 'APPROVED' || txStatus === 'COMPLETED') {
            dep.status = 'approved';
            dep.updated_at = new Date().toISOString();
            user.balance = num(user.balance) + num(dep.amount);
            user.total_deposited = num(user.total_deposited) + num(dep.amount);
            await saveDB(db);
          } else if (txStatus === 'EXPIRED' || txStatus === 'FAILED') {
            dep.status = 'rejected';
            dep.updated_at = new Date().toISOString();
            await saveDB(db);
          }
        } catch (e) { console.error('PenguimPay status check error:', e.message); }
      }

      return respond(res, 200, {
        status: dep.status,
        amount: num(dep.amount),
        new_balance: num(user.balance)
      });
    }

    // ==================== WITHDRAW (CLIENTE SOLICITA) ====================
    if (url === '/api/withdraw' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var amount = num(body.amount);
      var pixKey = (body.pix_key || '').trim();
      var pixType = (body.pix_type || 'cpf').toLowerCase();
      var minWd = num(db.settings.min_withdrawal) || 20;

      if (!pixKey) return respond(res, 400, { error: 'Chave PIX obrigatoria' });
      if (!amount || amount < minWd) return respond(res, 400, { error: 'Saque minimo: R$' + minWd });
      if (num(user.balance) < amount) return respond(res, 400, { error: 'Saldo insuficiente' });

      user.balance = num(user.balance) - amount;
      var wd = {
        id: db.next_id.withdrawals++, user_id: user.id, amount: amount,
        pix_key: pixKey, pix_type: pixType, status: 'pending', transaction_id: '',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      db.withdrawals.push(wd);
      await saveDB(db);

      return respond(res, 200, { success: true, message: 'Saque solicitado! Aguardando o Administrador efetuar o envio.' });
    }

    // ==================== GAMES API ====================
    if (url === '/api/game/config' && method === 'GET') {
      return respond(res, 200, db.settings);
    }

    if (url === '/api/game/start' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var betAmount = num(body.bet_amount);

      if (!betAmount || betAmount <= 0) return respond(res, 400, { error: 'Valor de aposta invalido' });
      if (betAmount > num(user.balance)) return respond(res, 400, { error: 'Saldo insuficiente' });

      user.balance = num(user.balance) - betAmount;

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

      var cashedOut = !!body.cashed_out;
      var maxMul = num(db.settings.max_multiplier) || 7;
      var multiplier = Math.min(1 + (platformsReached * 0.5), maxMul);

      var clientPrize = 0;
      for (var pp = 0; pp < platformsReached; pp++) clientPrize += 0.15 + (pp * 0.05);
      clientPrize = Math.round(betAmount * clientPrize * 100) / 100;

      var houseEdge = num(db.settings.house_edge) || 15;
      if (user.is_influencer && num(user.influencer_win_rate) > 0) {
        houseEdge = 100 - num(user.influencer_win_rate);
      }

      var isWin = (Math.random() * 100) >= houseEdge;
      var prize = 0;
      var result = 'loss';

      if (cashedOut && platformsReached > 0) {
        if (isWin) {
          prize = clientPrize;
          result = 'win';
          user.balance = num(user.balance) + prize;
        } else {
          prize = 0;
          result = 'loss';
        }
      }

      user.total_games = (user.total_games || 0) + 1;

      var game = {
        id: db.next_id.games++, user_id: user.id,
        bet_amount: betAmount, multiplier: multiplier,
        platforms_reached: platformsReached, prize: prize, result: result,
        created_at: new Date().toISOString()
      };
      db.games.push(game);
      await saveDB(db);

      return respond(res, 200, {
        result: result, prize: prize, new_balance: num(user.balance),
        balance: num(user.balance), platforms_reached: platformsReached,
        multiplier: multiplier, bet_amount: betAmount
      });
    }

    // ==================== LISTS ====================
    if (url === '/api/deposits' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.deposits.filter(d => d.user_id === user.id).reverse());
    }

    if (url === '/api/withdrawals' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.withdrawals.filter(w => w.user_id === user.id).reverse());
    }
    
    if ((url === '/api/referral' || url === '/api/referrals') && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var earnings = db.referral_earnings.filter(e => e.user_id === user.id);
      var referred = db.users.filter(u => u.referred_by === user.referral_code);
      var totalEarned = earnings.reduce((s, e) => s + num(e.amount), 0);
      return respond(res, 200, {
        code: user.referral_code, total_earned: totalEarned, referred_count: referred.length,
        referrals: referred.map(r => {
          var earn = earnings.find(e => e.from_user_id === r.id);
          return { name: r.name, created_at: r.created_at, amount: earn ? num(earn.amount) : 0 };
        })
      });
    }

    // ==================== ADMIN PANEL ROUTES ====================
    var isAdminUser = (req) => { var u = getUser(db, req); return u && u.is_admin ? u : null; };

    if (url === '/api/admin/dashboard' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var users = db.users.filter(u => !u.is_admin);
      var totalDep = 0, totalWd = 0, totalBets = 0, totalPrizes = 0;
      db.deposits.forEach(d => { if(d.status==='approved') totalDep += num(d.amount); });
      db.withdrawals.forEach(w => { if(w.status==='approved') totalWd += num(w.amount); });
      db.games.forEach(g => { totalBets += num(g.bet_amount); totalPrizes += num(g.prize); });
      
      return respond(res, 200, {
        users: users.length, influencers: users.filter(u => u.is_influencer).length,
        deposits: { total: totalDep }, withdrawals: { total: totalWd },
        games: { count: db.games.length, total_bets: totalBets, total_prizes: totalPrizes },
        profit: totalDep - totalWd, game_profit: totalBets - totalPrizes,
        pending: {
          deposits: db.deposits.filter(d=>d.status==='pending').length,
          withdrawals: db.withdrawals.filter(w=>w.status==='pending').length
        },
        today: {
          deposits: 0, withdrawals: 0, new_users: 0, games: 0 
        }
      });
    }

    if (url === '/api/admin/users' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.users.filter(u => !u.is_admin));
    }
    
    var addBalMatch = url.match(/^\/api\/admin\/user\/(\d+)\/add-balance$/);
    if (addBalMatch && method === 'POST') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var user = db.users.find(u => u.id === parseInt(addBalMatch[1]));
      if (!user) return respond(res, 404, { error: 'Usuario nao encontrado' });
      var body = await parseBody(req);
      user.balance = num(user.balance) + num(body.amount);
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    var infMatch = url.match(/^\/api\/admin\/user\/(\d+)\/influencer$/);
    if (infMatch && method === 'POST') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var user = db.users.find(u => u.id === parseInt(infMatch[1]));
      if (!user) return respond(res, 404, { error: 'Usuario nao encontrado' });
      var body = await parseBody(req);
      user.is_influencer = !!body.is_influencer;
      user.influencer_win_rate = num(body.influencer_win_rate) || 0;
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    if (url === '/api/admin/deposits' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.deposits.slice().reverse().map(d => {
        var u = db.users.find(u => u.id === d.user_id);
        return { ...d, user_name: u ? u.name : 'N/A', user_email: u ? u.email : 'N/A' };
      }));
    }

    var depMatch = url.match(/^\/api\/admin\/deposit\/(\d+)\/(approve|reject)$/);
    if (depMatch && method === 'POST') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var dep = db.deposits.find(d => d.id === parseInt(depMatch[1]));
      if (!dep) return respond(res, 404, { error: 'Nao encontrado' });
      
      dep.status = depMatch[2] === 'approve' ? 'approved' : 'rejected';
      dep.updated_at = new Date().toISOString();

      if (dep.status === 'approved') {
        var user = db.users.find(u => u.id === dep.user_id);
        if (user) {
          user.balance = num(user.balance) + num(dep.amount);
          user.total_deposited = num(user.total_deposited) + num(dep.amount);
        }
      }
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    if (url === '/api/admin/withdrawals' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.withdrawals.slice().reverse().map(w => {
        var u = db.users.find(u => u.id === w.user_id);
        return { ...w, user_name: u ? u.name : 'N/A', user_email: u ? u.email : 'N/A' };
      }));
    }

    var wdMatch = url.match(/^\/api\/admin\/withdrawal\/(\d+)\/(approve|reject)$/);
    if (wdMatch && method === 'POST') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var wd = db.withdrawals.find(w => w.id === parseInt(wdMatch[1]));
      if (!wd) return respond(res, 404, { error: 'Saque nao encontrado' });
      if (wd.status !== 'pending') return respond(res, 400, { error: 'Saque ja processado' });

      var action = wdMatch[2];

      if (action === 'approve') {
        if (PENGUIMPAY_KEY) {
          try {
            var ppRes = await fetch('https://api.penguimpay.com/api/external/withdraw/pix', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + PENGUIMPAY_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                amount: num(wd.amount),
                pix_key: wd.pix_key,
                pix_key_type: wd.pix_key_type.toUpperCase() 
              })
            });
            var rawText = await ppRes.text();
            var ppData = {};
            try { ppData = JSON.parse(rawText); } catch(e) {}

            if (!ppRes.ok) {
              return respond(res, 400, { error: 'Recusado pela Pagadora: ' + (ppData.message || ppData.error || 'Saldo ou chave invalida.') });
            }
            wd.transaction_id = ppData.transactionId || ppData.id || '';
          } catch (e) {
            console.error('PenguimPay Out Error:', e.message);
            return respond(res, 500, { error: 'Erro de conexao com gateway para efetuar o PIX.' });
          }
        }
        
        wd.status = 'approved';
        var user = db.users.find(u => u.id === wd.user_id);
        if (user) user.total_withdrawn = num(user.total_withdrawn) + num(wd.amount);

      } else if (action === 'reject') {
        wd.status = 'rejected';
        var user = db.users.find(u => u.id === wd.user_id);
        if (user) user.balance = num(user.balance) + num(wd.amount); 
      }

      wd.updated_at = new Date().toISOString();
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    if (url === '/api/admin/games' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.games.slice().reverse().map(g => {
        var u = db.users.find(u => u.id === g.user_id);
        return { ...g, user_name: u ? u.name : 'N/A' };
      }));
    }

    if (url === '/api/admin/settings' && method === 'GET') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.settings);
    }

    if (url === '/api/admin/settings' && method === 'POST') {
      if (!isAdminUser(req)) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      Object.keys(body).forEach(k => { db.settings[k] = body[k]; });
      await saveDB(db);
      return respond(res, 200, { success: true });
    }

    return respond(res, 404, { error: 'Rota nao encontrada: ' + url });

  } catch (err) {
    console.error('API Error:', err.message, err.stack);
    return respond(res, 500, { error: 'Erro interno: ' + err.message });
  }
};
