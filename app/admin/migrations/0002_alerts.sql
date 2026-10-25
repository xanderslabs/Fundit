-- Health alert state: one row per check, so a run knows how long a check has been failing and when it last told the owner.
CREATE TABLE alert_state (key TEXT PRIMARY KEY, failing INTEGER NOT NULL, fail_count INTEGER NOT NULL, since INTEGER NOT NULL, last_sent INTEGER NOT NULL);
-- Small values the cron keeps between runs: owner_events_next:<network> (next block to scan) and rpc_head:<network>.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
