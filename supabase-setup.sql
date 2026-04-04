-- =============================================
-- HELIX CASH - SUPABASE DATABASE SETUP
-- Cole este SQL no SQL Editor do Supabase
-- =============================================

-- Tabela de usuarios
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password TEXT NOT NULL,
  balance NUMERIC(12,2) DEFAULT 0,
  bonus_balance NUMERIC(12,2) DEFAULT 0,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  is_blocked BOOLEAN DEFAULT FALSE,
  is_influencer BOOLEAN DEFAULT FALSE,
  influencer_win_rate NUMERIC(5,2) DEFAULT 0,
  total_deposited NUMERIC(12,2) DEFAULT 0,
  total_withdrawn NUMERIC(12,2) DEFAULT 0,
  total_games INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- Tabela de depositos
CREATE TABLE IF NOT EXISTS deposits (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT DEFAULT 'pix',
  status TEXT DEFAULT 'pending',
  pix_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de saques
CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  pix_key TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de jogos
CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  bet_amount NUMERIC(12,2) NOT NULL,
  multiplier NUMERIC(5,2) NOT NULL,
  prize NUMERIC(12,2) NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de configuracoes (chave-valor)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Tabela de ganhos por indicacao
CREATE TABLE IF NOT EXISTS referral_earnings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuracoes padrao
INSERT INTO settings (key, value) VALUES
  ('min_deposit', '10'),
  ('min_withdrawal', '20'),
  ('max_multiplier', '7'),
  ('referral_bonus', '5'),
  ('house_edge', '15'),
  ('influencer_house_edge', '5'),
  ('site_name', 'Helix Cash')
ON CONFLICT (key) DO NOTHING;

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
