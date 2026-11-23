begin;
do $$
declare
  propietario uuid := gen_random_uuid();
  archivo_a uuid := gen_random_uuid();
  archivo_b uuid := gen_random_uuid();
  anterior uuid := gen_random_uuid();
  actual uuid := gen_random_uuid();
  enlace_b uuid := gen_random_uuid();
  rechazado boolean := false;
  panel jsonb;
begin
  insert into auth.users(id) values(propietario);
  insert into public.archivos(id, propietario_id, nombre_original, tipo_mime, tamano_bytes, ruta_almacenamiento)
  values(archivo_a, propietario, 'actual-A.pdf', 'application/pdf', 1, 'prueba/' || archivo_a),
        (archivo_b, propietario, 'actual-B.pdf', 'application/pdf', 1, 'prueba/' || archivo_b);
  insert into public.enlaces_compartidos(id,archivo_id,hash_token,creado_en,vence_en,maximo_descargas)
  values(anterior,archivo_a,anterior::text,now()-interval '12 days',now()+interval '2 days',5),
        (enlace_b,archivo_b,enlace_b::text,now(),now()+interval '1 day',5);
  begin
    insert into public.enlaces_compartidos(archivo_id,hash_token,vence_en,maximo_descargas)
    values(archivo_a,gen_random_uuid()::text,now()+interval '1 day',5);
  exception when raise_exception then rechazado := true;
  end;
  if not rechazado then raise exception 'Permitió dos configuraciones actuales'; end if;
  update public.enlaces_compartidos set revocado_en = now()-interval '11 days' where id = anterior;
  insert into public.enlaces_compartidos(id,archivo_id,hash_token,creado_en,vence_en,maximo_descargas)
  values(actual,archivo_a,actual::text,now()-interval '12 days',now()-interval '11 days',5);
  if (select count(*) from public.enlaces_compartidos where archivo_id=archivo_a and es_actual) <> 1 then
    raise exception 'No hay exactamente un enlace actual para A';
  end if;
  if not exists(select 1 from public.enlaces_compartidos where id=anterior and not es_actual and revocado_en is not null) then
    raise exception 'No conservó el historial revocado';
  end if;
  if not exists(select 1 from public.enlaces_compartidos where id=enlace_b and es_actual and revocado_en is null) then
    raise exception 'Cambiar A afectó a B';
  end if;
  if public.reservar_descarga(anterior::text,null,true)->>'estado' <> 'no_disponible' then
    raise exception 'Autorizó una URL histórica';
  end if;
  rechazado := false;
  begin
    update public.enlaces_compartidos set vence_en=now()+interval '1 day' where id=anterior;
  exception when raise_exception then rechazado := true;
  end;
  if not rechazado then raise exception 'Permitió editar el historial'; end if;
  if not exists(select 1 from public.candidatos_limpieza where id=archivo_a and eliminar_en=now()-interval '1 day') then
    raise exception 'La limpieza no usa la fecha del enlace actual';
  end if;
  panel := public.consultar_panel_admin('actual-A.pdf','Todos',1);
  if panel->'archivos'->0->>'enlaceId' <> actual::text then raise exception 'Admin no muestra el enlace actual'; end if;
  -- Las reservas anteriores también impiden borrar el objeto compartido.
  insert into public.reservas_descarga(enlace_id) values(anterior);
  if public.reclamar_limpieza(archivo_a) is not null then raise exception 'Ignoró una reserva histórica'; end if;
  update public.enlaces_compartidos set vence_en=now()+interval '1 day', maximo_descargas=6 where id=actual;
  if exists(select 1 from public.candidatos_limpieza where id=archivo_a) then raise exception 'La edición actual no canceló limpieza'; end if;
  raise notice 'Pruebas de configuración actual completadas';
end;
$$;
rollback;
