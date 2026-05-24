-- 014_channel_kinds_outlook.sql
-- Align channel_account_kind with the Outlook-only / no-Gmail decision
-- (ARCHITECTURE.md "Channels"). Adds `oauth_outlook` as the explicit
-- value the email channel uses. The previous generic `email_oauth` value
-- stays in the enum (Postgres doesn't drop enum values cleanly) but is
-- no longer referenced by code.

alter type channel_account_kind add value if not exists 'oauth_outlook';
