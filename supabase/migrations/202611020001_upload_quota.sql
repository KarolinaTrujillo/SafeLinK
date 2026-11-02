-- Registro seguro de metadatos de archivo.
-- El bloqueo del perfil serializa las cargas del mismo usuario para que no
-- puedan superar simultáneamente los límites de archivos y almacenamiento.
create or replace function public.registrar_archivo(
  p_id uuid,
  p_propietario_id uuid,
  p_nombre_original text,
  p_tipo_mime text,
  p_tamano_bytes bigint,
  p_ruta_almacenamiento text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archivos bigint;
  v_tamano_total bigint;
begin
  perform 1
  from public.perfiles
  where id = p_propietario_id
  for update;

  if not found then
    raise exception 'PERFIL_NO_ENCONTRADO';
  end if;

  if p_tamano_bytes < 1 or p_tamano_bytes > 10000000 then
    raise exception 'TAMANO_INVALIDO';
  end if;

  select count(*), coalesce(sum(tamano_bytes), 0)
    into v_archivos, v_tamano_total
  from public.archivos
  where propietario_id = p_propietario_id;

  if v_archivos >= 10 then
    raise exception 'CUPO_ARCHIVOS';
  end if;

  if v_tamano_total + p_tamano_bytes > 100000000 then
    raise exception 'CUPO_ALMACENAMIENTO';
  end if;

  insert into public.archivos (
    id, propietario_id, nombre_original, tipo_mime,
    tamano_bytes, ruta_almacenamiento
  ) values (
    p_id, p_propietario_id, p_nombre_original, p_tipo_mime,
    p_tamano_bytes, p_ruta_almacenamiento
  );

  return p_id;
end;
$$;

revoke all on function public.registrar_archivo(uuid, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.registrar_archivo(uuid, uuid, text, text, bigint, text)
  to service_role;
