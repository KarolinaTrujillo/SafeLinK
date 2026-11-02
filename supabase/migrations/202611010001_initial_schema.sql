-- SafeLinK: esquema inicial propio de la aplicación.
-- auth.users y storage.objects son recursos administrados por Supabase.
-- Las escrituras y operaciones con Storage se realizan únicamente desde la API
-- de confianza (backend); la clave service_role nunca debe llegar al navegador.

create type public.rol_usuario as enum ('usuario', 'administrador');
create type public.estado_limpieza as enum ('activo', 'pendiente_limpieza');
create type public.tipo_evento as enum (
  'descarga',
  'intento_contrasena',
  'revocacion',
  'eliminacion',
  'limpieza'
);
create type public.resultado_evento as enum ('exitoso', 'rechazado');

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol public.rol_usuario not null default 'usuario',
  creado_en timestamptz not null default now()
);

create table public.archivos (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references auth.users (id) on delete restrict,
  nombre_original text not null check (length(nombre_original) between 1 and 255),
  tipo_mime text not null check (
    tipo_mime in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  tamano_bytes bigint not null check (tamano_bytes between 1 and 10000000),
  ruta_almacenamiento text not null unique,
  estado_limpieza public.estado_limpieza not null default 'activo',
  limpieza_programada_en timestamptz,
  intentos_limpieza integer not null default 0 check (intentos_limpieza >= 0),
  ultimo_error_limpieza text,
  creado_en timestamptz not null default now()
);

create table public.enlaces_compartidos (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.archivos (id) on delete cascade,
  hash_token text not null unique,
  vence_en timestamptz not null,
  maximo_descargas integer not null check (maximo_descargas between 1 and 20),
  descargas_realizadas integer not null default 0 check (
    descargas_realizadas >= 0 and descargas_realizadas <= maximo_descargas
  ),
  hash_contrasena text,
  intentos_fallidos integer not null default 0 check (intentos_fallidos >= 0),
  nivel_bloqueo smallint not null default 0 check (nivel_bloqueo between 0 and 3),
  bloqueado_hasta timestamptz,
  revocado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint enlaces_vencimiento_valido check (
    vence_en > creado_en and vence_en <= creado_en + interval '15 days'
  )
);

create table public.eventos_acceso (
  id uuid primary key default gen_random_uuid(),
  enlace_id uuid references public.enlaces_compartidos (id) on delete set null,
  archivo_id uuid references public.archivos (id) on delete set null,
  tipo_evento public.tipo_evento not null,
  resultado public.resultado_evento not null,
  motivo text check (motivo is null or length(motivo) <= 500),
  creado_en timestamptz not null default now()
);

create index idx_archivos_propietario_creado
  on public.archivos (propietario_id, creado_en desc);
create index idx_archivos_limpieza_pendiente
  on public.archivos (estado_limpieza, limpieza_programada_en);
create index idx_enlaces_archivo_creado
  on public.enlaces_compartidos (archivo_id, creado_en desc);
create index idx_eventos_acceso_creado
  on public.eventos_acceso (creado_en desc);
create index idx_eventos_enlace_creado
  on public.eventos_acceso (enlace_id, creado_en desc);

-- Crear perfil de forma confiable al registrar una cuenta. El rol nunca viene
-- de los datos enviados por el cliente durante el registro.
create function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.crear_perfil_usuario() from public, anon, authenticated;

create trigger al_crear_usuario_crear_perfil
  after insert on auth.users
  for each row execute function public.crear_perfil_usuario();

-- La aplicación cliente usa Supabase Auth para autenticación, pero los datos
-- y Storage se consultan únicamente mediante la API Express. RLS queda sin
-- políticas para anon/authenticated (denegación por defecto); Express valida
-- JWT, propietario y rol antes de operar con su clave privada service_role.
alter table public.perfiles enable row level security;
alter table public.archivos enable row level security;
alter table public.enlaces_compartidos enable row level security;
alter table public.eventos_acceso enable row level security;

-- No depender de los grants automáticos de la Data API. Clientes anónimos y
-- autenticados no reciben acceso directo a estas tablas. La API Express será
-- responsable de aplicar las reglas de propietario y administrador.
revoke all on public.perfiles, public.archivos,
  public.enlaces_compartidos, public.eventos_acceso
  from public, anon, authenticated;
grant all on public.perfiles, public.archivos,
  public.enlaces_compartidos, public.eventos_acceso to service_role;

-- Bucket privado. No se crean políticas para acceso directo desde el cliente:
-- el backend valida propietario, enlace, contraseña y límites antes de usar Storage.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'safelink-files',
  'safelink-files',
  false,
  10000000,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
