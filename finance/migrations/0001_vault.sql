-- Encrypted finance vault for /experiments/finance (D1 database ericlau-finance).
-- Only ciphertext is stored: the browser encrypts with the owner's passphrase.

CREATE TABLE vault (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  version INTEGER NOT NULL CHECK (version > 0),
  envelope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Replaced versions (the last 30, plus the newest of each of the last 60 days),
-- so a bad save can be rolled back by hand. updated_at sits before the large
-- envelope so pruning by date doesn't read through every envelope.
CREATE TABLE vault_history (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  envelope TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
