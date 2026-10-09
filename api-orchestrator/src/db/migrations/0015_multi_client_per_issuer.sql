-- Allow multiple OAuth clients per issuer (e.g. two Google client_ids for the
-- same https://accounts.google.com). Uniqueness is now (issuer, client_id)
-- instead of issuer alone. SQLite NULLs are distinct so token-verify-only
-- providers (NULL client_id) coexist without a unique collision.

DROP INDEX IF EXISTS `identity_providers_issuer_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_providers_issuer_client_unique`
  ON `identity_providers` (`issuer`, `client_id`);
