
ALTER TABLE requests
  ADD COLUMN period_month DATE NOT NULL
  DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date;

ALTER TABLE requests
  ADD CONSTRAINT requests_period_month_first_day
  CHECK (extract(day FROM period_month) = 1);

CREATE INDEX requests_account_period_idx
  ON requests (account_id, period_month, created_at DESC, id DESC);