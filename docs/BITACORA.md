# Bitácora de actividades — SafeLinK

> Registro vivo del trabajo. Actualizar estado, fecha, evidencia y decisiones al cerrar cada bloque. Las actividades marcadas como MVP pertenecen al alcance mínimo de la propuesta; las demás no se agregan sin acordarlo.

## Meta inmediata

En los próximos dos días se busca completar aproximadamente la primera mitad del MVP: estructura del proyecto, conexión local de ambos componentes, modelo de datos y controles básicos de autenticación/carga. El porcentaje se medirá contra los entregables del MVP, no contra funcionalidades opcionales.

## Estados

- [ ] Pendiente
- [~] En progreso
- [x] Terminado y verificado
- [!] Bloqueado / requiere decisión

## Plan de trabajo

### Día 1 — Base del proyecto y datos

- [ ] Confirmar versiones disponibles de Node.js/npm y registrar el estado inicial de ambas carpetas.
- [x] Acordar carpeta raíz común del proyecto y un solo repositorio Git.
- [x] Crear estructura base vacía `frontend/`, `backend/`, `docs/` y `supabase/migrations/`. Las carpetas originales vacías se conservaron por ahora.
- [ ] Crear archivos de configuración y `.gitignore`; definir variables de entorno de ejemplo sin secretos reales.
- [ ] Crear proyecto Supabase gratuito en la región elegida y guardar credenciales de forma local segura.
- [ ] Revisar el DBML de referencia contra requisitos y resolver los pendientes que bloqueen las migraciones.
- [x] Crear y aplicar migración inicial de enums, tablas y relaciones propias; no recrear `auth.users` ni `storage.objects`. Supabase confirmó la ejecución y las cuatro tablas aparecen en Table Editor.
- [~] Activar RLS y preparar grants/policies mínimos; falta verificar el comportamiento en Supabase.
- [x] Crear bucket privado para archivos; Storage muestra `safelink-files`, límite de 10,000,000 bytes, tipos permitidos y `Public bucket` desactivado.
- [ ] Registrar decisiones y problemas encontrados en esta bitácora.

**Entregable al cierre del día 1:** estructura ejecutable localmente, esquema de datos inicial aplicado a Supabase y reglas de acceso iniciales documentadas.

### Día 2 — Conexión y flujo seguro inicial

- [x] Preparar estructura mínima del backend Express en TypeScript, configuración segura y endpoint de estado; dependencias instaladas, Node 26.13.0 LTS activo y conexión `/api/health` confirmada.
- [~] Validar JWT de Supabase Auth antes de permitir rutas privadas; middleware y ruta de comprobación creados, falta probarlos con una sesión autenticada del frontend.
- [ ] Conectar frontend con Supabase Auth para registro, inicio de sesión y cierre de sesión.
- [~] Preparar cliente de Supabase en el navegador y variables públicas; falta instalar el SDK y construir las vistas de acceso de acuerdo con Figma.
- [ ] Configurar verificación de correo y recuperación de contraseña con Supabase; documentar URLs de redirección para desarrollo.
- [ ] Conectar API Express a Supabase desde el servidor, usando solo claves/secretos almacenados en variables de entorno del backend.
- [ ] Implementar endpoint protegido de salud/configuración sin exponer secretos.
- [ ] Implementar carga inicial autenticada: límite de tamaño, allowlist PDF/JPG/PNG/DOCX, validación en servidor y bucket privado.
- [ ] Guardar metadatos del archivo ligados al usuario; impedir que el cliente elija propietario o ruta de Storage.
- [ ] Validar el límite de 10 archivos activos por usuario de forma segura ante solicitudes simultáneas (transacción/RPC o mecanismo equivalente).
- [ ] Probar manualmente usuario anónimo, usuario autenticado y acceso cruzado a archivos de otra cuenta.
- [ ] Registrar evidencias, errores y cambios de alcance; actualizar lista de pendientes.

**Entregable al cierre del día 2:** registro/sesión funcionales, carga restringida inicial y evidencia de aislamiento entre usuarios. Esto representa el objetivo de avance de aproximadamente la mitad del MVP.

### Después de los dos días — Completar MVP

- [ ] Crear, consultar y revocar enlaces de descarga con token secreto de alta entropía; persistir solo su hash.
- [ ] Implementar expiración, máximo de descargas y autorización atómica para evitar exceder límites con solicitudes simultáneas.
- [ ] Implementar contraseña opcional del enlace usando KDF con sal y compartirla por un canal distinto.
- [ ] Implementar bloqueo progresivo de intentos, incluyendo límites, reinicio y condiciones de desbloqueo definidos.
- [ ] Crear vista de descarga para receptor sin cuenta; respuestas no deben revelar si un token privado existe.
- [ ] Registrar eventos mínimos de acceso y preparar métricas administrativas acordadas.
- [ ] Implementar borrado lógico de acceso y limpieza física de Storage/metadatos; documentar cómo se dispara y cómo se reintenta.
- [ ] Completar pantallas necesarias, estados de error y accesibilidad básica sin ampliar el alcance.
- [ ] Completar pruebas funcionales y de seguridad con Postman; documentar resultados y defectos.
- [ ] Revisar secretos, HTTPS, RLS, políticas de Storage, validación de archivos y configuración de despliegue gratuito Vercel/Render.
- [ ] Preparar diagramas, matriz de riesgos y evidencia para evaluación académica.

## Registro de sesiones

| Fecha | Actividad | Resultado / evidencia | Decisión o pendiente |
|---|---|---|---|
| 2026-11-01 | Revisión inicial de carpetas y propuesta | Frontend y Backend estaban vacíos. La propuesta define stack y capas, pero no estructura de directorios. | Se decidió y creó una raíz Git común. |
| 2026-11-01 | Se fijó el tamaño máximo en 10,000,000 bytes y el cupo cuenta archivos hasta su borrado confirmado de Storage. | Confirmación de la estudiante. | Reflejar el mismo límite en servidor, políticas de carga y validación de BD. |
| 2026-11-01 | Bloqueo: 5 fallos consecutivos → 1 min; cada siguiente grupo de 5 → 5 y luego 15 min, permaneciendo en 15. Un acierto reinicia contador y nivel. | Confirmación de la estudiante para limitar adivinación de contraseña. | Implementar actualizaciones atómicas y probar escalamiento/reinicio. |
| 2026-11-01 | Límites de descarga por enlace: presets 1, 3, 5 y 10; valor personalizado máximo 20. | Confirmación de la estudiante. | Aplicar límite atómico y contar solo descargas exitosas completadas. |
| 2026-11-01 | Vencimientos: presets 1 h, 12 h, 1 d, 2 d, de 5 d a 10 d; personalizado hasta 15 d. | Confirmación de la estudiante; “5 d hasta 10 d” se interpreta como opciones por cada día. | Usar un único selector y validar toda elección en servidor. |
| 2026-11-01 | Conservar eventos de acceso por 60 días; usar Supabase Cron diario + Edge Function privada para limpieza de Storage y purga de eventos vencidos. | Confirmación de la estudiante; cumplir borrado y estadísticas temporales. | Antes de implementar, confirmar disponibilidad/costo de Cron en Free y límites de Edge Functions. |
| 2026-11-01 | Reunir frontend, backend, documentación y migraciones en una raíz SafeLinK con un solo repositorio. | Confirmación de la estudiante. | Raíz `SafeLinK/` y carpetas base creadas; los dos directorios antiguos vacíos se conservaron para evitar romper la ventana de VS Code abierta. |
| 2026-11-01 | Preparar y aplicar migración inicial basada en el diagrama presentado, con restricciones acordadas, RLS y bucket privado. | Mantener el diseño aprobado y centralizar autorización en la API Express con un esquema fácil de entender. | Supabase informó ejecución exitosa; Table Editor muestra `perfiles`, `archivos`, `enlaces_compartidos` y `eventos_acceso`; Storage muestra `safelink-files` con límite de 10,000,000 bytes, MIME permitidos y `Public bucket` desactivado. La prueba de acceso de RLS con roles cliente queda pendiente. |
| 2026-11-01 | Crear y arrancar la base del backend Express con TypeScript, configuración privada de Supabase y ruta `/api/health`. | Iniciar la conexión API sin exponer `service_role` y mantener estructura sencilla. | Karol instaló 94 paquetes y npm reportó 0 vulnerabilidades. El problema de WebSocket con Node 20.19.5 se resolvió al instalar Node 26.13.0 LTS; `/api/health` respondió `{"status":"ok"}`. El `.env` permanece local y la clave no fue compartida. |
| 2026-11-02 | Agregar middleware de autenticación a Express y ruta protegida `/api/auth/me`. | Asegurar que las futuras operaciones privadas usen identidad validada por Supabase Auth y no un ID enviado por cliente. | Creado `backend/src/middleware/auth.ts`; token ausente o inválido obtiene 401 y fallos al consultar Supabase obtienen 503. La ruta responde solo con el ID verificado. Falta probarla con un token de una sesión real cuando se integre el login del frontend. |
| 2026-11-02 | Preparar cliente Supabase para el navegador. | Permitir registro e inicio de sesión usando solo la clave pública en Next.js. | Creados `frontend/lib/supabase.ts` y `frontend/.env.example`; se agregó una excepción de `.env.example` en `frontend/.gitignore`. La instalación del SDK falló aquí por `ENOTFOUND registry.npmjs.org`, así que falta que `npm install` genere el lockfile. La vista de Figma no se pudo leer; se requieren capturas de registro e inicio de sesión antes de implementar su apariencia. |
| 2026-11-02 | Organizar las vistas de acceso según la estructura acordada. | Separar rutas y componentes de autenticación y documentar cómo se agregarán las vistas futuras sin crear archivos anticipadamente. | Registro en `frontend/app/registro/`, formularios en `frontend/components/auth/` y `/` redirige a `/registro`. Se actualizó la estructura actual en este documento. Backend y migración no se modificaron. |

## Decisiones y cambios

Anota aquí cada decisión que cambie alcance o requisitos. Indicar fecha, motivo y documento/código afectado.

| Fecha | Decisión/cambio | Motivo | Impacto |
|---|---|---|---|
| 2026-11-01 | Se propone avanzar primero con estructura, Supabase, datos, Auth y carga segura. | Priorizar el núcleo del MVP y la meta de dos días. | Enlaces, auditoría, limpieza y métricas quedan para la fase posterior. |

