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
