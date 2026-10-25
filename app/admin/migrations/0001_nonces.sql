-- One row per sign-in nonce the Worker issued. A login deletes its row, so each nonce works once.
CREATE TABLE nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
