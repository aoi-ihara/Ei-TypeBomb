-- Dedicated authorization-server storage. Never exposed via the Supabase Data
-- API, and independent of auth.*, rcAccount hooks, website sessions and RLS.
create schema if not exists etb_mcp_oauth;
revoke all on schema etb_mcp_oauth from public, anon, authenticated;

create table etb_mcp_oauth.models (
    issuer text not null,
    model text not null,
    id text not null,
    payload text not null, -- AES-256-GCM ciphertext; AAD binds model + hashed ID
    expires_at timestamptz not null,
    consumed bigint,
    uid text,
    user_code text,
    grant_id text,
    account_id text,
    primary key (issuer, model, id)
);
create index on etb_mcp_oauth.models (issuer, model, uid);
create index on etb_mcp_oauth.models (issuer, model, user_code);
create index on etb_mcp_oauth.models (issuer, grant_id);
create index on etb_mcp_oauth.models (issuer, model, account_id);
create index on etb_mcp_oauth.models (expires_at);
alter table etb_mcp_oauth.models enable row level security;

create table etb_mcp_oauth.rate_limits (
    issuer text not null,
    bucket text not null,
    window_start timestamptz not null,
    count integer not null,
    primary key (issuer, bucket)
);
alter table etb_mcp_oauth.rate_limits enable row level security;
revoke all on all tables in schema etb_mcp_oauth from public, anon, authenticated;

-- Provision a dedicated LOGIN role through your secret-management process.
-- Grant it USAGE on this schema and SELECT/INSERT/UPDATE/DELETE on these tables,
-- plus RLS policies TO that role USING (true) WITH CHECK (true).
-- Never use the rcAccount auth schema owner as the application's DB user.
