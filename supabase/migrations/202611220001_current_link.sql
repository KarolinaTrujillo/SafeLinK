-- Una configuración actual por archivo. No borra archivos ni su historial.
-- Los enlaces históricos dejan de autorizar nuevas descargas al aplicar esta migración.
begin;
lock table public.enlaces_compartidos in access exclusive mode;
alter table public.enlaces_compartidos add column es_actual boolean not null default false;

-- Coincide con el criterio que usaba la pantalla antes de esta migración.
with ordenados as (
  select id, row_number() over(partition by archivo_id
    order by actualizado_en desc, creado_en desc, id desc) as posicion
  from public.enlaces_compartidos
)
update public.enlaces_compartidos e set es_actual = true
from ordenados o where e.id = o.id and o.posicion = 1;
update public.enlaces_compartidos set revocado_en = coalesce(revocado_en, clock_timestamp())
where not es_actual;
alter table public.enlaces_compartidos alter column es_actual set default true;
create unique index un_enlace_actual_por_archivo on public.enlaces_compartidos(archivo_id) where es_actual;

-- Una URL nueva solo se crea cuando la actual fue revocada explícitamente.
-- El bloqueo del archivo serializa dos creaciones para el mismo archivo.
create function public.proteger_enlace_actual()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from public.archivos where id = new.archivo_id for update;
    if not new.es_actual then raise exception 'Un enlace nuevo debe ser actual'; end if;
    if exists(select 1 from public.enlaces_compartidos
      where archivo_id = new.archivo_id and es_actual and revocado_en is null) then
      raise exception 'Edita la configuración actual del archivo';
    end if;
    update public.enlaces_compartidos set es_actual = false
      where archivo_id = new.archivo_id and es_actual;
  else
    if not old.es_actual then raise exception 'El enlace pertenece al historial'; end if;
    if new.archivo_id is distinct from old.archivo_id then raise exception 'No se permite cambiar el archivo'; end if;
    if old.revocado_en is not null and new.revocado_en is distinct from old.revocado_en then
      raise exception 'Un enlace revocado no puede reactivarse';
    end if;
    if not new.es_actual and old.revocado_en is null then raise exception 'Revoca el enlace antes de reemplazarlo'; end if;
  end if;
  return new;
end;
$$;
create trigger comprobar_enlace_actual before insert or update of es_actual, archivo_id,
  vence_en, maximo_descargas, hash_contrasena, hash_token, revocado_en
on public.enlaces_compartidos for each row execute function public.proteger_enlace_actual();
revoke all on function public.proteger_enlace_actual() from public, anon, authenticated;

-- La fecha visible y la fecha usada por limpieza provienen del mismo enlace.
-- Una reserva de CUALQUIER enlace conserva el archivo hasta finalizar el envío.
create or replace view public.candidatos_limpieza as
select a.id, a.nombre_original, a.ruta_almacenamiento, a.estado_limpieza,
  least(e.vence_en, coalesce(e.revocado_en, e.vence_en)) + interval '10 days' as eliminar_en,
  (select count(*) from public.reservas_descarga r join public.enlaces_compartidos er on er.id = r.enlace_id
    where er.archivo_id = a.id) as reservas
from public.archivos a join public.enlaces_compartidos e on e.archivo_id = a.id and e.es_actual
where e.revocado_en is not null or e.vence_en <= now();

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
  select * into enlace from public.enlaces_compartidos where hash_token = p_hash_token for update;
  if not found then return jsonb_build_object('estado', 'no_disponible'); end if;
  select * into archivo from public.archivos where id = enlace.archivo_id;
  if not found or not enlace.es_actual or archivo.estado_limpieza <> 'activo' or enlace.revocado_en is not null
    or enlace.vence_en <= clock_timestamp() or enlace.descargas_realizadas >= enlace.maximo_descargas then
    return jsonb_build_object('estado', 'no_disponible');
  end if;
  if enlace.bloqueado_hasta > clock_timestamp() then
    return jsonb_build_object('estado', 'bloqueado', 'reintentarEn', enlace.bloqueado_hasta);
  end if;
  -- Una edición concurrente de la contraseña requiere comprobarla de nuevo.
  if enlace.hash_contrasena is distinct from p_hash_contrasena then
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

-- Consultas administrativas agregadas. Express comprueba primero el rol.
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
      'rechazos', (select count(*) from public.eventos_acceso where resultado = 'rechazado' and creado_en >= now() - interval '60 days')
    ),
    'conteos', (select jsonb_build_object('Todos', count(*), 'Activo', count(*) filter(where estado = 'Activo'),
      'Revocado', count(*) filter(where estado = 'Revocado'), 'Vencido', count(*) filter(where estado = 'Vencido'),
      'Agotado', count(*) filter(where estado = 'Agotado'), 'Sin enlace', count(*) filter(where estado = 'Sin enlace')) from buscados),
    'total', (select count(*) from filtrados),
    'archivos', coalesce((select jsonb_agg(to_jsonb(pagina) order by "creadoEn" desc, id) from pagina), '[]'::jsonb)
  );
$$;

-- Revocación y evento en la misma transacción. El administrador no recibe secretos.
create or replace function public.revocar_enlace_admin(p_enlace_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  enlace public.enlaces_compartidos%rowtype;
begin
  select * into enlace from public.enlaces_compartidos where id = p_enlace_id for update;
  if not found or not enlace.es_actual then return false; end if;
  if enlace.revocado_en is null then
    update public.enlaces_compartidos set revocado_en = clock_timestamp(), actualizado_en = clock_timestamp()
      where id = enlace.id;
    insert into public.eventos_acceso(enlace_id, archivo_id, tipo_evento, resultado, motivo)
      values(enlace.id, enlace.archivo_id, 'revocacion', 'exitoso', 'Revocación administrativa');
  end if;
  return true;
end;
$$;

revoke all on function public.consultar_panel_admin(text, text, integer), public.revocar_enlace_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.consultar_panel_admin(text, text, integer), public.revocar_enlace_admin(uuid)
  to service_role;

-- Recalcular las fechas guardadas sin reclamar ni borrar archivos.
select public.preparar_limpieza();
commit;
