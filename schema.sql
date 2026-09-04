CREATE TABLE IF NOT EXISTS containers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'paused', 'error')),
  image TEXT NOT NULL,
  ports TEXT NOT NULL DEFAULT '',
  cpu_limit INTEGER NOT NULL DEFAULT 0 CHECK (cpu_limit >= 0),
  memory_limit_mb INTEGER NOT NULL DEFAULT 0 CHECK (memory_limit_mb >= 0),
  cpu_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  memory_mb INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS cpu_limit INTEGER NOT NULL DEFAULT 0 CHECK (cpu_limit >= 0),
  ADD COLUMN IF NOT EXISTS memory_limit_mb INTEGER NOT NULL DEFAULT 0 CHECK (memory_limit_mb >= 0);

INSERT INTO containers (name, status, image, ports, cpu_percent, memory_mb)
VALUES
  ('web-01', 'running', 'nginx:latest', '80:80', 12, 184),
  ('api-server', 'running', 'node:22-alpine', '3000:3000', 8, 342),
  ('database', 'stopped', 'postgres:16', '5432:5432', 4, 516)
ON CONFLICT (name) DO NOTHING;

-- 로그인 계정은 컨테이너 정보와 분리된 사용자 테이블에 저장합니다.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);
