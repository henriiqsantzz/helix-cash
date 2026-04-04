const crypto = require('crypto');
const fs = require('fs');

// ===================== CONFIG =====================
const JWT_SECRET = process.env.JWT_SECRET || 'helix-cash-secret-2024';
const DB_FILE = '/tmp/helix-db.json';

// ===================== DATABASE (FILE-BASED) =====================
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

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!data.pending_games) data.pending_games = [];
      if (!data.next_id.pending_games) data.next_id.pending_games = 1;
      return data;
    }
  } catch (e) { console.error('DB load error:', e.message); }
  return createDefaultDB();
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('DB save error:', e.message); }
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

// ===================== HELPERS =====================
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return respond(res, 200, {});

  var db = loadDB();
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

      // Referral bonus
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

      saveDB(db);
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
      saveDB(db);

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

    // ==================== AUTH: ME / USER ME ====================
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

    // ==================== DEPOSIT ====================
    if (url === '/api/deposit' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var amount = num(body.amount);
      var minDep = num(db.settings.min_deposit) || 10;

      if (!amount || amount < minDep) return respond(res, 400, { error: 'Deposito minimo: R$' + minDep });

      var pixCode = 'HELIX' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
      var dep = {
        id: db.next_id.deposits++, user_id: user.id, amount: amount,
        method: 'pix', status: 'pending', pix_key: body.pix_key || '',
        pix_code: pixCode, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      db.deposits.push(dep);
      saveDB(db);

      return respond(res, 200, { success: true, pix_code: pixCode, deposit: dep });
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
      if (!amount || amount < minWd) return respond(res, 400, { error: 'Saque minimo: R$' + minWd });
      if (num(user.balance) < amount) return respond(res, 400, { error: 'Saldo insuficiente' });

      user.balance = num(user.balance) - amount;
      var wd = {
        id: db.next_id.withdrawals++, user_id: user.id, amount: amount,
        pix_key: pixKey, pix_type: body.pix_type || 'cpf', status: 'pending',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      db.withdrawals.push(wd);
      saveDB(db);

      return respond(res, 200, { success: true, message: 'Saque de R$' + amount.toFixed(2) + ' solicitado! Aguarde aprovacao.' });
    }

    // ==================== USER DEPOSITS ====================
    if (url === '/api/deposits' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var deps = db.deposits.filter(function (d) { return d.user_id === user.id; }).reverse();
      return respond(res, 200, deps);
    }

    // ==================== USER WITHDRAWALS ====================
    if (url === '/api/withdrawals' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var wds = db.withdrawals.filter(function (w) { return w.user_id === user.id; }).reverse();
      return respond(res, 200, wds);
    }

    // ==================== GAME: START ====================
    if (url === '/api/game/start' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var betAmount = num(body.bet_amount);

      if (!betAmount || betAmount <= 0) return respond(res, 400, { error: 'Valor de aposta invalido' });
      if (betAmount > num(user.balance)) return respond(res, 400, { error: 'Saldo insuficiente' });

      // Deduct bet
      user.balance = num(user.balance) - betAmount;

      // Create pending game
      var pg = {
        id: db.next_id.pending_games++, user_id: user.id,
        bet_amount: betAmount, created_at: new Date().toISOString()
      };
      db.pending_games.push(pg);
      saveDB(db);

      return respond(res, 200, { game_id: pg.id, new_balance: user.balance });
    }

    // ==================== GAME: FINISH ====================
    if (url === '/api/game/finish' && method === 'POST') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);

      var gameId = body.game_id;
      var platformsReached = num(body.platforms_reached) || 0;

      // Find pending game
      var pgIndex = -1;
      var pg = null;
      for (var i = 0; i < db.pending_games.length; i++) {
        if (db.pending_games[i].id === gameId && db.pending_games[i].user_id === user.id) {
          pgIndex = i;
          pg = db.pending_games[i];
          break;
        }
      }

      // If no pending game found, use body data as fallback
      var betAmount = pg ? num(pg.bet_amount) : num(body.bet_amount);
      if (!betAmount || betAmount <= 0) return respond(res, 400, { error: 'Jogo nao encontrado' });

      // Remove from pending
      if (pgIndex >= 0) db.pending_games.splice(pgIndex, 1);

      // Calculate multiplier from platforms
      var maxMul = num(db.settings.max_multiplier) || 7;
      var multiplier = Math.min(1 + (platformsReached * 0.5), maxMul);

      // House edge logic
      var houseEdge = num(db.settings.house_edge) || 15;
      if (user.is_influencer && num(user.influencer_win_rate) > 0) {
        houseEdge = 100 - num(user.influencer_win_rate);
      }

      var rand = Math.random() * 100;
      var isWin = rand >= houseEdge;

      var prize = 0;
      var result = 'loss';
      if (isWin && platformsReached > 0) {
        prize = betAmount * multiplier;
        result = 'win';
        user.balance = num(user.balance) + prize;
      }

      user.total_games = (user.total_games || 0) + 1;

      // Record completed game
      var game = {
        id: db.next_id.games++, user_id: user.id,
        bet_amount: betAmount, multiplier: multiplier,
        platforms_reached: platformsReached,
        prize: prize, result: result,
        created_at: new Date().toISOString()
      };
      db.games.push(game);
      saveDB(db);

      return respond(res, 200, {
        result: result, prize: prize, new_balance: num(user.balance),
        balance: num(user.balance), platforms_reached: platformsReached,
        multiplier: multiplier, bet_amount: betAmount
      });
    }

    // ==================== REFERRALS ====================
    if ((url === '/api/referral' || url === '/api/referrals') && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });

      var earnings = db.referral_earnings.filter(function (e) { return e.user_id === user.id; });
      var referred = db.users.filter(function (u) { return u.referred_by === user.referral_code; });
      var totalEarned = earnings.reduce(function (s, e) { return s + num(e.amount); }, 0);

      return respond(res, 200, {
        code: user.referral_code,
        total_earned: totalEarned,
        referred_count: referred.length,
        referrals: referred.map(function (r) {
          var earn = earnings.find(function (e) { return e.from_user_id === r.id; });
          return { name: r.name, created_at: r.created_at, amount: earn ? num(earn.amount) : 0 };
        }),
        earnings: earnings.map(function (e) { return { id: e.id, amount: num(e.amount), created_at: e.created_at }; })
      });
    }

    // ==================== REFERRAL EARNINGS ====================
    if (url === '/api/referral/earnings' && method === 'GET') {
      var user = getUser(db, req);
      if (!user) return respond(res, 401, { error: 'Nao autorizado' });
      var earnings = db.referral_earnings.filter(function (e) { return e.user_id === user.id; });
      return respond(res, 200, earnings);
    }

    // ==================== ADMIN: DASHBOARD ====================
    if (url === '/api/admin/dashboard' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      var users = db.users.filter(function (u) { return !u.is_admin; });
      var today = new Date().toISOString().split('T')[0];

      var totalDep = 0, depCount = 0;
      db.deposits.forEach(function (d) { if (d.status === 'approved') { totalDep += num(d.amount); depCount++; } });

      var totalWd = 0, wdCount = 0;
      db.withdrawals.forEach(function (w) { if (w.status === 'approved') { totalWd += num(w.amount); wdCount++; } });

      var totalBets = 0, totalPrizes = 0;
      db.games.forEach(function (g) { totalBets += num(g.bet_amount); totalPrizes += num(g.prize); });

      var todayDep = 0, todayWd = 0, todayUsers = 0, todayGames = 0;
      db.deposits.forEach(function (d) { if (d.created_at && d.created_at.startsWith(today) && d.status === 'approved') todayDep += num(d.amount); });
      db.withdrawals.forEach(function (w) { if (w.created_at && w.created_at.startsWith(today) && w.status === 'approved') todayWd += num(w.amount); });
      users.forEach(function (u) { if (u.created_at && u.created_at.startsWith(today)) todayUsers++; });
      db.games.forEach(function (g) { if (g.created_at && g.created_at.startsWith(today)) todayGames++; });

      var pendingDep = 0, pendingWd = 0;
      db.deposits.forEach(function (d) { if (d.status === 'pending') pendingDep++; });
      db.withdrawals.forEach(function (w) { if (w.status === 'pending') pendingWd++; });

      return respond(res, 200, {
        users: users.length,
        influencers: users.filter(function (u) { return u.is_influencer; }).length,
        deposits: { total: totalDep, count: depCount },
        withdrawals: { total: totalWd, count: wdCount },
        games: { count: db.games.length, total_bets: totalBets, total_prizes: totalPrizes },
        profit: totalDep - totalWd,
        game_profit: totalBets - totalPrizes,
        pending: { deposits: pendingDep, withdrawals: pendingWd },
        today: { deposits: todayDep, withdrawals: todayWd, new_users: todayUsers, games: todayGames }
      });
    }

    // ==================== ADMIN: USERS ====================
    if (url === '/api/admin/users' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      var users = db.users.filter(function (u) { return !u.is_admin; });
      return respond(res, 200, users.map(function (u) {
        return {
          id: u.id, name: u.name, email: u.email, phone: u.phone,
          balance: num(u.balance), bonus_balance: num(u.bonus_balance),
          referral_code: u.referral_code, referred_by: u.referred_by,
          is_blocked: u.is_blocked, is_influencer: u.is_influencer,
          influencer_win_rate: num(u.influencer_win_rate),
          total_deposited: num(u.total_deposited), total_withdrawn: num(u.total_withdrawn),
          total_games: u.total_games || 0,
          created_at: u.created_at, last_login: u.last_login
        };
      }));
    }

    // ==================== ADMIN: ADD BALANCE ====================
    var addBalMatch = url.match(/^\/api\/admin\/user\/(\d+)\/add-balance$/);
    if (addBalMatch && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var userId = parseInt(addBalMatch[1]);
      var user = db.users.find(function (u) { return u.id === userId; });
      if (!user) return respond(res, 404, { error: 'Usuario nao encontrado' });

      user.balance = num(user.balance) + num(body.amount);
      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== ADMIN: SET INFLUENCER ====================
    var infMatch = url.match(/^\/api\/admin\/user\/(\d+)\/influencer$/);
    if (infMatch && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      var userId = parseInt(infMatch[1]);
      var user = db.users.find(function (u) { return u.id === userId; });
      if (!user) return respond(res, 404, { error: 'Usuario nao encontrado' });

      user.is_influencer = !!body.is_influencer;
      user.influencer_win_rate = num(body.influencer_win_rate) || 0;
      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== ADMIN: BLOCK/UNBLOCK ====================
    var blockMatch = url.match(/^\/api\/admin\/user\/(\d+)\/block$/);
    if (blockMatch && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });
      var userId = parseInt(blockMatch[1]);
      var user = db.users.find(function (u) { return u.id === userId; });
      if (!user) return respond(res, 404, { error: 'Usuario nao encontrado' });

      user.is_blocked = !user.is_blocked;
      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== ADMIN: DEPOSITS ====================
    if (url === '/api/admin/deposits' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      return respond(res, 200, db.deposits.slice().reverse().map(function (d) {
        var u = db.users.find(function (u) { return u.id === d.user_id; });
        return {
          id: d.id, user_id: d.user_id, amount: num(d.amount),
          method: d.method, status: d.status, pix_key: d.pix_key,
          created_at: d.created_at, updated_at: d.updated_at,
          user_name: u ? u.name : 'N/A', user_email: u ? u.email : 'N/A'
        };
      }));
    }

    // ==================== ADMIN: APPROVE/REJECT DEPOSIT ====================
    var depMatch = url.match(/^\/api\/admin\/deposit\/(\d+)\/(approve|reject)$/);
    if (depMatch && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      var depId = parseInt(depMatch[1]);
      var action = depMatch[2];
      var dep = db.deposits.find(function (d) { return d.id === depId; });
      if (!dep) return respond(res, 404, { error: 'Deposito nao encontrado' });
      if (dep.status !== 'pending') return respond(res, 400, { error: 'Deposito ja processado' });

      dep.status = action === 'approve' ? 'approved' : 'rejected';
      dep.updated_at = new Date().toISOString();

      if (action === 'approve') {
        var user = db.users.find(function (u) { return u.id === dep.user_id; });
        if (user) {
          user.balance = num(user.balance) + num(dep.amount);
          user.total_deposited = num(user.total_deposited) + num(dep.amount);
        }
      }

      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== ADMIN: WITHDRAWALS ====================
    if (url === '/api/admin/withdrawals' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      return respond(res, 200, db.withdrawals.slice().reverse().map(function (w) {
        var u = db.users.find(function (u) { return u.id === w.user_id; });
        return {
          id: w.id, user_id: w.user_id, amount: num(w.amount),
          pix_key: w.pix_key, status: w.status,
          created_at: w.created_at, updated_at: w.updated_at,
          user_name: u ? u.name : 'N/A', user_email: u ? u.email : 'N/A'
        };
      }));
    }

    // ==================== ADMIN: APPROVE/REJECT WITHDRAWAL ====================
    var wdMatch = url.match(/^\/api\/admin\/withdrawal\/(\d+)\/(approve|reject)$/);
    if (wdMatch && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      var wdId = parseInt(wdMatch[1]);
      var action = wdMatch[2];
      var wd = db.withdrawals.find(function (w) { return w.id === wdId; });
      if (!wd) return respond(res, 404, { error: 'Saque nao encontrado' });
      if (wd.status !== 'pending') return respond(res, 400, { error: 'Saque ja processado' });

      wd.status = action === 'approve' ? 'approved' : 'rejected';
      wd.updated_at = new Date().toISOString();

      var user = db.users.find(function (u) { return u.id === wd.user_id; });
      if (action === 'approve' && user) {
        user.total_withdrawn = num(user.total_withdrawn) + num(wd.amount);
      }
      if (action === 'reject' && user) {
        user.balance = num(user.balance) + num(wd.amount);
      }

      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== ADMIN: GAMES ====================
    if (url === '/api/admin/games' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });

      return respond(res, 200, db.games.slice().reverse().map(function (g) {
        var u = db.users.find(function (u) { return u.id === g.user_id; });
        return {
          id: g.id, user_id: g.user_id,
          bet_amount: num(g.bet_amount), multiplier: num(g.multiplier),
          prize: num(g.prize), result: g.result,
          platforms_reached: g.platforms_reached || 0,
          created_at: g.created_at,
          user_name: u ? u.name : 'N/A', user_email: u ? u.email : 'N/A'
        };
      }));
    }

    // ==================== ADMIN: SETTINGS ====================
    if (url === '/api/admin/settings' && method === 'GET') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });
      return respond(res, 200, db.settings);
    }

    if (url === '/api/admin/settings' && method === 'POST') {
      var admin = getUser(db, req);
      if (!admin || !admin.is_admin) return respond(res, 401, { error: 'Nao autorizado' });
      var body = await parseBody(req);
      Object.keys(body).forEach(function (key) { db.settings[key] = body[key]; });
      saveDB(db);
      return respond(res, 200, { success: true });
    }

    // ==================== 404 ====================
    return respond(res, 404, { error: 'Rota nao encontrada: ' + url });

  } catch (err) {
    console.error('API Error:', err.message, err.stack);
    return respond(res, 500, { error: 'Erro interno: ' + err.message });
  }
};
