-- Reserva y finalización de descargas. Solo Express usa estas funciones.
create table public.reservas_descarga (
  id uuid primary key default gen_random_uuid(),
  enlace_id uuid not null references public.enlaces_compartidos(id) on delete cascade,
  creado_en timestamptz not null default now()
);
alter table public.reservas_descarga enable row level security;
revoke all on public.reservas_descarga from public, anon, authenticated;
grant all on public.reservas_descarga to service_role;
create index idx_reservas_enlace on public.reservas_descarga(enlace_id);

create function public.reservar_descarga(p_hash_token text, p_hash_contrasena text, p_clave_valida boolean)
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
  if not found or archivo.estado_limpieza <> 'activo' or enlace.revocado_en is not null
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

create function public.finalizar_descarga(p_reserva_id uuid, p_exito boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  enlace_uuid uuid;
  archivo_uuid uuid;
  eliminadas integer;
begin
  select enlace_id into enlace_uuid from public.reservas_descarga where id = p_reserva_id;
  if not found then return; end if;
  select archivo_id into archivo_uuid from public.enlaces_compartidos where id = enlace_uuid for update;
  delete from public.reservas_descarga where id = p_reserva_id;
  get diagnostics eliminadas = row_count;
  if eliminadas = 0 then return; end if;
  if p_exito then
    update public.enlaces_compartidos set descargas_realizadas = descargas_realizadas + 1 where id = enlace_uuid;
    insert into public.eventos_acceso(enlace_id, archivo_id, tipo_evento, resultado)
      values(enlace_uuid, archivo_uuid, 'descarga', 'exitoso');
  end if;
end;
$$;

-- No permitir que una edición quite lugares ya reservados por una descarga.
create function public.proteger_cupo_reservado()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.maximo_descargas < new.descargas_realizadas +
      (select count(*) from public.reservas_descarga where enlace_id = new.id) then
    raise exception 'Hay descargas en curso. Intenta cambiar el límite después.';
  end if;
  return new;
end;
$$;
create trigger comprobar_cupo_reservado before update of maximo_descargas
  on public.enlaces_compartidos for each row execute function public.proteger_cupo_reservado();

revoke all on function public.reservar_descarga(text, text, boolean),
  public.finalizar_descarga(uuid, boolean), public.proteger_cupo_reservado() from public, anon, authenticated;
grant execute on function public.reservar_descarga(text, text, boolean),
  public.finalizar_descarga(uuid, boolean) to service_role;
