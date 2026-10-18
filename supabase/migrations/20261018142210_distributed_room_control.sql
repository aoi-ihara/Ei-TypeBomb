create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Only this capability-checked RPC is exposed. No game host gets service_role.
create schema if not exists etb_private;
revoke all on schema etb_private from public, anon, authenticated;
create table etb_private.servers (
    id text primary key check (length(id) <= 300 and (id ~ '^https://[^/@?#]+$' or id ~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$')),
    token_hash bytea not null,
    parent text references etb_private.servers(id),
    depth integer not null check (depth >= 0),
    transport text not null check (transport in ('socket.io','websocket')),
    enabled boolean not null default true,
    seen timestamptz not null default '-infinity',
    unique (depth) -- ordered chain, arbitrary length; provision parents before children
);
create table etb_private.ownership (
    room_id uuid primary key,
    instance uuid not null,
    owner text not null references etb_private.servers(id),
    epoch bigint not null,
    revision bigint not null default 0,
    lifecycle text not null check (lifecycle in ('CREATING','ACTIVE','MIGRATING','DELETING','DELETED')),
    lease_until timestamptz not null,
    saved_at timestamptz not null,
    paused_at timestamptz,
    input_at timestamptz not null default '-infinity'
);
-- State has an independent lifetime from the ownership row and its fencing token.
create table etb_private.checkpoints (
    room_id uuid primary key references etb_private.ownership(room_id),
    value jsonb,
    receipt uuid not null default gen_random_uuid()
);
alter table etb_private.servers enable row level security;
alter table etb_private.ownership enable row level security;
alter table etb_private.checkpoints enable row level security;
revoke all on all tables in schema etb_private from public, anon, authenticated;

create function public.etb_cluster(server_id text, server_token text, operation text, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    me etb_private.servers;
    own etb_private.ownership;
    cp etb_private.checkpoints;
    rid uuid;
    clock timestamptz := clock_timestamp();
    servers jsonb;
    winner text;
    jwt_parts text[];
    jwt_header jsonb;
    jwt_claims jsonb;
    jwt_signature bytea;
    sender etb_private.servers;
begin
    -- A random 256-bit server capability is independently revocable and only
    -- permits cluster operations for its provisioned URL/rank. Never log it.
    select * into me from etb_private.servers s where s.id = server_id and s.enabled
      and s.token_hash = sha256(convert_to(server_token, 'UTF8'));
    if me.id is null then raise insufficient_privilege using message = 'Invalid server capability'; end if;
    if octet_length(args::text) > 524288 then raise exception 'Payload too large'; end if;
    if operation = 'register' then
        if args->>'id' is distinct from me.id or args->>'parent' is distinct from me.parent
           or args->>'transport' is distinct from me.transport
           or args->>'primary' is distinct from (select s.id from etb_private.servers s where s.depth = 0 and s.enabled)
           or (me.depth > 0 and not exists (select 1 from etb_private.servers s where s.id = me.parent and s.depth = me.depth - 1))
        then raise insufficient_privilege using message = 'Unprovisioned topology'; end if;
        update etb_private.servers set seen = clock where id = me.id;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'parent', s.parent, 'depth', s.depth,
        'transport', s.transport, 'seen', case when s.seen = '-infinity' then null else extract(epoch from s.seen)*1000 end) order by s.depth), '[]')
        into servers from etb_private.servers s where s.enabled;
    if operation = 'register' then return jsonb_build_object('servers', servers); end if;
    rid := (args->>'roomId')::uuid;
    -- Serializes creation as well as CAS of an existing row.
    perform pg_advisory_xact_lock(hashtextextended(rid::text, 941));
    clock := clock_timestamp();
    select * into own from etb_private.ownership o where o.room_id = rid for update;
    select * into cp from etb_private.checkpoints c where c.room_id = rid;
    if operation = 'open' then
        if own.room_id is null or own.lifecycle = 'DELETED' then
            select s.id into winner from etb_private.servers s where s.enabled and s.seen > clock - interval '10 seconds' order by s.depth limit 1;
            if winner is distinct from me.id then raise exception 'Higher server available'; end if;
            if args->'initial' is null or args->'initial'->'game'->'room'->>'id' is distinct from rid::text then raise exception 'Missing initial room'; end if;
            insert into etb_private.ownership(room_id,instance,owner,epoch,revision,lifecycle,lease_until,saved_at) values (rid, gen_random_uuid(), me.id, coalesce(own.epoch,0)+1, 0, 'CREATING', clock + interval '3 seconds', clock)
              on conflict (room_id) do update set instance=excluded.instance, owner=excluded.owner, epoch=excluded.epoch, revision=0, lifecycle='CREATING', lease_until=excluded.lease_until, saved_at=clock, paused_at=null, input_at='-infinity'
              returning * into own;
            insert into etb_private.checkpoints(room_id,value) values(rid,args->'initial') on conflict(room_id) do update set value=excluded.value, receipt=gen_random_uuid() returning * into cp;
        elsif own.owner <> me.id then
            if own.lease_until > clock or me.depth <= (select s.depth from etb_private.servers s where s.id=own.owner) then raise exception 'Owner still valid or failback forbidden'; end if;
            update etb_private.ownership set owner=me.id, epoch=epoch+1, lifecycle='MIGRATING', paused_at=least(clock,lease_until-interval '3 seconds'), lease_until=clock+interval '3 seconds' where room_id=rid returning * into own;
        else
            -- A restarted process at the same URL must fence its predecessor too.
            update etb_private.ownership set epoch=epoch+1, lifecycle='MIGRATING', paused_at=least(clock,lease_until-interval '3 seconds'), lease_until=clock+interval '3 seconds' where room_id=rid returning * into own;
        end if;
    elsif operation in ('renew', 'commit', 'delete') then
        if own.owner is distinct from me.id or own.instance::text is distinct from args->>'instance'
          or own.epoch is distinct from (args->>'epoch')::bigint or own.lease_until <= clock
          or own.lifecycle in ('DELETING','DELETED') then raise exception 'Fenced owner'; end if;
        if operation = 'renew' then
            update etb_private.ownership set lease_until=clock+interval '3 seconds' where room_id=rid returning * into own;
        else
            if own.revision is distinct from (args->>'revision')::bigint then raise exception 'Revision conflict'; end if;
            if operation = 'delete' then
                if exists (select 1 from jsonb_object_keys(cp.value->'sessions')) or coalesce((cp.value->'game'->'room'->>'isStart')::boolean,false)
                  then raise exception 'Room still in use'; end if;
                update etb_private.ownership set lifecycle='DELETING' where room_id=rid;
                update etb_private.checkpoints set value=null, receipt=gen_random_uuid() where room_id=rid returning * into cp;
                update etb_private.ownership set lifecycle='DELETED',revision=revision+1,lease_until=clock where room_id=rid returning * into own;
            else
                if args->'value'->'game'->'room'->>'id' is distinct from rid::text or (args->'value'->'game'->>'revision')::bigint is distinct from own.revision+1 then raise exception 'Room/revision mismatch'; end if;
                if clock - own.input_at < interval '80 milliseconds' and args->>'kind' = 'input' then raise exception 'Input frequency exceeded'; end if;
                update etb_private.checkpoints set value=args->'value', receipt=gen_random_uuid() where room_id=rid returning * into cp;
                update etb_private.ownership set revision=revision+1, lifecycle=case when args->'value'->>'resumeUntil' is null then 'ACTIVE' else 'MIGRATING' end, saved_at=clock, paused_at=null, input_at=case when args->>'kind' = 'input' then clock else input_at end, lease_until=clock+interval '3 seconds' where room_id=rid returning * into own;
            end if;
        end if;
    elsif operation = 'receive' then
        jwt_parts := string_to_array(args->>'jwt','.');
        if array_length(jwt_parts,1) is distinct from 3 or length(args->>'jwt') > 2048 then raise insufficient_privilege using message='Missing sender JWT'; end if;
        jwt_header := convert_from(decode(translate(rpad(jwt_parts[1],((length(jwt_parts[1])+3)/4)*4,'='),'-_','+/'),'base64'),'UTF8')::jsonb;
        jwt_claims := convert_from(decode(translate(rpad(jwt_parts[2],((length(jwt_parts[2])+3)/4)*4,'='),'-_','+/'),'base64'),'UTF8')::jsonb;
        jwt_signature := decode(translate(rpad(jwt_parts[3],((length(jwt_parts[3])+3)/4)*4,'='),'-_','+/'),'base64');
        select * into sender from etb_private.servers s where s.id=jwt_claims->>'iss' and s.enabled;
        if sender.id is null or sender.id <> own.owner or jwt_header->>'alg' is distinct from 'HS256' or jwt_header->>'typ' is distinct from 'JWT'
          or jwt_claims->>'aud' is distinct from me.id or jwt_claims->>'sub' is distinct from rid::text
          or jwt_claims->>'instance' is distinct from own.instance::text
          or (jwt_claims->>'epoch')::bigint is distinct from own.epoch
          or (jwt_claims->>'revision')::bigint is distinct from own.revision
          or (jwt_claims->>'exp')::numeric is null or (jwt_claims->>'iat')::numeric is null
          or (jwt_claims->>'exp')::numeric <= extract(epoch from clock)
          or (jwt_claims->>'iat')::numeric > extract(epoch from clock)+1
          or (jwt_claims->>'exp')::numeric - (jwt_claims->>'iat')::numeric not between 1 and 10
          or jwt_signature is distinct from extensions.hmac(convert_to(jwt_parts[1]||'.'||jwt_parts[2],'UTF8'),sender.token_hash,'sha256')
        then raise insufficient_privilege using message='Invalid sender JWT'; end if;
        if me.depth <= (select s.depth from etb_private.servers s where s.id=own.owner)
            or cp.receipt::text is distinct from args->>'receipt' then raise insufficient_privilege using message='Invalid replication receipt'; end if;
    elsif operation <> 'read' then raise exception 'Unknown operation';
    end if;
    -- Read of private state is restricted to the owner and its downstreams.
    if own.room_id is not null and me.depth < (select s.depth from etb_private.servers s where s.id=own.owner) then
        cp.value := null;
    end if;
    return jsonb_build_object('ownership', case when own.room_id is null then null else jsonb_build_object(
      'roomId',rid,'instance',own.instance,'owner',own.owner,'epoch',own.epoch,'revision',own.revision,
      'lifecycle',own.lifecycle,'pausedAt',extract(epoch from own.paused_at)*1000,'leaseUntil',extract(epoch from own.lease_until)*1000,'savedAt',extract(epoch from own.saved_at)*1000) end,
      'value',cp.value,'receipt',cp.receipt,'servers',servers);
end $$;
revoke all on function public.etb_cluster(text,text,text,jsonb) from public, anon, authenticated;
-- Publishable requests run as anon. The mandatory capability check above is the
-- authorization boundary; no table, arbitrary SQL, user or admin access is granted.
grant execute on function public.etb_cluster(text,text,text,jsonb) to anon;
