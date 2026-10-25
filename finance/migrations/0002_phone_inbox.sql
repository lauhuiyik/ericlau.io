-- Phone feed for /experiments/finance: payment notifications forwarded from
-- the owner's phone wait here, each encrypted to the vault's drop-box public
-- key (private half only inside the vault), until the unlocked page files them.

-- The drop-box public key, and the SHA-256 of the phone key (bearer token).
CREATE TABLE inbox_key (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  public_jwk TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  envelope TEXT NOT NULL
);
