begin;
alter table public.archivos add column limpieza_token uuid;
alter table public.archivos add column limpieza_reclamada_en timestamptz;

create view public.candidatos_limpieza as
select a.id, a.nombre_original, a.ruta_almacenamiento, a.estado_limpieza,
  max(least(e.vence_en, coalesce(e.revocado_en, e.vence_en))) + interval '10 days' as eliminar_en,
  (select count(*) from public.reservas_descarga r join public.enlaces_compartidos er on er.id = r.enlace_id
    where er.archivo_id = a.id) as reservas
from public.archivos a join public.enlaces_compartidos e on e.archivo_id = a.id
group by a.id
having bool_and(e.revocado_en is not null or e.vence_en <= now());
revoke all on public.candidatos_limpieza from public, anon, authenticated;
grant select on public.candidatos_limpieza to service_role;

create function public.proteger_archivo_en_limpieza()
returns trigger language plpgsql security definer set search_path = '' as $$
declare estado public.estado_limpieza;
begin
  if tg_op = 'UPDATE' and new.archivo_id is distinct from old.archivo_id then
    raise exception 'No se permite cambiar el archivo de un enlace';
  end if;
  select estado_limpieza into estado from public.archivos where id = new.archivo_id for update;
  if not found then raise exception 'Archivo no disponible'; end if;
  if estado = 'pendiente_limpieza' and new.revocado_en is null and new.vence_en > now() then
    raise exception 'El archivo está en proceso de eliminación';
  end if;
  if estado = 'activo' and new.revocado_en is null and new.vence_en > now() then
    update public.archivos set limpieza_programada_en = null where id = new.archivo_id;
  end if;
  return new;
end;
$$;
create trigger proteger_archivo_en_limpieza before insert or update of archivo_id, vence_en, revocado_en
  on public.enlaces_compartidos for each row execute function public.proteger_archivo_en_limpieza();

create function public.proteger_reserva_en_limpieza()
returns trigger language plpgsql security definer set search_path = '' as $$
declare estado public.estado_limpieza;
begin
  select a.estado_limpieza into estado from public.archivos a
    join public.enlaces_compartidos e on e.archivo_id = a.id where e.id = new.enlace_id for share of a;
  if not found or estado <> 'activo' then raise exception 'Archivo no disponible'; end if;
  return new;
end;
$$;
create trigger proteger_reserva_en_limpieza before insert on public.reservas_descarga
  for each row execute function public.proteger_reserva_en_limpieza();

create function public.revisar_limpieza()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'corteEventos', now() - interval '60 days',
    'eventosVencidos', (select count(*) from public.eventos_acceso where creado_en < now() - interval '60 days'),
    'archivosVencidos', (select count(*) from public.candidatos_limpieza where eliminar_en <= now()),
    'pendientesPorReservas', (select count(*) from public.candidatos_limpieza where eliminar_en <= now() and reservas > 0),
    'archivos', coalesce((select jsonb_agg(to_jsonb(c)) from (
      select c.id, c.nombre_original as nombre, c.eliminar_en as "eliminarEn", c.reservas,
        c.estado_limpieza as estado from public.candidatos_limpieza c
      where c.eliminar_en <= now() and c.reservas = 0
        and not exists(select 1 from public.archivos a where a.id = c.id and a.limpieza_token is not null
          and a.limpieza_reclamada_en > now() - interval '15 minutes')
      order by c.eliminar_en, c.id limit 20
    ) c), '[]'::jsonb)
  );
$$;

create function public.preparar_limpieza()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.archivos a set limpieza_programada_en = c.eliminar_en
    from public.candidatos_limpieza c where a.id = c.id and a.estado_limpieza = 'activo'
      and a.limpieza_programada_en is distinct from c.eliminar_en;
  update public.archivos a set limpieza_programada_en = null
    where a.estado_limpieza = 'activo' and a.limpieza_programada_en is not null
      and not exists(select 1 from public.candidatos_limpieza c where c.id = a.id);
end;
$$;

create function public.reclamar_limpieza(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  archivo public.archivos%rowtype;
  candidato public.candidatos_limpieza%rowtype;
  token uuid;
begin
  select * into archivo from public.archivos where id = p_id for update skip locked;
  if not found then return null; end if;
  if archivo.limpieza_token is not null and archivo.limpieza_reclamada_en > now() - interval '15 minutes' then return null; end if;
  select * into candidato from public.candidatos_limpieza where id = p_id;
  if not found or candidato.eliminar_en > now() or candidato.reservas > 0 then return null; end if;
  token := gen_random_uuid();
  update public.archivos set estado_limpieza = 'pendiente_limpieza', limpieza_programada_en = candidato.eliminar_en,
    limpieza_token = token, limpieza_reclamada_en = now(), intentos_limpieza = intentos_limpieza + 1,
    ultimo_error_limpieza = null where id = p_id;
  return jsonb_build_object('id', p_id, 'ruta', archivo.ruta_almacenamiento, 'token', token);
end;
$$;

create function public.cerrar_limpieza(p_id uuid, p_token uuid, p_exito boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare archivo public.archivos%rowtype;
begin
  select * into archivo from public.archivos where id = p_id for update;
  if not found then return true; end if;
  if archivo.limpieza_token is distinct from p_token or archivo.estado_limpieza <> 'pendiente_limpieza' then return false; end if;
  if not p_exito then
    update public.archivos set ultimo_error_limpieza = 'No se pudo eliminar el objeto de Storage',
      limpieza_token = null, limpieza_reclamada_en = null where id = p_id;
    insert into public.eventos_acceso(archivo_id, tipo_evento, resultado, motivo)
      values(p_id, 'limpieza', 'rechazado', 'Error de Storage; se reintentará');
    return false;
  end if;
  if not exists(select 1 from public.candidatos_limpieza where id = p_id and eliminar_en <= now() and reservas = 0) then
    raise exception 'El archivo no cumple las condiciones de limpieza';
  end if;
  insert into public.eventos_acceso(archivo_id, tipo_evento, resultado, motivo)
    values(p_id, 'limpieza', 'exitoso', 'Eliminación por retención de 10 días');
  delete from public.archivos where id = p_id;
  return true;
end;
$$;

create function public.purgar_eventos_vencidos()
returns integer language plpgsql security definer set search_path = '' as $$
declare cantidad integer;
begin
  delete from public.eventos_acceso where id in (
    select id from public.eventos_acceso where creado_en < now() - interval '60 days'
      order by creado_en, id limit 5000
  );
  get diagnostics cantidad = row_count;
  return cantidad;
end;
$$;

revoke all on function public.proteger_archivo_en_limpieza(), public.proteger_reserva_en_limpieza(),
  public.revisar_limpieza(), public.preparar_limpieza(), public.reclamar_limpieza(uuid),
  public.cerrar_limpieza(uuid, uuid, boolean), public.purgar_eventos_vencidos() from public, anon, authenticated;
grant execute on function public.revisar_limpieza(), public.preparar_limpieza(), public.reclamar_limpieza(uuid),
  public.cerrar_limpieza(uuid, uuid, boolean), public.purgar_eventos_vencidos() to service_role;
commit;
