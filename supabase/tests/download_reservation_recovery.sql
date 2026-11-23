-- SOLO en PostgreSQL local/de pruebas con todas las migraciones aplicadas.
-- Sin Storage, sin Cron, sin llamadas de red. Cambios revertidos al terminar.
begin;
do $$
declare
  usuario uuid := gen_random_uuid(); archivo uuid := gen_random_uuid(); enlace uuid := gen_random_uuid();
  reserva uuid; permiso jsonb; antes bigint; exitosas bigint; rechazos bigint; solicitud jsonb;
begin
  insert into auth.users(id) values(usuario);
  insert into public.archivos(id,propietario_id,nombre_original,tipo_mime,tamano_bytes,ruta_almacenamiento)
    values(archivo,usuario,'reserva.pdf','application/pdf',1,'prueba/'||archivo);
  insert into public.enlaces_compartidos(id,archivo_id,hash_token,vence_en,maximo_descargas)
    values(enlace,archivo,enlace::text,now()+interval '1 day',2);
  permiso := public.reservar_descarga(enlace::text,null,true);
  if permiso->>'estado' <> 'autorizado' then raise exception 'No reservó'; end if;
  reserva := (permiso->>'reservaId')::uuid;
  if not public.renovar_reserva_descarga(reserva) then raise exception 'No renueva activa'; end if;
  if (select expira_en > limite_en from public.reservas_descarga where id=reserva) then raise exception 'Renovación supera límite absoluto'; end if;
  perform public.recuperar_reservas_descarga(100);
  if not exists(select 1 from public.reservas_descarga where id=reserva) then raise exception 'Recuperó una activa'; end if;
  if public.cerrar_reserva_descarga(reserva,'no_confirmado',true) then raise exception 'Cerró activa en modo recuperación'; end if;
  if not public.cerrar_reserva_descarga(reserva,'fallido') then raise exception 'No cierra fallo conocido'; end if;
  if (select descargas_realizadas from public.enlaces_compartidos where id=enlace) <> 0 then raise exception 'Fallo consume cupo'; end if;
  if public.cerrar_reserva_descarga(reserva,'exitoso') then raise exception 'Repite cierre'; end if;

  permiso := public.reservar_descarga(enlace::text,null,true);
  reserva := (permiso->>'reservaId')::uuid;
  perform public.cerrar_reserva_descarga(reserva,'exitoso');
  perform public.finalizar_descarga(reserva,true);
  if (select descargas_realizadas from public.enlaces_compartidos where id=enlace) <> 1 then raise exception 'Éxito duplicado'; end if;
  exitosas := (public.consultar_panel_admin()#>>'{metricas,descargas}')::bigint;
  rechazos := (public.consultar_panel_admin()#>>'{metricas,rechazos}')::bigint;

  permiso := public.reservar_descarga(enlace::text,null,true);
  reserva := (permiso->>'reservaId')::uuid;
  update public.reservas_descarga set expira_en=clock_timestamp()-interval '1 second' where id=reserva;
  if public.renovar_reserva_descarga(reserva) then raise exception 'Revive una vencida'; end if;
  antes := (select count(*) from public.eventos_acceso where enlace_id=enlace);
  perform public.recuperar_reservas_descarga(100);
  if exists(select 1 from public.reservas_descarga where id=reserva) then raise exception 'No recuperó'; end if;
  if (select descargas_realizadas from public.enlaces_compartidos where id=enlace) <> 2 then raise exception 'No consume incierto'; end if;
  if not exists(select 1 from public.eventos_acceso where enlace_id=enlace and resultado='no_confirmado'
    and motivo='Resultado no confirmado; cupo consumido por seguridad') then raise exception 'No audita incertidumbre'; end if;
  perform public.recuperar_reservas_descarga(100);
  perform public.finalizar_descarga(reserva,false);
  if public.cerrar_reserva_descarga(reserva,'exitoso') then raise exception 'Repite recuperada'; end if;
  if (select count(*) from public.eventos_acceso where enlace_id=enlace) <> antes+1 then raise exception 'Duplica evento'; end if;
  if (public.consultar_panel_admin()#>>'{metricas,descargas}')::bigint <> exitosas then raise exception 'Incierta aparece exitosa'; end if;
  if (public.consultar_panel_admin()#>>'{metricas,rechazos}')::bigint <> rechazos then raise exception 'Incierta aparece rechazada'; end if;
  if public.reservar_descarga(enlace::text,null,true)->>'estado' <> 'no_disponible' then raise exception 'Superó límite tras recuperar'; end if;
  solicitud := public.solicitar_eliminacion_archivo(archivo,usuario);
  if solicitud->>'estado' <> 'preparado' then raise exception 'Reserva abandonada sigue impidiendo borrado'; end if;
  -- Simular fallo de Storage para mantener el objeto de prueba y no confirmar borrado real.
  perform public.cerrar_limpieza(archivo,(solicitud->>'token')::uuid,false);

  -- Un cierre tardío de fallo se convierte en incierto incluso antes de que pase Cron.
  update public.archivos set estado_limpieza='activo', eliminacion_solicitada_en=null where id=archivo;
  update public.enlaces_compartidos set maximo_descargas=3 where id=enlace;
  permiso := public.reservar_descarga(enlace::text,null,true);
  reserva := (permiso->>'reservaId')::uuid;
  update public.reservas_descarga set expira_en=clock_timestamp()-interval '1 second' where id=reserva;
  perform public.cerrar_reserva_descarga(reserva,'fallido');
  if (select descargas_realizadas from public.enlaces_compartidos where id=enlace) <> 3 then raise exception 'Cierre tardío liberó cupo incierto'; end if;
  if public.renovar_reserva_descarga(gen_random_uuid()) then raise exception 'Renueva inexistente'; end if;
  if has_function_privilege('anon','public.renovar_reserva_descarga(uuid)','execute')
    or has_function_privilege('authenticated','public.cerrar_reserva_descarga(uuid,text,boolean)','execute')
    or has_function_privilege('anon','public.recuperar_reservas_descarga(integer)','execute') then raise exception 'RPC expuesta al cliente'; end if;
end;
$$;
rollback;
