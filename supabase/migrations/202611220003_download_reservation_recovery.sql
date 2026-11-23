-- Requiere todas las migraciones anteriores. No programa ni ejecuta recuperaciones.
-- PostgreSQL exige confirmar un valor enum nuevo antes de poder utilizarlo.
begin;
alter type public.resultado_evento add value if not exists 'no_confirmado';
commit;

begin;
alter table public.reservas_descarga
  add column expira_en timestamptz not null default (clock_timestamp() + interval '2 minutes'),
  add column limite_en timestamptz not null default (clock_timestamp() + interval '10 minutes');
-- Reservas anteriores a esta actualización: margen para desplegar el nuevo backend.
update public.reservas_descarga set expira_en = clock_timestamp() + interval '15 minutes',
  limite_en = clock_timestamp() + interval '15 minutes';
create index idx_reservas_vencimiento on public.reservas_descarga(expira_en);

create function public.renovar_reserva_descarga(p_reserva_id uuid)
returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare enlace_uuid uuid; archivo_uuid uuid;
begin
  select r.enlace_id, e.archivo_id into enlace_uuid, archivo_uuid
    from public.reservas_descarga r join public.enlaces_compartidos e on e.id = r.enlace_id
    where r.id = p_reserva_id;
  if not found then return false; end if;
  -- Mismo orden que autorización/eliminación: archivo, enlace, reserva.
  perform 1 from public.archivos where id = archivo_uuid for key share;
  if not found then return false; end if;
  perform 1 from public.enlaces_compartidos where id = enlace_uuid for update;
  update public.reservas_descarga set expira_en = least(limite_en, clock_timestamp() + interval '2 minutes')
    where id = p_reserva_id and expira_en > clock_timestamp() and limite_en > clock_timestamp();
  return found;
end;
$$;

-- La ausencia de la reserva significa que ya se cerró: los reintentos no duplican cupos/eventos.
create function public.cerrar_reserva_descarga(p_reserva_id uuid, p_resultado text, p_solo_vencida boolean default false)
returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  enlace_uuid uuid; archivo_uuid uuid; vencimiento timestamptz; resultado_final text;
begin
  if p_resultado is null or p_resultado not in ('exitoso', 'fallido', 'no_confirmado') then
    raise exception 'Resultado de descarga inválido';
  end if;
  select r.enlace_id, e.archivo_id into enlace_uuid, archivo_uuid
    from public.reservas_descarga r join public.enlaces_compartidos e on e.id = r.enlace_id
    where r.id = p_reserva_id;
  if not found then return false; end if;
  if p_solo_vencida then
    perform 1 from public.archivos where id = archivo_uuid for key share skip locked;
    if not found then return false; end if;
    perform 1 from public.enlaces_compartidos where id = enlace_uuid for update skip locked;
    if not found then return false; end if;
  else
    perform 1 from public.archivos where id = archivo_uuid for key share;
    if not found then return false; end if;
    perform 1 from public.enlaces_compartidos where id = enlace_uuid for update;
  end if;
  select expira_en into vencimiento from public.reservas_descarga where id = p_reserva_id for update;
  if not found then return false; end if;
  if p_solo_vencida and vencimiento > clock_timestamp() then return false; end if;
  -- Un cierre tardío no puede liberar una reserva cuyo resultado ya es incierto.
  resultado_final := case when vencimiento <= clock_timestamp() then 'no_confirmado' else p_resultado end;
  delete from public.reservas_descarga where id = p_reserva_id;
  if resultado_final <> 'fallido' then
    update public.enlaces_compartidos set descargas_realizadas = descargas_realizadas + 1 where id = enlace_uuid;
    insert into public.eventos_acceso(enlace_id, archivo_id, tipo_evento, resultado, motivo)
      values(enlace_uuid, archivo_uuid, 'descarga', resultado_final::public.resultado_evento,
        case when resultado_final = 'no_confirmado' then 'Resultado no confirmado; cupo consumido por seguridad' else null end);
  end if;
  return true;
end;
$$;

-- Compatibilidad con el backend anterior durante el despliegue.
create or replace function public.finalizar_descarga(p_reserva_id uuid, p_exito boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.cerrar_reserva_descarga(p_reserva_id, case when p_exito then 'exitoso' else 'fallido' end);
end;
$$;

create function public.recuperar_reservas_descarga(p_limite integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare reserva_uuid uuid; recuperadas integer := 0;
begin
  for reserva_uuid in select id from public.reservas_descarga where expira_en <= clock_timestamp()
    order by expira_en, id limit greatest(1, least(coalesce(p_limite, 100), 1000))
  loop
    begin
      -- Revalida después de bloquear: una renovación concurrente gana si no venció.
      if public.cerrar_reserva_descarga(reserva_uuid, 'no_confirmado', true) then
        recuperadas := recuperadas + 1;
      end if;
    exception when lock_not_available or deadlock_detected then
      -- Otra transacción está usando el archivo: reintentar en la siguiente ejecución.
      null;
    end;
  end loop;
  return recuperadas;
end;
$$;

revoke all on function public.renovar_reserva_descarga(uuid),
  public.cerrar_reserva_descarga(uuid, text, boolean), public.recuperar_reservas_descarga(integer)
  from public, anon, authenticated;
grant execute on function public.renovar_reserva_descarga(uuid),
  public.cerrar_reserva_descarga(uuid, text, boolean), public.recuperar_reservas_descarga(integer)
  to service_role;
commit;
