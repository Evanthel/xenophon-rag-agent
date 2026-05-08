create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_path text not null unique,
  source_type text not null default 'file',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(384),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (document_id, chunk_index)
);

create index if not exists documents_source_path_idx on public.documents (source_path);
create index if not exists document_chunks_document_id_idx on public.document_chunks (document_id);
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_ip_ops);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

drop trigger if exists document_chunks_set_updated_at on public.document_chunks;
create trigger document_chunks_set_updated_at
before update on public.document_chunks
for each row
execute function public.set_updated_at();

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(384),
  match_count integer default 5,
  match_threshold double precision default 0.55
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  source_path text,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    c.id as chunk_id,
    c.document_id,
    d.title,
    d.source_path,
    c.chunk_index,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke all on public.documents from anon, authenticated;
revoke all on public.document_chunks from anon, authenticated;
revoke all on function public.match_document_chunks(extensions.vector(384), integer, double precision) from public, anon, authenticated;
grant execute on function public.match_document_chunks(extensions.vector(384), integer, double precision) to service_role;
