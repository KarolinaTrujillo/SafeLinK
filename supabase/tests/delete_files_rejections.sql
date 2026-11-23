begin;
do $$
declare
  propietario uuid := gen_random_uuid();
  ajeno uuid := gen_random_uuid();
  sin_enlace uuid := gen_random_uuid();
  compartido uuid := gen_random_uuid();
  enlace uuid := gen_random_uuid();
  permiso jsonb;
  solicitud jsonb;
  reintento jsonb;
  antes bigint;
  contador bigint;
begin
  insert into auth.users(id) values(propietario);
  insert into public.archivos(id,propietario_id,nombre_original,tipo_mime,tamano_bytes,ruta_almacenamiento)
    values(sin_enlace,propietario,'manual-sin-enlace.pdf','application/pdf',1,'prueba/'||sin_enlace),
          (compartido,propietario,'manual-compartido.pdf','application/pdf',1,'prueba/'||compartido);
  insert into public.enlaces_compartidos(id,archivo_id,hash_token,creado_en,vence_en,maximo_descargas,hash_contrasena)
    values(enlace,compartido,enlace::text,now()-interval '1 day',now()+interval '1 day',1,'hash-prueba');

  solicitud := public.solicitar_eliminacion_archivo(sin_enlace,ajeno);
  if solicitud->>'estado' <> 'no_disponible' then raise exception 'Otro propietario puede eliminar'; end if;
  if exists(select 1 from public.archivos where id=sin_enlace and estado_limpieza<>'activo') then raise exception 'Cambió el archivo ajeno'; end if;

  antes := (public.consultar_panel_admin()#>>'{metricas,rechazos}')::bigint;
  insert into public.eventos_acceso(archivo_id,tipo_evento,resultado,motivo)
    values(compartido,'limpieza','rechazado','Fallo operativo de prueba'),
          (compartido,'eliminacion','rechazado','Fallo operativo de prueba');
  if (public.consultar_panel_admin()#>>'{metricas,rechazos}')::bigint <> antes then raise exception 'Cuenta errores operativos como accesos'; end if;
  perform public.registrar_rechazo_descarga(null,'Enlace no disponible');
  if (public.consultar_panel_admin()#>>'{metricas,rechazos}')::bigint <> antes+1 then raise exception 'No cuenta rechazo de enlace desconocido'; end if;

  antes := (select count(*) from public.eventos_acceso where enlace_id=enlace and resultado='rechazado');
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',false);
  if permiso->>'estado' <> 'clave_incorrecta' then raise exception 'Aceptó clave incorrecta'; end if;
  contador := (select count(*) from public.eventos_acceso where enlace_id=enlace and resultado='rechazado');
  if contador <> antes+1 then raise exception 'Contraseña incorrecta duplicada o sin registrar'; end if;
  if (select descargas_realizadas from public.enlaces_compartidos where id=enlace) <> 0 then raise exception 'Un fallo consume descargas'; end if;

  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado' <> 'autorizado' then raise exception 'No autorizó la reserva'; end if;
  solicitud := public.solicitar_eliminacion_archivo(compartido,propietario);
  if solicitud->>'estado' <> 'ocupado' then raise exception 'Elimina con una descarga en curso'; end if;
  if exists(select 1 from public.archivos where id=compartido and eliminacion_solicitada_en is not null) then raise exception 'El intento con reservas desactiva el archivo'; end if;
  antes := (select count(*) from public.eventos_acceso where enlace_id=enlace and resultado='rechazado');
  if public.reservar_descarga(enlace::text,'hash-prueba',true)->>'estado' <> 'ocupado' then raise exception 'Sobrepasó cupo reservado'; end if;
  if (select count(*) from public.eventos_acceso where enlace_id=enlace and resultado='rechazado') <> antes+1 then raise exception 'No registra cupo reservado'; end if;
  perform public.finalizar_descarga((permiso->>'reservaId')::uuid,false);

  update public.enlaces_compartidos set vence_en=now()-interval '1 second' where id=enlace;
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado'<>'no_disponible' or not exists(select 1 from public.eventos_acceso where enlace_id=enlace and motivo='Enlace vencido') then raise exception 'No registra vencimiento'; end if;
  update public.enlaces_compartidos set vence_en=now()+interval '1 day',bloqueado_hasta=now()+interval '1 minute' where id=enlace;
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado'<>'bloqueado' or not exists(select 1 from public.eventos_acceso where enlace_id=enlace and motivo='Bloqueo temporal') then raise exception 'No registra bloqueo'; end if;
  update public.enlaces_compartidos set bloqueado_hasta=null,descargas_realizadas=1 where id=enlace;
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado'<>'no_disponible' or not exists(select 1 from public.eventos_acceso where enlace_id=enlace and motivo='Límite de descargas alcanzado') then raise exception 'No registra agotamiento'; end if;
  update public.enlaces_compartidos set revocado_en=now() where id=enlace;
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado'<>'no_disponible' or not exists(select 1 from public.eventos_acceso where enlace_id=enlace and motivo='Enlace revocado') then raise exception 'No registra revocación'; end if;

  solicitud := public.solicitar_eliminacion_archivo(sin_enlace,propietario);
  if solicitud->>'estado'<>'preparado' then raise exception 'No permite borrar archivo sin enlaces'; end if;
  reintento := public.solicitar_eliminacion_archivo(sin_enlace,propietario);
  if reintento->>'estado'<>'en_proceso' then raise exception 'Dos borrados reclamaron el mismo archivo'; end if;
  if public.cerrar_limpieza(sin_enlace,gen_random_uuid(),true) then raise exception 'Aceptó token ajeno'; end if;
  perform public.cerrar_limpieza(sin_enlace,(solicitud->>'token')::uuid,false);
  if not exists(select 1 from public.archivos where id=sin_enlace and estado_limpieza='pendiente_limpieza' and eliminacion_solicitada_en is not null) then raise exception 'El fallo liberó cuota o reactivó el archivo'; end if;
  reintento := public.reclamar_limpieza(sin_enlace);
  if reintento is null then raise exception 'La limpieza automática no recupera el borrado manual fallido'; end if;
  if public.cerrar_limpieza(sin_enlace,(solicitud->>'token')::uuid,true) then raise exception 'Aceptó reclamación anterior'; end if;
  if not public.cerrar_limpieza(sin_enlace,(reintento->>'token')::uuid,true) then raise exception 'No finalizó borrado manual'; end if;
  if exists(select 1 from public.archivos where id=sin_enlace) then raise exception 'No liberó metadatos'; end if;
  if not exists(select 1 from public.eventos_acceso where tipo_evento='eliminacion' and resultado='exitoso' and archivo_id is null) then raise exception 'No conserva evento de eliminación'; end if;

  solicitud := public.solicitar_eliminacion_archivo(compartido,propietario);
  if solicitud->>'estado'<>'preparado' then raise exception 'No permite eliminar archivo compartido'; end if;
  permiso := public.reservar_descarga(enlace::text,'hash-prueba',true);
  if permiso->>'estado'<>'no_disponible' then raise exception 'Descarga durante borrado'; end if;
  if not public.cerrar_limpieza(compartido,(solicitud->>'token')::uuid,true) then raise exception 'No cierra archivo compartido'; end if;
  if exists(select 1 from public.enlaces_compartidos where archivo_id=compartido) then raise exception 'No elimina los enlaces'; end if;
  if has_function_privilege('anon','public.solicitar_eliminacion_archivo(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.registrar_rechazo_descarga(uuid,text)','execute') then raise exception 'Funciones privadas accesibles al cliente'; end if;
  raise notice 'Pruebas SQL de eliminación y rechazos completadas';
end;
$$;
rollback;
