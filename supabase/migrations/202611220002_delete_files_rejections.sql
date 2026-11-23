begin;
alter table public.archivos add column eliminacion_solicitada_en timestamptz;

create function public.registrar_rechazo_descarga(p_enlace_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  archivo_uuid uuid;
  enlace_uuid uuid;
begin
  if p_motivo not in ('Enlace no disponible', 'Enlace vencido', 'Enlace revocado',
    'Límite de descargas alcanzado', 'Bloqueo temporal', 'Descargas en curso',
    'Configuración cambiada', 'Contraseña inválida', 'Archivo no disponible') or p_motivo is null then
    raise exception 'Motivo de rechazo inválido';
  end if;
  select archivo_id into archivo_uuid from public.enlaces_compartidos where id = p_enlace_id;
  if found then
    perform 1 from public.archivos where id = archivo_uuid for key share;
    if found then
      select id into enlace_uuid from public.enlaces_compartidos where id = p_enlace_id for key share;
      if not found then archivo_uuid := null; end if;
    else
      archivo_uuid := null;
    end if;
  end if;
  insert into public.eventos_acceso(enlace_id, archivo_id, tipo_evento, resultado, motivo)
    values(enlace_uuid, archivo_uuid, 'descarga', 'rechazado', p_motivo);
end;
$$;

create or replace function public.proteger_archivo_en_limpieza()
returns trigger language plpgsql security definer set search_path = '' as $$
declare estado public.estado_limpieza;
begin
  if tg_op = 'UPDATE' and new.archivo_id is distinct from old.archivo_id then
    raise exception 'No se permite cambiar el archivo de un enlace';
  end if;
  select estado_limpieza into estado from public.archivos where id = new.archivo_id for no key update;
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
create or replace function public.proteger_reserva_en_limpieza()
returns trigger language plpgsql security definer set search_path = '' as $$
declare estado public.estado_limpieza;
begin
  select a.estado_limpieza into estado from public.archivos a
    join public.enlaces_compartidos e on e.archivo_id = a.id where e.id = new.enlace_id for key share of a;
  if not found or estado <> 'activo' then raise exception 'Archivo no disponible'; end if;
  return new;
end;
$$;
create or replace view public.candidatos_limpieza as
select a.id, a.nombre_original, a.ruta_almacenamiento, a.estado_limpieza,
  case when a.eliminacion_solicitada_en is not null then a.eliminacion_solicitada_en
    else least(e.vence_en, coalesce(e.revocado_en, e.vence_en)) + interval '10 days' end as eliminar_en,
  (select count(*) from public.reservas_descarga r join public.enlaces_compartidos er on er.id = r.enlace_id
    where er.archivo_id = a.id) as reservas
from public.archivos a left join public.enlaces_compartidos e on e.archivo_id = a.id and e.es_actual
where a.eliminacion_solicitada_en is not null or e.revocado_en is not null or e.vence_en <= now();

create function public.solicitar_eliminacion_archivo(p_id uuid, p_propietario_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  archivo public.archivos%rowtype;
  token uuid;
begin
  select * into archivo from public.archivos
    where id = p_id and propietario_id = p_propietario_id for update;
  if not found then return jsonb_build_object('estado', 'no_disponible'); end if;
  if (archivo.limpieza_token is not null and archivo.limpieza_reclamada_en > now() - interval '15 minutes')
    or (archivo.estado_limpieza = 'pendiente_limpieza' and archivo.eliminacion_solicitada_en is null) then
    return jsonb_build_object('estado', 'en_proceso');
  end if;
  if exists(select 1 from public.reservas_descarga r
    join public.enlaces_compartidos e on e.id = r.enlace_id where e.archivo_id = p_id) then
    return jsonb_build_object('estado', 'ocupado');
  end if;
  token := gen_random_uuid();
  update public.archivos set estado_limpieza = 'pendiente_limpieza',
    eliminacion_solicitada_en = coalesce(eliminacion_solicitada_en, now()),
    limpieza_programada_en = coalesce(eliminacion_solicitada_en, now()),
    limpieza_token = token, limpieza_reclamada_en = now(),
    intentos_limpieza = intentos_limpieza + 1, ultimo_error_limpieza = null where id = p_id;
  return jsonb_build_object('estado', 'preparado', 'id', p_id, 'ruta', archivo.ruta_almacenamiento, 'token', token);
end;
$$;

create or replace function public.cerrar_limpieza(p_id uuid, p_token uuid, p_exito boolean)
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
      values(p_id, case when archivo.eliminacion_solicitada_en is not null then 'eliminacion'::public.tipo_evento else 'limpieza'::public.tipo_evento end, 'rechazado', 'Error de Storage; se reintentará');
    return false;
  end if;
  if not exists(select 1 from public.candidatos_limpieza where id = p_id and eliminar_en <= now() and reservas = 0) then
    raise exception 'El archivo no cumple las condiciones de limpieza';
  end if;
  insert into public.eventos_acceso(archivo_id, tipo_evento, resultado, motivo)
    values(p_id, case when archivo.eliminacion_solicitada_en is not null then 'eliminacion'::public.tipo_evento else 'limpieza'::public.tipo_evento end, 'exitoso',
      case when archivo.eliminacion_solicitada_en is not null then 'Eliminación solicitada por el propietario' else 'Eliminación por retención de 10 días' end);
  delete from public.archivos where id = p_id;
  return true;
end;
$$;

create or replace function public.reservar_descarga(p_hash_token text, p_hash_contrasena text, p_clave_valida boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  enlace public.enlaces_compartidos%rowtype;
  archivo public.archivos%rowtype;
  reserva uuid;
  fallos integer;
  nivel integer;
  minutos integer;
begin
  select * into enlace from public.enlaces_compartidos where hash_token = p_hash_token;
  if not found then
    perform public.registrar_rechazo_descarga(null, 'Enlace no disponible');
    return jsonb_build_object('estado', 'no_disponible');
  end if;
  select * into archivo from public.archivos where id = enlace.archivo_id for key share;
  if not found then
    perform public.registrar_rechazo_descarga(null, 'Archivo no disponible');
    return jsonb_build_object('estado', 'no_disponible');
  end if;
  select * into enlace from public.enlaces_compartidos where hash_token = p_hash_token for update;
  if not found then
    perform public.registrar_rechazo_descarga(null, 'Enlace no disponible');
    return jsonb_build_object('estado', 'no_disponible');
  end if;
  if not enlace.es_actual or archivo.estado_limpieza <> 'activo' or enlace.revocado_en is not null
    or enlace.vence_en <= clock_timestamp() or enlace.descargas_realizadas >= enlace.maximo_descargas then
    perform public.registrar_rechazo_descarga(enlace.id, case
      when not enlace.es_actual then 'Enlace no disponible'
      when archivo.estado_limpieza <> 'activo' then 'Archivo no disponible'
      when enlace.revocado_en is not null then 'Enlace revocado'
      when enlace.vence_en <= clock_timestamp() then 'Enlace vencido'
      else 'Límite de descargas alcanzado' end);
    return jsonb_build_object('estado', 'no_disponible');
  end if;
  if enlace.bloqueado_hasta > clock_timestamp() then
    perform public.registrar_rechazo_descarga(enlace.id, 'Bloqueo temporal');
    return jsonb_build_object('estado', 'bloqueado', 'reintentarEn', enlace.bloqueado_hasta);
  end if;
  if enlace.hash_contrasena is distinct from p_hash_contrasena then
    perform public.registrar_rechazo_descarga(enlace.id, 'Configuración cambiada');
    return jsonb_build_object('estado', 'configuracion_cambiada');
  end if;
  if enlace.hash_contrasena is not null and not p_clave_valida then
    fallos := enlace.intentos_fallidos + 1;
    if fallos >= 5 then
      nivel := least(enlace.nivel_bloqueo + 1, 3);
      minutos := case nivel when 1 then 1 when 2 then 5 else 15 end;
      update public.enlaces_compartidos set intentos_fallidos = 0, nivel_bloqueo = nivel,
        bloqueado_hasta = clock_timestamp() + make_interval(mins => minutos) where id = enlace.id;
    else
      update public.enlaces_compartidos set intentos_fallidos = fallos where id = enlace.id;
    end if;
    insert into public.eventos_acceso(enlace_id, archivo_id, tipo_evento, resultado, motivo)
      values(enlace.id, archivo.id, 'intento_contrasena', 'rechazado', 'Contraseña incorrecta');
    if fallos >= 5 then
      return jsonb_build_object('estado', 'bloqueado', 'reintentarEn', clock_timestamp() + make_interval(mins => minutos));
    end if;
    return jsonb_build_object('estado', 'clave_incorrecta', 'intentosRestantes', 5 - fallos);
  end if;
  if enlace.descargas_realizadas + (select count(*) from public.reservas_descarga where enlace_id = enlace.id) >= enlace.maximo_descargas then
    perform public.registrar_rechazo_descarga(enlace.id, 'Descargas en curso');
    return jsonb_build_object('estado', 'ocupado');
  end if;
  update public.enlaces_compartidos set intentos_fallidos = 0, nivel_bloqueo = 0,
    bloqueado_hasta = null where id = enlace.id;
  insert into public.reservas_descarga(enlace_id) values(enlace.id) returning id into reserva;
  return jsonb_build_object('estado', 'autorizado', 'reservaId', reserva,
    'ruta', archivo.ruta_almacenamiento, 'nombre', archivo.nombre_original,
    'tipoMime', archivo.tipo_mime, 'tamanoBytes', archivo.tamano_bytes);
end;
$$;

create or replace function public.consultar_panel_admin(p_busqueda text default '', p_estado text default 'Todos', p_pagina integer default 1)
returns jsonb language sql stable security definer set search_path = '' as $$
  with datos as (
    select a.id, a.nombre_original as nombre, a.tipo_mime as "tipoMime", a.tamano_bytes as "tamanoBytes",
      a.creado_en as "creadoEn", 'usr_' || left(replace(a.propietario_id::text, '-', ''), 12) as propietario,
      e.id as "enlaceId", e.descargas_realizadas as "descargasRealizadas", e.maximo_descargas as "maximoDescargas",
      e.vence_en as "venceEn", a.estado_limpieza as "estadoLimpieza",
      case when e.id is null then 'Sin enlace'
        when e.revocado_en is not null then 'Revocado'
        when e.vence_en <= now() then 'Vencido'
        when e.descargas_realizadas >= e.maximo_descargas then 'Agotado'
        else 'Activo' end as estado
    from public.archivos a
    left join lateral (
      select id, descargas_realizadas, maximo_descargas, vence_en, revocado_en
      from public.enlaces_compartidos where archivo_id = a.id and es_actual
      order by actualizado_en desc, creado_en desc, id desc limit 1
    ) e on true
  ), buscados as (
    select * from datos where position(lower(left(coalesce(p_busqueda, ''), 150)) in lower(nombre || ' ' || propietario)) > 0
  ), filtrados as (
    select * from buscados where p_estado = 'Todos' or estado = p_estado
  ), pagina as (
    select * from filtrados order by "creadoEn" desc, id
    limit 10 offset (greatest(1, least(p_pagina, 100000)) - 1) * 10
  )
  select jsonb_build_object(
    'metricas', jsonb_build_object(
      'archivos', (select count(*) from public.archivos),
      'usuarios', (select count(*) from public.perfiles),
      'descargas', (select count(*) from public.eventos_acceso where tipo_evento = 'descarga' and resultado = 'exitoso' and creado_en >= now() - interval '60 days'),
      'rechazos', (select count(*) from public.eventos_acceso where resultado = 'rechazado' and tipo_evento in ('descarga', 'intento_contrasena') and creado_en >= now() - interval '60 days')
    ),
    'conteos', (select jsonb_build_object('Todos', count(*), 'Activo', count(*) filter(where estado = 'Activo'),
      'Revocado', count(*) filter(where estado = 'Revocado'), 'Vencido', count(*) filter(where estado = 'Vencido'),
      'Agotado', count(*) filter(where estado = 'Agotado'), 'Sin enlace', count(*) filter(where estado = 'Sin enlace')) from buscados),
    'total', (select count(*) from filtrados),
    'archivos', coalesce((select jsonb_agg(to_jsonb(pagina) order by "creadoEn" desc, id) from pagina), '[]'::jsonb)
  );
$$;


revoke all on function public.registrar_rechazo_descarga(uuid, text),
  public.solicitar_eliminacion_archivo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.registrar_rechazo_descarga(uuid, text),
  public.solicitar_eliminacion_archivo(uuid, uuid) to service_role;
commit;
