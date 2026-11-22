# Limpieza diaria de SafeLinK

## Estado

La migración de limpieza del 21 de noviembre fue aplicada por Karol y la revisión SQL funciona. Karol confirmó las cuatro comprobaciones de la migración del 22 de noviembre (índice, trigger, reservas y vista de limpieza). Karol confirmó el despliegue de la función, su revisión alojada y la programación diaria activa en modo ejecutar (jobid 1, horario 0 9 * * *). La primera ejecución programada y su respuesta HTTP siguen pendientes de verificar. Primero probar el modo de revisión. No ejecutar la prueba SQL sobre producción.

## Reglas

- Se conserva un archivo que nunca tuvo enlaces.
- Se considera únicamente el enlace marcado como actual, el mismo que muestra la configuración. Un enlace actual no revocado y no vencido cancela la selección, aunque esté agotado o bloqueado por contraseña.
- Si el enlace actual venció o fue revocado, el borrado queda permitido 10 días después de la fecha más temprana entre su vencimiento y su revocación. Los enlaces históricos no alargan ese plazo. Las reservas de cualquier enlace sí impiden borrar el archivo.
- Renovar o crear un enlace antes de que la limpieza reclame el archivo cancela su programación. Después de reclamarlo, el archivo pasa a pendiente de limpieza y no puede reactivarse.
- Las descargas con reserva impiden reclamarlo. No se borran reservas antiguas automáticamente: su recuperación sigue pendiente para evitar quitar cupos de una descarga real.
- Se borra el objeto de `safelink-files` y solo después sus metadatos. Un fallo conserva la cuota ocupada; la siguiente ejecución reintenta.
- Un trabajador reclama cada archivo con un token privado. Otro solo podrá recuperarlo tras 15 minutos. Un token anterior no puede finalizar el trabajo de otro.
- Se eliminan hasta 20 archivos y hasta 5000 eventos de más de 60 días por ejecución. Si hay más, se continúa en la siguiente ejecución.
- Los eventos de limpieza no incluyen nombres, rutas, IP, claves ni tokens. Sus referencias se ponen a null al borrar el archivo; se conservan hasta su propio vencimiento.

## Archivos

- `supabase/migrations/202611210001_cleanup.sql`: selección, reclamación, reintento, cierre y purga. Aplicarla no inicia borrados.
- `supabase/functions/limpiar-archivos/index.ts`: acceso privado a Supabase.
- `supabase/functions/limpiar-archivos/limpieza.ts`: lógica y validación del modo/secreto.
- `supabase/config.toml`: desactiva solo la comprobación JWT de esta función; la función exige su propio secreto.
- `supabase/cron/limpieza_diaria.sql`: programación diaria; por defecto SOLO REVISIÓN.

## Instalación y prueba

1. Aplicar `202611220001_current_link.sql` en SQL Editor después de la migración de limpieza. Conserva el enlace editado más recientemente por archivo y revoca los anteriores, sin borrar archivos. Requiere las migraciones anteriores de archivos y reservas. No volver a ejecutar migraciones ya aplicadas.
2. Crear un secreto aleatorio exclusivo de al menos 32 caracteres, recomendado 64 hexadecimales. Puedes generarlo localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Guardarlo de forma privada, sin incluirlo en Git ni compartirlo en capturas.
3. En Edge Functions, configurar ese valor como `LIMPIEZA_SECRET`. Las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` deben estar disponibles solo en el entorno de la función.
4. Desplegar la carpeta `supabase/functions/limpiar-archivos`. Con la CLI instalada: `supabase functions deploy limpiar-archivos --project-ref TU_PROJECT_REF --no-verify-jwt`. El header `x-limpieza-secret` es obligatorio aunque `verify_jwt` sea false. No agregar esta clave al frontend.
5. Probar desde Postman: `POST https://TU_PROYECTO.supabase.co/functions/v1/limpiar-archivos`, header `Content-Type: application/json`, header `x-limpieza-secret` con el secreto y Body raw JSON `{"modo":"revision"}`. El cuerpo vacío también usa revisión. Nunca se borra en este modo.
6. Revisar `archivos`, sus fechas `eliminarEn`, `archivosVencidos` y `pendientesPorReservas`. La lista devuelve como máximo 20 candidatos que puede reclamar. Los nombres de esta respuesta son privados.
7. Solo cuando se revisen los candidatos, enviar `{"modo":"ejecutar"}`. Esta operación es irreversible: borrar los objetos de Storage no se puede deshacer desde la aplicación. Probar primero con archivos desechables y conservar copia fuera de SafeLinK.
8. Confirmar en Storage y en la tabla de archivos que solo se eliminaron los candidatos. Un código 207 indica un lote con errores parciales; no significa que no haya habido borrados. Revisar el resumen.

## Programación diaria

La documentación de Supabase contempla Cron + pg_net + Vault para invocar Edge Functions. Antes de activarlos comprobar en el proyecto que Cron, pg_net y Vault estén disponibles y revisar los límites/cuotas del plan; no se ha confirmado su disponibilidad concreta ni el consumo de esta cuenta.

Crear en Vault dos secretos (una sola entrada por nombre):

- `safelink_project_url`: URL base del proyecto, sin `/functions/v1`.
- `safelink_limpieza_secret`: exactamente el valor de `LIMPIEZA_SECRET`.

Ejecutar `supabase/cron/limpieza_diaria.sql` en SQL Editor. Programa una revisión diaria a las 09:00 UTC (03:00 de Ciudad de México). El script no habilita el borrado: lleva `{"modo":"revision"}`. Tras las pruebas, cambiar ese cuerpo a `{"modo":"ejecutar"}` y ejecutar el script de nuevo para actualizar el trabajo del mismo nombre.

Consultar el historial en Cron y los logs/invocaciones de la Edge Function. Que Cron complete el envío HTTP no confirma que la función haya terminado: revisar también el estado HTTP y su resumen. Para pausar: `select cron.unschedule('safelink-limpieza-diaria');`.

## Validación local

En Node 26, desde la raíz del proyecto: `node --test supabase/tests/limpieza.test.mjs`. Pruebas con adaptador simulado, sin usar secretos ni contactar Supabase.

`supabase/tests/cleanup.sql` comprueba reglas y reintentos dentro de una transacción con rollback. Ejecutar solamente en una base local/de pruebas con las migraciones aplicadas. No usa Storage y por sí sola no comprueba el borrado físico ni las carreras concurrentes.

Estado de verificación: 11 pruebas de lógica y TypeScript del módulo puro pasaron. No se dispone aquí de Deno ni de PostgreSQL/Docker activo: la comprobación Deno, la prueba SQL, la integración con Storage y la programación diaria siguen pendientes. También deben probarse los fallos/reintentos y una renovación coincidente con la reclamación en una base de pruebas.

## Referencias

- [Programar Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Secretos de Edge Functions](https://supabase.com/docs/guides/functions/secrets)
- [Configuración por función](https://supabase.com/docs/guides/functions/function-configuration)
- [Límites de Edge Functions](https://supabase.com/docs/guides/functions/limits)

La prueba `supabase/tests/current_link.sql` verifica la regla del enlace actual después de aplicar todas las migraciones, solo en una base local/de pruebas. Está pendiente de ejecución en PostgreSQL.


## Prueba manual de un archivo desde el equipo local

Karol autorizó eliminar `243733flayer.pdf` (345103c7-3a9b-4c31-9c56-2d6114b12c6c), sin copia. La conexión desde el entorno del agente falló; no se confirmó ningún borrado remoto.

Desde la carpeta backend ejecutar `node --import tsx scripts/limpiar-archivo.mjs 345103c7-3a9b-4c31-9c56-2d6114b12c6c ejecutar`. Sin el último argumento solo revisa. Usa backend/.env sin imprimir claves. Reutiliza el trabajador de limpieza, filtra el plan a ese ID y vuelve a validar bajo bloqueo. No purga eventos ni despliega o activa Cron. La preparación puede recalcular plazos de otros candidatos, pero solo se intenta borrar el ID indicado. Si el archivo no está en los primeros 20 candidatos devueltos por la revisión, no se intenta borrar.

Confirmar `borrados: 1`, `errores: 0` y `archivoEliminado: true`; después verificar que no aparece en Mis archivos ni en Storage. Un error o un archivo omitido no confirma eliminación.


## Actualización: eliminación manual y estadísticas de rechazos (2026-11-22)

Preparado localmente; pendiente aplicar `supabase/migrations/202611220002_delete_files_rejections.sql`. Aplicar solamente esta migración nueva después de las anteriores. Añade `eliminacion_solicitada_en` y funciones privadas para solicitar borrado y registrar rechazos, y actualiza la vista de candidatos, el cierre, la reserva de descargas y las métricas administrativas. Aplicarla no solicita eliminaciones ni borra objetos existentes.

El propietario solicita DELETE /api/archivos/:id desde Mis archivos y confirma. La identidad procede del Bearer token validado, nunca del cuerpo de la petición. Bajo bloqueo del archivo se comprueba la propiedad, que no haya una reclamación vigente ni reservas de ningún enlace. Una reserva activa produce 409 sin desactivar el archivo. Una solicitud aceptada marca pendiente y bloquea nuevas descargas/activaciones antes de tocar Storage. Se elimina el objeto y después se confirman metadatos/evento con el token de reclamación. El cupo permanece ocupado hasta finalizar. Esta solicitud explícita no espera los 10 días de retención automática.

Si Storage falla, el propietario puede reintentar; la limpieza diaria también recupera el trabajo porque la vista incluye solicitudes manuales, incluso archivos sin enlaces. Si el objeto fue borrado pero falló el cierre, se conserva la reclamación durante 15 minutos y después se recupera de forma idempotente. Los eventos de eliminación permanecen con referencias nulas tras borrar el archivo. La eliminación manual no purga eventos antiguos por su cuenta.

La Edge Function y Cron existentes NO necesitan volver a desplegarse: usan la misma vista y las mismas firmas RPC. A partir de la migración, la tarea diaria también puede completar solicitudes manuales pendientes. Los archivos sin enlaces siguen conservándose salvo que su propietario solicite eliminarlos explícitamente.

Los rechazos se registran en solicitudes POST de descarga: contraseña incorrecta/inválida, bloqueo, expiración, revocación, agotamiento, cupo reservado, configuración cambiada y archivo/enlace no disponible. Los GET de consulta o recarga no crean eventos. Los rechazos nuevos usan tipo descarga y resultado rechazado; se conservan los históricos intento_contrasena. La métrica administrativa incluye ambos tipos rechazados de los últimos 60 días y excluye errores operativos de limpieza/eliminación. No se reconstruyen retroactivamente intentos que nunca se registraron. No se guardan contraseñas, tokens ni IP en los eventos.

Orden de actualización: (1) aplicar la migración en SQL Editor; (2) probar localmente ambos componentes; (3) subir código y migración a la rama desplegada para actualizar Render y Vercel; (4) repetir pruebas con archivo desechable en el sitio público. No volver a ejecutar migraciones anteriores. Conservar copia si interesa mantener el archivo: eliminarlo es definitivo.

Pruebas manuales de cierre:

- Cancelar confirmación: conserva archivo y contador. Confirmar: desaparece de Mis archivos y Storage, libera cuota e inutiliza su URL pública; aparece evento eliminación exitoso.
- DELETE sin sesión: 401. DELETE de archivo de otra cuenta: 404, sin tocar Storage.
- Una descarga con reserva activa impide DELETE con 409; después de finalizar se puede borrar.
- Contraseña errónea suma un rechazo y ninguna descarga. GET/reload no suma. POST de enlace vencido/revocado/agotado o bloqueado suma una vez y muestra el motivo en Actividad reciente.
- Fallos de Storage y del cierre se prueban con mocks locales; las pruebas SQL de rollback (`supabase/tests/delete_files_rejections.sql`) SOLO en una base desechable, nunca producción. No se han ejecutado aquí por no tener PostgreSQL/Docker activo.

Validación local final: 28 pruebas del backend y 11 del trabajador de limpieza aprobadas; compilación TypeScript del backend, TypeScript del frontend y ESLint de los archivos frontend modificados aprobados. `git diff --check` sin errores. El build de producción del frontend no se completó: Turbopack falló al iniciar el subproceso CSS en este entorno; debe verificarse antes de publicar. La migración y las pruebas SQL siguen pendientes de ejecución en PostgreSQL. No se aplicaron cambios remotos ni se borraron archivos reales.
