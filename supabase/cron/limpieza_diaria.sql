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

select cron.schedule('safelink-limpieza-diaria', '0 9 * * *', $tarea$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'safelink_project_url'), '/') || '/functions/v1/limpiar-archivos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-limpieza-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'safelink_limpieza_secret')),
    body := '{"modo":"ejecutar"}'::jsonb,
    timeout_milliseconds := 120000
  );
$tarea$);
