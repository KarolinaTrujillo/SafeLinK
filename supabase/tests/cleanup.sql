begin;
do $$
declare
  propietario uuid := gen_random_uuid();
  viejo uuid := gen_random_uuid();
  sin_enlace uuid := gen_random_uuid();
  agotado uuid := gen_random_uuid();
  reservado uuid := gen_random_uuid();
  renovado uuid := gen_random_uuid();
  enlace_viejo uuid := gen_random_uuid();
  enlace_reservado uuid := gen_random_uuid();
  enlace_renovado uuid := gen_random_uuid();
  evento_viejo uuid := gen_random_uuid();
  evento_nuevo uuid := gen_random_uuid();
  reclamacion jsonb;
  segunda jsonb;
  intento_rechazado boolean := false;
begin
  insert into auth.users(id) values(propietario);
  insert into public.archivos(id, propietario_id, nombre_original, tipo_mime, tamano_bytes, ruta_almacenamiento)
    values (viejo, propietario, 'viejo.pdf', 'application/pdf', 1, 'prueba/' || viejo),
      (sin_enlace, propietario, 'sin.pdf', 'application/pdf', 1, 'prueba/' || sin_enlace),
      (agotado, propietario, 'agotado.pdf', 'application/pdf', 1, 'prueba/' || agotado),
      (reservado, propietario, 'reservado.pdf', 'application/pdf', 1, 'prueba/' || reservado),
      (renovado, propietario, 'renovado.pdf', 'application/pdf', 1, 'prueba/' || renovado);
  insert into public.enlaces_compartidos(id, archivo_id, hash_token, creado_en, vence_en, maximo_descargas, descargas_realizadas)
    values (enlace_viejo, viejo, enlace_viejo::text, now() - interval '12 days', now() - interval '11 days', 3, 0),
      (gen_random_uuid(), agotado, agotado::text, now() - interval '12 days', now() + interval '1 day', 3, 3),
      (enlace_reservado, reservado, enlace_reservado::text, now() - interval '12 days', now() - interval '11 days', 3, 0),
      (enlace_renovado, renovado, enlace_renovado::text, now() - interval '12 days', now() - interval '11 days', 3, 0);
  if exists(select 1 from public.candidatos_limpieza where id in (sin_enlace, agotado)) then raise exception 'Incluye archivos que deben conservarse'; end if;
  if not exists(select 1 from public.candidatos_limpieza where id = viejo and eliminar_en < now()) then raise exception 'No reconoce el archivo vencido hace más de 10 días'; end if;
  perform public.preparar_limpieza();
  update public.enlaces_compartidos set vence_en = now() + interval '1 day' where id = enlace_renovado;
  if exists(select 1 from public.candidatos_limpieza where id = renovado) then raise exception 'La renovación no cancela la selección'; end if;
  if exists(select 1 from public.archivos where id = renovado and limpieza_programada_en is not null) then raise exception 'No canceló el plazo programado'; end if;
  insert into public.reservas_descarga(enlace_id) values(enlace_reservado);
  if public.reclamar_limpieza(reservado) is not null then raise exception 'Reclamó un archivo con descarga en curso'; end if;
  reclamacion := public.reclamar_limpieza(viejo);
  if reclamacion is null then raise exception 'No reclamó el archivo elegible'; end if;
  segunda := public.reclamar_limpieza(viejo);
  if segunda is not null then raise exception 'Dos trabajadores reclamaron el mismo archivo'; end if;
  begin
    insert into public.enlaces_compartidos(archivo_id, hash_token, vence_en, maximo_descargas)
      values(viejo, gen_random_uuid()::text, now() + interval '1 day', 3);
  exception when raise_exception then intento_rechazado := true;
  end;
  if not intento_rechazado then raise exception 'Permitió reactivar un archivo reclamado'; end if;
  if public.cerrar_limpieza(viejo, gen_random_uuid(), true) then raise exception 'Aceptó el token de otro trabajador'; end if;
  perform public.cerrar_limpieza(viejo, (reclamacion->>'token')::uuid, false);
  if not exists(select 1 from public.archivos where id = viejo and estado_limpieza = 'pendiente_limpieza') then raise exception 'El fallo de Storage liberó el cupo'; end if;
  reclamacion := public.reclamar_limpieza(viejo);
  if not public.cerrar_limpieza(viejo, (reclamacion->>'token')::uuid, true) then raise exception 'No cerró el borrado'; end if;
  if exists(select 1 from public.archivos where id = viejo) then raise exception 'Conservó metadatos tras confirmar el borrado'; end if;
  if exists(select 1 from public.enlaces_compartidos where archivo_id = viejo) then raise exception 'Conservó el enlace de un archivo eliminado'; end if;
  insert into public.eventos_acceso(id,tipo_evento,resultado,creado_en)
    values(evento_viejo,'limpieza','exitoso',now()-interval '61 days'),
      (evento_nuevo,'limpieza','exitoso',now()-interval '59 days');
  perform public.purgar_eventos_vencidos();
  if exists(select 1 from public.eventos_acceso where id = evento_viejo) then raise exception 'No purgó el evento vencido'; end if;
  if not exists(select 1 from public.eventos_acceso where id = evento_nuevo) then raise exception 'Purgó un evento reciente'; end if;
  raise notice 'Pruebas SQL de limpieza completadas';
end;
$$;
rollback;
