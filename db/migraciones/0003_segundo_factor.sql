-- =============================================================================
-- 0003 · Segundo factor (TOTP) de Better Auth, obligatorio para los
-- administradores de la plataforma (/admin). Los dueños y empleados no lo usan.
-- Mismo esquema que genera el plugin twoFactor de Better Auth 1.7 (ids uuid).
-- =============================================================================

alter table auth."user" add column "twoFactorEnabled" boolean default false;

create table auth."twoFactor" (
  "id"                      uuid primary key default gen_random_uuid(),
  "secret"                  text not null,
  "backupCodes"             text not null,
  "userId"                  uuid not null references auth."user" ("id") on delete cascade,
  "verified"                boolean default true,
  "failedVerificationCount" integer default 0,
  "lockedUntil"             timestamptz
);
create index "twoFactor_secret_idx" on auth."twoFactor" ("secret");
create index "twoFactor_userId_idx" on auth."twoFactor" ("userId");

-- Solo Better Auth. El servidor no ve secretos ni códigos de respaldo.
grant select, insert, update, delete on auth."twoFactor" to agenda2_auth;
