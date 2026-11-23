-- Ejecutar DESPUÉS de aplicar 202611220003 y desplegar el backend actualizado.
-- No requiere HTTP ni secretos y no modifica safelink-limpieza-diaria.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('safelink-recuperar-reservas', '* * * * *',
  $$select public.recuperar_reservas_descarga(100);$$);
-- Revisar ejecuciones en cron.job_run_details. Para desactivar, por separado:
-- select cron.unschedule('safelink-recuperar-reservas');
