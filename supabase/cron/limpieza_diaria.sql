-- Ejecutar manualmente DESPUÉS de desplegar y revisar la Edge Function.
-- No incluye secretos en el repositorio. Crear previamente en Vault:
-- safelink_project_url = https://TU_PROYECTO.supabase.co
-- safelink_limpieza_secret = el mismo valor de LIMPIEZA_SECRET en Edge Functions.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if (select count(*) from vault.decrypted_secrets where name = 'safelink_project_url') <> 1
    or (select count(*) from vault.decrypted_secrets where name = 'safelink_limpieza_secret') <> 1 then
    raise exception 'Crea los dos secretos únicos de limpieza en Vault antes de programar la tarea';
  end if;
end;
$$;

-- 09:00 UTC = 03:00 en America/Mexico_City. La primera programación solo revisa.
-- Tras comprobar los resultados, cambiar revision por ejecutar y correr de nuevo
-- este archivo. cron.schedule actualiza el trabajo del mismo nombre.
select cron.schedule('safelink-limpieza-diaria', '0 9 * * *', $tarea$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'safelink_project_url'), '/') || '/functions/v1/limpiar-archivos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-limpieza-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'safelink_limpieza_secret')),
    body := '{"modo":"revision"}'::jsonb,
    timeout_milliseconds := 120000
  );
$tarea$);

-- Para pausar la programación, ejecutar por separado:
-- select cron.unschedule('safelink-limpieza-diaria');
