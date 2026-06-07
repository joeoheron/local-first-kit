CREATE TABLE users (
  id              TEXT PRIMARY KEY NOT NULL,
  email           TEXT UNIQUE,
  hashed_password TEXT,
  sync_enabled    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE refresh_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE api_tokens (
  token_hash        TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'read',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at        TEXT,
  wrapped_space_key TEXT,
  space_id          TEXT
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE spaces (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE space_members (
  space_id  TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX idx_space_members_user ON space_members(user_id);

CREATE TABLE space_invites (
  id                TEXT PRIMARY KEY NOT NULL,
  space_id          TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_space_key TEXT NOT NULL,
  inviter_ecdh_pub  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at      TEXT,
  UNIQUE (space_id, invitee_user_id)
);
CREATE INDEX idx_space_invites_invitee ON space_invites(invitee_user_id, status);
CREATE INDEX idx_space_invites_space   ON space_invites(space_id);

CREATE TABLE space_keys (
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE passkey_credentials (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   BLOB NOT NULL,
  algorithm    INTEGER NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  name         TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);

CREATE TABLE webauthn_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  user_id    TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE device_keys (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  wrapped_key   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, credential_id)
);

CREATE TABLE pending_device_approvals (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ecdh_public_key         TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  primary_ecdh_public_key TEXT,
  wrapped_user_key        TEXT,
  pop_hash                TEXT,
  expires_at              TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pending_device_approvals_user ON pending_device_approvals(user_id, status);

CREATE TABLE user_identity_keys (
  user_id             TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key          TEXT NOT NULL,
  wrapped_private_key TEXT NOT NULL,
  credential_id       TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_wrapping_keys (
  user_id             TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key          TEXT NOT NULL,
  wrapped_private_key TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
