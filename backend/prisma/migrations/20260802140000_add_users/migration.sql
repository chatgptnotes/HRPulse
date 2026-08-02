-- Authentication: a `users` table.
--
-- Purely additive — creates one new table and touches nothing that exists.
-- Idempotent for the same reason as the previous migration: this may be applied
-- by hand in the Supabase SQL editor before Prisma sees it.

CREATE TABLE IF NOT EXISTS "users" (
    "id"            SERIAL       NOT NULL,
    "email"         TEXT         NOT NULL,
    "password_hash" TEXT         NOT NULL,
    "name"          TEXT         NOT NULL,
    "role"          TEXT         NOT NULL DEFAULT 'hr',
    "is_active"     BOOLEAN      NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" ("email");
