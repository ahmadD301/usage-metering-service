
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('account', 'user')),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),

  owner_account_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (id, scope),
  UNIQUE (owner_account_id, name)
);


CREATE UNIQUE INDEX plans_predefined_name_uq ON plans (name) WHERE owner_account_id IS NULL;

CREATE TABLE plan_rules (
  plan_id UUID NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('max_per_request', 'monthly_allowance', 'daily_allowance')),
  limit_value BIGINT NOT NULL CHECK (limit_value >= 0 AND limit_value <= 1000000000000),
  PRIMARY KEY (plan_id, kind)
);


CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  plan_id UUID NOT NULL,
  plan_scope TEXT NOT NULL DEFAULT 'account' CHECK (plan_scope = 'account'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, plan_scope) REFERENCES plans (id, scope)
);

ALTER TABLE plans
  ADD CONSTRAINT plans_owner_account_fk
  FOREIGN KEY (owner_account_id) REFERENCES accounts (id);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  key_prefix TEXT NOT NULL CHECK (length(key_prefix) BETWEEN 4 AND 16),
  -- Lowercase hex SHA-256 of the full key
  key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX api_keys_account_idx ON api_keys (account_id);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),

  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  plan_id UUID NOT NULL,
  plan_scope TEXT NOT NULL DEFAULT 'user' CHECK (plan_scope = 'user'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id),

  UNIQUE (id, account_id),
  FOREIGN KEY (plan_id, plan_scope) REFERENCES plans (id, scope)
);

CREATE INDEX users_plan_idx ON users (plan_id);


CREATE TABLE account_usage (
  account_id UUID NOT NULL REFERENCES accounts (id),
  period_kind TEXT NOT NULL CHECK (period_kind IN ('month', 'day')),
  period_start DATE NOT NULL,
  units_used BIGINT NOT NULL DEFAULT 0 CHECK (units_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, period_kind, period_start),
  CHECK (period_kind <> 'month' OR extract(day FROM period_start) = 1)
);

CREATE TABLE user_usage (
  user_id UUID NOT NULL REFERENCES users (id),
  period_kind TEXT NOT NULL CHECK (period_kind IN ('month', 'day')),
  period_start DATE NOT NULL,
  units_used BIGINT NOT NULL DEFAULT 0 CHECK (units_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_kind, period_start),
  CHECK (period_kind <> 'month' OR extract(day FROM period_start) = 1)
);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  user_id UUID NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  units BIGINT NOT NULL CHECK (units > 0),
  fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  decision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id),
  FOREIGN KEY (user_id, account_id) REFERENCES users (id, account_id)
);

CREATE INDEX requests_account_history_idx ON requests (account_id, created_at DESC, id DESC);
CREATE INDEX requests_user_history_idx ON requests (user_id, created_at DESC, id DESC);


CREATE FUNCTION forbid_predefined_plan_change() RETURNS trigger AS $$
BEGIN
  IF OLD.owner_account_id IS NULL THEN
    RAISE EXCEPTION 'predefined plans are read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plans_predefined_readonly
  BEFORE UPDATE OR DELETE ON plans
  FOR EACH ROW EXECUTE FUNCTION forbid_predefined_plan_change();

CREATE FUNCTION forbid_predefined_rule_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM plans p WHERE p.id = OLD.plan_id AND p.owner_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'predefined plans are read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_rules_predefined_readonly
  BEFORE UPDATE OR DELETE ON plan_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_predefined_rule_change();