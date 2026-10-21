-- Backfill: trust pre-existing gateway users.
-- Every user that existed before the identity-provider-login feature was
-- operator-created (self-signup did not exist yet), so all gateway users
-- without a verification stamp are marked verified as of their creation time.
UPDATE `app_users`
SET `email_verified_at` = `created_at`
WHERE `auth_method` = 'gateway' AND `email_verified_at` IS NULL;
