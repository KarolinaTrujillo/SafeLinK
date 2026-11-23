create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('safelink-recuperar-reservas', '* * * * *',
  $$select public.recuperar_reservas_descarga(100);$$);

