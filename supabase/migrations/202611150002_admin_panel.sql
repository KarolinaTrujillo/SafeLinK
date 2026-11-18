-- Consultas administrativas agregadas. Express comprueba primero el rol.
create function public.consultar_panel_admin(p_busqueda text default '', p_estado text default 'Todos', p_pagina integer default 1)
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
      from public.enlaces_compartidos where archivo_id = a.id
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
create function public.revocar_enlace_admin(p_enlace_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  enlace public.enlaces_compartidos%rowtype;
begin
  select * into enlace from public.enlaces_compartidos where id = p_enlace_id for update;
  if not found then return false; end if;
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
