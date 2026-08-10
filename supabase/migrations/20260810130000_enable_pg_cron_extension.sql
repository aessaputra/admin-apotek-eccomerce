-- ============================================================================
-- Migration: Enable pg_cron Extension and Ensure Cron Schema Privileges
-- Description: Enables the pg_cron extension safely inside the extensions schema
--              and grants necessary usage/privileges for scheduled jobs.
-- ============================================================================

-- 1. Enable pg_cron extension in extensions schema
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- 2. Ensure schema permissions for postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;
