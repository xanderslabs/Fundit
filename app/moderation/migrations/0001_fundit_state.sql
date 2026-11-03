-- The review state of a Fundit, one row per network and address. A Fundit with no row is normal. Addresses are stored
-- lowercase. The admin Worker is the only writer. The public Worker only reads, and never reads note.
CREATE TABLE fundit_state (
  network TEXT NOT NULL CHECK (network IN ('mainnet','testnet')),
  address TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('review','removed','cleared')),
  note TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network, address)
);
-- Every state change, newest last, so a decision can be traced.
CREATE TABLE fundit_state_log (
  id INTEGER PRIMARY KEY,
  network TEXT NOT NULL CHECK (network IN ('mainnet','testnet')),
  address TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT NOT NULL CHECK (new_state IN ('review','removed','cleared')),
  note TEXT,
  at INTEGER NOT NULL
);
