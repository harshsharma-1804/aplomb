-- Frontend key: pre-shared secret for server-to-server relay authentication.
-- When set on an app, every user-facing auth request (login, 2FA, signup,
-- OAuth start) must carry X-Frontend-Key matching this argon2 hash.
-- Prevents unauthorised relay servers from authenticating users on this app.

ALTER TABLE `apps` ADD `frontend_key_hash` text;
