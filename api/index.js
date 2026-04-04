const crypto = require('crypto');

// ===================== DATABASE WITH PERSISTENCE =====================
// Uses a JSON file stored in /tmp on Vercel (persists during warm invocations)
// For FULL persistence, connect to Supabase/MongoDB/PlanetScale
const fs = require('fs');
const DB_PATH = '/tmp/helix-db.json';
const JWT_SECRET = process.env.JWT_SECRET || 'helix-cash-secret-key-2024';

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) { /* fresh */ }
  return getDefaultDB();
}

function getDefaultDB() {
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
    deposits: [], withdrawals: [], games: [], referral_earnings: [],
    settings: {
      min_deposit: '10', min_withdrawal: '20', max_multiplier: '7',
      referral_bonus: '5', house_edge: '15', influencer_house_edge: '5',
      site_name: 'Helix Cash'
    },
    next_id: { users: 2, deposits: 1, withdrawals: 1, games: 1, referral_earnings: 1 }
  };
}

let db = loadDB();

function saveDB() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db)); } catch (e) { /* silent */ }
}

// ===================== HELPERS =====================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === test;
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const payload = verifyToken(auth.split(' ')[1]);
  if (!payload) return null;
  return db.users.find(u => u.id === payload.id);
}

function genRefCode() { return 'HC' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function genPixCode() { return crypto.randomBytes(16).toString('hex'); }
function isToday(d) { if (!d) return false; return new Date(d).toDateString() === new Date().toDateString(); }

function insert(table, record) {
  record.id = db.next_id[table]++;
  record.created_at = record.created_at || new Date().toISOString();
  db[table].push(record);
  saveDB();
  return record;
}

// ===================== HANDLER =====================
module.exports = async (req, res) => {
  // Reload DB on each request to get latest data
  db = loadDB();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.replace(/\?.*$/, '');
  const method = req.method;
  const body = req.body || {};

  function json(code, data) { return res.status(code).json(data); }

  try {
    // ===== AUTH =====
    if (path === 'https://helix-cash.vercel.app/api/auth/register' && method === 'POST') {
      const { name, email, phone, password, referral_code } = body;
      if (!name || !email || !password) return json(400, { error: 'Preencha todos os campos obrigatórios' });
      if (password.length < 6) return json(400, { error: 'Senha deve ter no mínimo 6 caracteres' });
      if (db.users.find(u => u.email === email)) return json(400, { error: 'Email já cadastrado' });

      let referredBy = null;
      if (referral_code) {
        const referrer = db.users.find(u => u.referral_code === referral_code);
        if (referrer) referredBy = referral_code;
      }

      const user = insert('users', {
        name, email, phone: phone || null,
        password: hashPassword(password),
        balance: 0, bonus_balance: 0,
        referral_code: genRefCode(),
        referred_by: referredBy,
        is_admin: false, is_blocked: false,
        is_influencer: false, influencer_win_rate: 0,
        total_deposited: 0, total_withdrawn: 0, total_games: 0,
        last_login: new Date().toISOString()
      });

      const token = createToken({ id: user.id });
      return json(200, {
        token,
        user: { id: user.id, name: user.name, email: user.email, balance: 0, bonus_balance: 0, referral_code: user.referral_code }
      });
    }

    if (path === 'https://helix-cash.vercel.app/api/auth/login' && method === 'POST') {
      const { email, password } = body;
      const user = db.users.find(u => u.email === email);
      if (!user) return json(400, { error: 'Email ou senha incorretos' });
      if (user.is_blocked) return json(403, { error: 'Conta bloqueada' });
      if (!verifyPassword(password, user.password)) return json(400, { error: 'Email ou senha incorretos' });

      user.last_login = new Date().toISOString();
      saveDB();
      const token = createToken({ id: user.id });
      return json(200, {
        token,
        user: {
          id: user.id, name: user.name, email: user.email,
          balance: user.balance, bonus_balance: user.bonus_balance,
          referral_code: user.referral_code, is_admin: user.is_admin,
          is_influencer: user.is_influencer
        }
      });
    }

    // ===== STATS (PUBLIC) =====
    if (path === 'https://helix-cash.vercel.app/api/stats' && method === 'GET') {
      const onlineNow = Math.floor(Math.random() * 500) + 1500;
      const todayPaid = db.withdrawals.filter(w => w.status === 'approved' && isToday(w.processed_at)).reduce((s, w) => s + w.amount, 0);
      const maxWin = db.games.filter(g => isToday(g.created_at)).reduce((m, g) => Math.max(m, g.prize || 0), 0);
      return json(200, {
        online: onlineNow,
        total_users: db.users.filter(u => !u.is_admin).length + 2847,
        today_paid: todayPaid + 8420,
        max_win_today: Math.max(maxWin, 700)
      });
    }

    // ===== AUTH REQUIRED =====
    const user = getUser(req);
    if (!user) return json(401, { error: 'Faça login para continuar' });
    if (user.is_blocked) return json(403, { error: 'Conta bloqueada' });

    // ===== USER =====
    if (path === 'https://helix-cash.vercel.app/api/user/me' && method === 'GET') {
      const referrals = db.users.filter(u => u.referred_by === user.referral_code).length;
      return json(200, {
        id: user.id, name: user.name, email: user.email, phone: user.phone,
        balance: user.balance, bonus_balance: user.bonus_balance,
        referral_code: user.referral_code, is_admin: user.is_admin,
        is_influencer: user.is_influencer || false,
        created_at: user.created_at, referrals
      });
    }

    if (path === 'https://helix-cash.vercel.app/api/user/history' && method === 'GET') {
      return json(200, {
        games: db.games.filter(g => g.user_id === user.id).reverse().slice(0, 50),
        deposits: db.deposits.filter(d => d.user_id === user.id).reverse().slice(0, 50),
        withdrawals: db.withdrawals.filter(w => w.user_id === user.id).reverse().slice(0, 50)
      });
    }

    // ===== DEPOSIT =====
    if (path === 'https://helix-cash.vercel.app/api/deposit' && method === 'POST') {
      const { amount } = body;
      const minDep = parseFloat(db.settings.min_deposit);
      if (!amount || amount < minDep) return json(400, { error: `Depósito mínimo: R$${minDep.toFixed(2)}` });

      const deposit = insert('deposits', {
        user_id: user.id, amount, method: 'PIX',
        status: 'pending', pix_code: genPixCode(), approved_at: null
      });
      return json(200, { id: deposit.id, amount, pix_code: deposit.pix_code, status: 'pending', message: 'Depósito criado! Aguardando confirmação.' });
    }

    // ===== WITHDRAW =====
    if (path === 'https://helix-cash.vercel.app/api/withdraw' && method === 'POST') {
      const { amount, pix_key, pix_type } = body;
      const minW = parseFloat(db.settings.min_withdrawal);
      if (!amount || amount < minW) return json(400, { error: `Saque mínimo: R$${minW.toFixed(2)}` });
      if (amount > user.balance) return json(400, { error: 'Saldo insuficiente' });
      if (!pix_key) return json(400, { error: 'Informe a chave PIX' });

      user.balance -= amount;
      user.total_withdrawn = (user.total_withdrawn || 0) + amount;
      const w = insert('withdrawals', {
        user_id: user.id, amount, pix_key, pix_type: pix_type || 'cpf',
        status: 'pending', processed_at: null
      });
      return json(200, { id: w.id, amount, status: 'pending', message: 'Saque solicitado!' });
    }

    // ===== GAME =====
    if (path === 'https://helix-cash.vercel.app/api/game/start' && method === 'POST') {
      const { bet_amount } = body;
      if (!bet_amount || bet_amount < 1) return json(400, { error: 'Aposta mínima: R$1,00' });
      if (bet_amount > user.balance) return json(400, { error: 'Saldo insuficiente' });
      if (db.games.find(g => g.user_id === user.id && g.status === 'playing')) return json(400, { error: 'Você já tem uma partida ativa' });

      user.balance -= bet_amount;
      user.total_games = (user.total_games || 0) + 1;
      saveDB();
      const game = insert('games', {
        user_id: user.id, bet_amount, platforms_reached: 0,
        multiplier: 1, prize: 0, status: 'playing', finished_at: null
      });
      return json(200, { game_id: game.id, bet_amount, new_balance: user.balance });
    }

    if (path === '/api/game/finish' && method === 'POST') {
      const { game_id, platforms_reached } = body;
      const game = db.games.find(g => g.id === game_id && g.user_id === user.id && g.status === 'playing');
      if (!game) return json(400, { error: 'Partida não encontrada' });

      // Use different house edge for influencers
      const isInfluencer = user.is_influencer || false;
      const normalHouseEdge = parseFloat(db.settings.house_edge) / 100;
      const influencerHouseEdge = parseFloat(db.settings.influencer_house_edge || '5') / 100;
      const houseEdge = isInfluencer ? influencerHouseEdge : normalHouseEdge;

      // Influencer custom win rate override
      const influencerWinRate = user.influencer_win_rate || 0;

      const maxMult = parseFloat(db.settings.max_multiplier);
      let mult = Math.min(1 + (platforms_reached * 0.5), maxMult);

      // Apply house edge (chance of reducing prize)
      if (isInfluencer && influencerWinRate > 0) {
        // Influencer has a custom guaranteed win rate
        if (Math.random() * 100 > influencerWinRate) {
          mult = Math.max(0, mult * 0.3);
        }
        // else: influencer keeps full multiplier
      } else {
        if (Math.random() < houseEdge) {
          mult = Math.max(0, mult * 0.3);
        }
      }

      const prize = Math.round(game.bet_amount * mult * 100) / 100;
      game.platforms_reached = platforms_reached;
      game.multiplier = Math.round(mult * 100) / 100;
      game.prize = prize;
      game.status = 'finished';
      game.finished_at = new Date().toISOString();
      if (prize > 0) user.balance += prize;
      saveDB();

      // Referral bonus on first game
      const gameCount = db.games.filter(g => g.user_id === user.id && g.status === 'finished').length;
      if (gameCount === 1 && user.referred_by) {
        const referrer = db.users.find(u => u.referral_code === user.referred_by);
        if (referrer) {
          const bonus = Math.round(game.bet_amount * (parseFloat(db.settings.referral_bonus) / 100) * 100) / 100;
          if (bonus > 0) {
            referrer.bonus_balance += bonus;
            insert('referral_earnings', { user_id: referrer.id, referred_user_id: user.id, amount: bonus });
          }
        }
      }

      return json(200, { game_id, platforms_reached, multiplier: game.multiplier, prize, bet_amount: game.bet_amount, new_balance: user.balance });
    }

    // ===== REFERRALS =====
    if (path === 'https://helix-cash.vercel.app/api/referrals' && method === 'GET') {
      const refs = db.users.filter(u => u.referred_by === user.referral_code).map(u => {
        const e = db.referral_earnings.find(e => e.referred_user_id === u.id && e.user_id === user.id);
        return { name: u.name, created_at: u.created_at, amount: e ? e.amount : 0 };
      });
      const total = db.referral_earnings.filter(e => e.user_id === user.id).reduce((s, e) => s + e.amount, 0);
      return json(200, { referrals: refs, total_earned: total });
    }

    // ===================== ADMIN =====================
    if (path.startsWith('/api/admin/') && !user.is_admin) return json(403, { error: 'Acesso negado' });

    if (path === 'https://helix-cash.vercel.app/api/admin/dashboard' && method === 'GET') {
      const depApproved = db.deposits.filter(d => d.status === 'approved');
      const wApproved = db.withdrawals.filter(w => w.status === 'approved');
      const totalDepAmount = depApproved.reduce((s, d) => s + d.amount, 0);
      const totalWAmount = wApproved.reduce((s, w) => s + w.amount, 0);
      const totalBets = db.games.reduce((s, g) => s + g.bet_amount, 0);
      const totalPrizes = db.games.reduce((s, g) => s + (g.prize || 0), 0);
      const influencerCount = db.users.filter(u => u.is_influencer && !u.is_admin).length;

      return json(200, {
        users: db.users.filter(u => !u.is_admin).length,
        influencers: influencerCount,
        deposits: { total: totalDepAmount, count: depApproved.length },
        withdrawals: { total: totalWAmount, count: wApproved.length },
        games: { count: db.games.length, total_bets: totalBets, total_prizes: totalPrizes },
        profit: totalDepAmount - totalWAmount,
        game_profit: totalBets - totalPrizes,
        pending: {
          deposits: db.deposits.filter(d => d.status === 'pending').length,
          withdrawals: db.withdrawals.filter(w => w.status === 'pending').length
        },
        today: {
          deposits: db.deposits.filter(d => d.status === 'approved' && isToday(d.approved_at)).reduce((s, d) => s + d.amount, 0),
          withdrawals: db.withdrawals.filter(w => w.status === 'approved' && isToday(w.processed_at)).reduce((s, w) => s + w.amount, 0),
          new_users: db.users.filter(u => !u.is_admin && isToday(u.created_at)).length,
          games: db.games.filter(g => isToday(g.created_at)).length
        }
      });
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/users' && method === 'GET') {
      return json(200, db.users.filter(u => !u.is_admin).map(u => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone,
        balance: u.balance, bonus_balance: u.bonus_balance,
        referral_code: u.referral_code, referred_by: u.referred_by,
        is_blocked: u.is_blocked, is_influencer: u.is_influencer || false,
        influencer_win_rate: u.influencer_win_rate || 0,
        total_deposited: u.total_deposited || 0,
        total_withdrawn: u.total_withdrawn || 0,
        total_games: u.total_games || 0,
        created_at: u.created_at, last_login: u.last_login
      })).reverse());
    }

    // Admin user actions - extended
    const userActionMatch = path.match(/^\/api\/admin\/user\/(\d+)\/(block|balance|influencer|add-balance)$/);
    if (userActionMatch && method === 'POST') {
      const target = db.users.find(u => u.id === parseInt(userActionMatch[1]));
      if (!target) return json(404, { error: 'Usuário não encontrado' });
      const action = userActionMatch[2];

      if (action === 'block') {
        target.is_blocked = !!body.blocked;
      } else if (action === 'balance') {
        target.balance = parseFloat(body.amount) || 0;
      } else if (action === 'add-balance') {
        target.balance += parseFloat(body.amount) || 0;
      } else if (action === 'influencer') {
        target.is_influencer = !!body.is_influencer;
        target.influencer_win_rate = parseFloat(body.win_rate) || 0;
      }
      saveDB();
      return json(200, { success: true });
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/deposits' && method === 'GET') {
      return json(200, db.deposits.map(d => {
        const u = db.users.find(u => u.id === d.user_id) || {};
        return { ...d, name: u.name, email: u.email };
      }).reverse().slice(0, 100));
    }

    const depAction = path.match(/^\/api\/admin\/deposit\/(\d+)\/(approve|reject)$/);
    if (depAction && method === 'POST') {
      const dep = db.deposits.find(d => d.id === parseInt(depAction[1]));
      if (!dep) return json(404, { error: 'Depósito não encontrado' });
      if (dep.status !== 'pending') return json(400, { error: 'Já processado' });
      if (depAction[2] === 'approve') {
        dep.status = 'approved'; dep.approved_at = new Date().toISOString();
        const t = db.users.find(u => u.id === dep.user_id);
        if (t) {
          t.balance += dep.amount;
          t.total_deposited = (t.total_deposited || 0) + dep.amount;
        }
      } else { dep.status = 'rejected'; }
      saveDB();
      return json(200, { success: true });
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/withdrawals' && method === 'GET') {
      return json(200, db.withdrawals.map(w => {
        const u = db.users.find(u => u.id === w.user_id) || {};
        return { ...w, name: u.name, email: u.email };
      }).reverse().slice(0, 100));
    }

    const wAction = path.match(/^\/api\/admin\/withdrawal\/(\d+)\/(approve|reject)$/);
    if (wAction && method === 'POST') {
      const w = db.withdrawals.find(w => w.id === parseInt(wAction[1]));
      if (!w) return json(404, { error: 'Saque não encontrado' });
      if (w.status !== 'pending') return json(400, { error: 'Já processado' });
      if (wAction[2] === 'approve') {
        w.status = 'approved'; w.processed_at = new Date().toISOString();
      } else {
        w.status = 'rejected'; w.processed_at = new Date().toISOString();
        const t = db.users.find(u => u.id === w.user_id);
        if (t) t.balance += w.amount;
      }
      saveDB();
      return json(200, { success: true });
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/games' && method === 'GET') {
      return json(200, db.games.map(g => {
        const u = db.users.find(u => u.id === g.user_id) || {};
        return { ...g, name: u.name, email: u.email, is_influencer: u.is_influencer || false };
      }).reverse().slice(0, 100));
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/settings' && method === 'GET') {
      return json(200, db.settings);
    }

    if (path === 'https://helix-cash.vercel.app/api/admin/settings' && method === 'POST') {
      Object.entries(body).forEach(([k, v]) => {
        db.settings[k] = String(v);
      });
      saveDB();
      return json(200, { success: true });
    }

    return json(404, { error: 'Rota não encontrada' });

  } catch (e) {
    return json(500, { error: 'Erro interno: ' + e.message });
  }
};
