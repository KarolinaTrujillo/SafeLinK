# Bitácora de actividades — SafeLinK

### 2026-11-22 — Recuperación de reservas abandonadas

Karol confirmó eliminación y estadísticas en producción, concurrencia del último cupo y corrección del comando de Cron instalado (coma duplicada false, activo true, horario 0 9 * * *). Se mantiene pendiente la ejecución diaria de madrugada. Autorizó implementar recuperación de reservas: vencimiento, renovación mientras se transfiere, límite de transferencia y reintentos de cierre. Un resultado incierto consume cupo y se registra como no_confirmado; un fallo demostrado antes de enviar bytes libera cupo si se cierra antes de vencer. Este acuerdo sustituye la liberación incondicional de cualquier transferencia interrumpida.

Preparados migración 202611220003, tarea SQL safelink-recuperar-reservas cada minuto, controlador de backend y presentación del resultado No confirmado en Actividad reciente. La recuperación respeta los bloqueos de archivo/enlace/reserva y es idempotente. No se mezcla incertidumbre con métricas de éxito o rechazo. Sin cambios remotos, commits ni push del agente. Guía y pruebas pendientes en docs/LIMPIEZA.md.

### 2026-11-15 — Descarga pública y diagnóstico

- Implementada la vista pública de descarga del frame 8-650, sin datos del emisor, con contraseña opcional y mensajes de bloqueo/error.
- Nuevas rutas `/api/descargas/:token` para consultar disponibilidad y solicitar el archivo privado. Requieren aplicar `202611150001_public_downloads.sql` para reservas, bloqueo progresivo y finalización de descargas.
- Se corrigió la lectura de parámetros de la ruta de Next.js para realizarla dentro de Suspense, como requiere la configuración de caché actual.
- Se agregó diagnóstico seguro en el backend para identificar funciones de descarga ausentes, sin imprimir claves ni tokens.
- Siete pruebas con Supabase simulado y TypeScript de frontend/backend pasaron. Karol aplicó la migración y confirmó mediante pruebas manuales: descarga real, contador, rechazo al agotar el cupo, ampliación del límite sin reiniciar el contador, contraseña incorrecta sin consumir descarga, vencimiento, bloqueo por intentos y revocación.
- Las descargas simultáneas quedan pendientes por indicación de Karol. No se verificó todavía el escalamiento completo del bloqueo a 5 y 15 minutos ni su reinicio tras un acierto.
- El evento finish del servidor indica fin del envío al sistema operativo, no confirma que la persona guardó/abrió el archivo. Si el proceso se interrumpe o falla el cierre de una reserva, puede quedar un cupo reservado: su recuperación todavía requiere revisión.

### 2026-11-15 — Avisos para guardar credenciales

- Se agregaron avisos en Configurar y compartir enlace para copiar la URL y la contraseña antes de salir: no vuelven a mostrarse al regresar, aunque sus valores sigan vigentes.
- Debajo de la contraseña se indica que generar una nueva y guardar la configuración invalida la anterior.
- Se reutilizan los estilos existentes del frontend; la lógica de guardado no cambia.

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
- [~] Configurar verificación de correo y recuperación de contraseña con Supabase. La confirmación se desactivará temporalmente en desarrollo para probar el registro; falta configurar envío confiable, validar recuperación y reactivarla antes del despliegue.
- [ ] Conectar API Express a Supabase desde el servidor, usando solo claves/secretos almacenados en variables de entorno del backend.
- [ ] Implementar endpoint protegido de salud/configuración sin exponer secretos.
- [~] Implementar carga inicial autenticada: límite de tamaño, allowlist PDF/JPG/PNG/DOCX, validación en servidor y bucket privado; falta comprobar manualmente en Supabase.
- [x] Guardar metadatos del archivo ligados al usuario; el servidor genera el propietario y la ruta de Storage.
- [x] Validar el límite de 10 archivos y 100 MB por usuario con una RPC que bloquea el perfil mientras registra la carga, evitando superar la cuota con cargas simultáneas.
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
| 2026-11-02 | Conectar el inicio de sesión con la validación del backend. | Comprobar el token emitido por Supabase Auth en la ruta protegida `/api/auth/me`. | El formulario envía el token como `Authorization: Bearer` y muestra éxito solo si la API responde correctamente. Pendiente de comprobación manual con frontend y backend activos. |
| 2026-11-02 | Implementar la vista inicial de Mis archivos a partir del frame 1-877 de Figma. | Dar continuidad al flujo de inicio de sesión y preparar la pantalla para integrar el listado real más adelante. | Creada la ruta protegida en la interfaz; el login redirige tras validar Supabase y el backend. La lista está marcada como demostración y no consulta archivos reales. Pendiente de revisión manual en navegador. |
| 2026-11-02 | Ajustar Mis archivos a los frames 1-1171 y 1-879 de Figma y condicionar la opción Administración. | Alinear topbar, métricas, búsqueda y tabla con el diseño; obtener el rol de una fuente confiable. | `/api/auth/me` consulta `perfiles.rol`; la interfaz muestra Administración solo para `administrador`. Métricas y registros siguen siendo datos de demostración. Pendiente de revisión manual. |
| 2026-11-02 | Conectar la carga privada y el listado real de archivos. | Implementar la primera función de almacenamiento respetando 10 MB por archivo, tipos permitidos y cuotas por usuario. | Nueva ruta `/subir-archivo`; Express valida sesión, tamaño, tipo y firmas básicas, genera la ruta privada y guarda metadatos/objeto. Se agregó migración `202611020001_upload_quota.sql` para limitar a 10 archivos y 100 MB mediante bloqueo por perfil. La vista Mis archivos ahora consulta datos reales y calcula métricas; pendiente aplicar la migración en Supabase y hacer comprobación manual. |
| 2026-11-02 | Dejar pendiente la confirmación de correo durante desarrollo. | Evitar depender del envío limitado de correo mientras se construye y prueba el registro. | Se documentó desactivar temporalmente `Confirm email` en Supabase; al hacerlo, Supabase auto-confirma las direcciones y no comprueba su propiedad. El formulario redirige a Mis archivos si Supabase entrega sesión y el backend la valida. Falta cambiar el ajuste manualmente en el panel, configurar correo para recuperar contraseña y reactivar confirmación antes del despliegue. |

## Decisiones y cambios

Anota aquí cada decisión que cambie alcance o requisitos. Indicar fecha, motivo y documento/código afectado.

| Fecha | Decisión/cambio | Motivo | Impacto |
|---|---|---|---|
| 2026-11-01 | Se propone avanzar primero con estructura, Supabase, datos, Auth y carga segura. | Priorizar el núcleo del MVP y la meta de dos días. | Enlaces, auditoría, limpieza y métricas quedan para la fase posterior. |



### 2026-11-03 — Topbar compartida y diseño de carga

- Se extrajo `Topbar.tsx` y `Topbar.module.css` y se sustituyeron las barras duplicadas de Mis archivos y Subir archivo.
- Se adaptó Subir Documento a la captura del frame 1-600: distribución de dos columnas, zona de selección, restricciones, archivo preparado, capacidad y resultado de validación.
- La capacidad usa datos reales; se agregó arrastrar/soltar y Remover. No se muestran archivos ni rechazos de ejemplo.
- Configurar enlace permanece pendiente; después de cargar se vuelve a Mis archivos.
- Revisión visual en navegador con sesión real: pendiente.
- TypeScript (`tsc --noEmit --incremental false`), ESLint de los tres componentes afectados y `git diff --check`: completados sin errores.


### 2026-11-03 — Configurar y compartir enlace

- Implementada la vista según la captura del frame 1-1204, reutilizando Topbar y separando estilos, componente y acceso a API.
- Carga y Mis archivos enlazan a la configuración del archivo seleccionado. El formulario usa archivos reales del usuario.
- Agregado el módulo backend de enlaces: consulta, creación, edición y revocación, con validación de propiedad, fechas y límites. No se reinician contadores al editar.
- Secretos aleatorios, token almacenado mediante SHA-256 y contraseña mediante scrypt con sal; los secretos originales no se recuperan al consultar.
- Sin nueva migración ni cambios remotos de Supabase. Descarga pública y auditoría pendientes; la vista lo indica.
- TypeScript de frontend y backend y ESLint de archivos afectados pasaron. Pruebas directas de handlers con Supabase simulado pasaron para límites, propiedad, hashes ocultos, edición y revocación. La prueba HTTP local quedó bloqueada por EACCES; integración y revisión visual con sesión real pendientes.

### 2026-11-04 — Separar configuración por enlace

- Se reemplazó el selector dentro del formulario por una lista de enlaces y una dirección de configuración para cada uno; la creación tiene una acción separada.
- La configuración comprueba que el enlace corresponda al archivo consultado. La lógica de autorización permanece en el backend.
- Pendiente comprobar el flujo visual con la sesión real de la usuaria.


### 2026-11-04 — Mostrar solo la última configuración

- Por corrección de la usuaria, se retiró la lista de enlaces de la pantalla. Al abrir un archivo se carga la configuración con actualización más reciente; guardar edita ese enlace.
- Si la última configuración está revocada, se ofrece crear un enlace nuevo explícitamente. Los registros anteriores no se borran ni se revocan automáticamente.


### 2026-11-21 — Limpieza diaria preparada, pendiente de instalación

- Preparadas migración, Edge Function privada, modo de revisión, ejecución por lotes y script de Cron inicialmente en revisión.
- Solo selecciona archivos con enlaces vencidos/revocados hace 10 días; conserva archivos sin enlaces y aquellos con un enlace no revocado y no vencido, aunque esté agotado/bloqueado. Revalida antes de reclamar y no elimina archivos con reservas de descarga.
- Primero borra Storage y luego metadatos; los fallos conservan el cupo y se reintentan. Incluye purga por lotes de eventos de más de 60 días.
- 11 pruebas con adaptador simulado y TypeScript del módulo puro pasaron. Deno y PostgreSQL/Storage reales pendientes. No se aplicaron migraciones ni se desplegó/activó la tarea.
- Esta sesión permite escribir en Documents/Codex y no en la carpeta del proyecto; se entrega un parche para aplicarlo en SafeLinK, con guía en docs/LIMPIEZA.md.
- Pruebas manuales confirmadas por Karol para administración: búsqueda, filtros, revocación, ocultación de la opción a usuarios normales y rechazo de navegación directa al panel. Actividad reciente y petición directa de la API con usuario normal siguen pendientes de confirmación.


### 2026-11-22 — Una configuración actual por archivo

Autorizado por Karol: usar una única configuración actual para cada archivo en Compartir enlace, Mis archivos, administración, descargas y limpieza. La migración `202611220001_current_link.sql` selecciona el último enlace editado (desempate por creación e ID), incluso si está revocado; revoca los anteriores y conserva sus filas históricas. Pendiente de aplicar en Supabase. No borra archivos ni inicia la limpieza.

Guardar edita el mismo enlace y conserva URL, contraseña si no se reemplaza y descargas utilizadas. Solo una creación explícita tras revocar produce otra URL. Una restricción única y un trigger impiden dos configuraciones actuales y la edición/reactivación de enlaces históricos. La limpieza toma la fecha efectiva del enlace actual más 10 días, comprobando reservas de todos los enlaces. Esto reemplaza la regla anterior que calculaba el plazo con todos los enlaces. La migración de limpieza del 21 fue aplicada y su revisión SQL confirmada; el despliegue/activación de la tarea y las pruebas simultáneas siguen pendientes.

Validación local: 17 pruebas de backend y 11 de limpieza aprobadas; TypeScript de backend/frontend y ESLint del componente modificado sin errores. Se agregó `supabase/tests/current_link.sql` para comprobar aislamiento A/B, reemplazo, historial, administración, reservas y limpieza; no se ejecutó contra PostgreSQL (sin psql y Docker apagado). Migración nueva no aplicada a Supabase. Sin commits ni push.


### 2026-11-22 — Límite mínimo al editar

Confirmado que editar conserva las descargas realizadas: con 3 utilizadas, los límites 1 y 2 se rechazan en backend y BD. La pantalla ahora deshabilita esos presets y explica que el límite es total, no descargas adicionales. El campo personalizado conserva el mínimo dinámico y la validación antes de enviar. Un límite de 3 deja 0 disponibles; aumentarlo a 5 deja 2. Se agregó una prueba de rechazo de límites inferiores sin escrituras. Esta mejora no necesita otra migración.


### 2026-11-22 — Prueba manual de limpieza autorizada

Karol confirmó aislamiento de configuraciones A/B y reemplazo de contraseña conservando URL. La consulta actual de limpieza devolvió únicamente 243733flayer.pdf, sin reservas y elegible desde el 14 de noviembre. Autorizó eliminarlo sin copia. El intento de revisión remota desde el agente falló por conexión, sin mutaciones. Se preparó backend/scripts/limpiar-archivo.mjs para ejecutar localmente el trabajador existente limitado a un ID, sin purgar eventos ni activar programación. Sintaxis y 11 pruebas del trabajador aprobadas; ejecución real pendiente del resultado en su equipo.


### 2026-11-22 — Registro sin confirmación de correo

Karol solicita permitir registro e inicio de sesión sin confirmar correo. Requiere desactivar Confirm email en Authentication > Sign In / Providers > Email del proyecto alojado; el cambio remoto sigue pendiente de confirmación. El formulario ya maneja la sesión inmediata devuelta por signUp, valida en backend y abre Mis archivos. Se reemplazó la ayuda técnica sobre configuración de Supabase por una indicación para el usuario. Se conserva el manejo de confirmación cuando el proveedor no entregue sesión. No se cambian roles ni validación de contraseña.


### 2026-11-22 — Confirmaciones manuales y cierre de pruebas

Karol confirmó el registro sin confirmación de correo tras habilitar el proveedor Email y desactivar Confirm email. También confirmó borrado manual de un PDF (revisados 1, borrados 1, errores 0, archivoEliminado true), despliegue de limpiar-archivos, revisión alojada sin candidatos y Cron safelink-limpieza-diaria activo con horario 0 9 * * * (03:00 America/Mexico_City), configurado en modo ejecutar. Queda por verificar la respuesta real de la primera llamada programada, además del historial SQL de Cron.

Pruebas por cerrar: API administrativa con usuario normal/sin sesión, acceso entre usuarios propietarios distintos, concurrencia del último cupo de descarga, actividad reciente y escalamiento completo del bloqueo. Validaciones de carga/cuotas y compilación de producción deben revisarse al cerrar la entrega. No se consideran aprobadas solo por existir código o pruebas simuladas.


### 2026-11-22 — Actividad reciente visible al abrir

Karol confirmó API: GET /api/admin/panel sin sesión devuelve 401; panel, eventos y revocación con usuario normal devuelven 403. La cuenta B no ve configuración del archivo de A en pantalla y GET /api/enlaces/archivo/:id devuelve 404.

Durante la prueba de actividad reciente el botón parecía no responder porque la sección se insertaba al final, debajo de toda la tabla de archivos. Se movió inmediatamente después del encabezado del panel, antes de las métricas. El botón ahora alterna Actividad reciente/Ocultar actividad y declara aria-controls. Se conservan carga, errores, paginación y autorización. La visualización de eventos reales sigue pendiente de confirmación manual.


### 2026-11-22 — Cierre de pruebas y preparación del despliegue

Karol confirmó actividad reciente con descarga exitosa e intento rechazado; validaciones de pantalla de extensión .txt, tamaño superior a 10 MB, carga válida con incremento de contador, cuota 10/10 con rechazo del archivo 11 y vencimiento superior a 15 días. Confirmó funcionamiento esperado del bloqueo completo y su reinicio. Decisión explícita: conservar el bloqueo compartido por enlace, sin cookie, aceptando que afecta a todos sus visitantes. Concurrencia y primera ejecución automática continúan pendientes.

Solicita desplegar antes de la prueba entre personas. Compilación backend aprobada; el build de frontend falló al descargar Geist y Geist Mono desde Google Fonts por falta de conexión en este entorno. No se ha publicado ni confirmado un build frontend de producción. Se propuso Vercel para frontend y Render para backend con Supabase existente; elección pendiente de respuesta. Deben configurarse NEXT_PUBLIC_API_URL, FRONTEND_URL, credenciales separadas por servicio y URLs de Auth, con la URL pública definitiva; los enlaces ya copiados con localhost no se transforman al cambiar la variable. Sin commits ni push durante esta preparación.

Preparación de build: se retiraron next/font/google Geist y Geist Mono, que no eran usados por las pantallas (body ya define Arial y campos secretos usan monospace). Las variables Tailwind ahora usan esas mismas familias disponibles localmente. El nuevo build superó la descarga de fuentes pero Turbopack falló al lanzar/conectar el subproceso de transformación CSS en este entorno; no se da el build de producción por aprobado. Se mantiene pendiente comprobarlo en el equipo de Karol o en el proveedor.


### 2026-11-22 — Build de producción confirmado en el equipo de Karol

Karol eligió Vercel para frontend y Render para backend. Actualizó next y eslint-config-next a 16.4.6, reflejados en package.json y package-lock.json. El último resultado aportado de npm run build muestra compilación, TypeScript, recolección de datos, generación 11/11 y optimización completadas. Errores anteriores de módulos internos aparecieron durante cambios de node_modules en el servidor de desarrollo; el build final fue correcto y no requiere editar esos imports. Backend compilado previamente. Falta revisar las 7 vulnerabilidades moderadas reportadas por npm (separar producción/desarrollo), sincronizar los cambios seleccionados con GitHub sin incluir secretos/artefactos, desplegar Render y Vercel y comprobar las URLs públicas. No se realizaron commits, push ni despliegue del sitio desde el agente.


### 2026-11-22 — Exclusiones antes de publicar

Karol aportó npm audit --omit=dev del frontend: 0 vulnerabilidades. Se excluyeron /.postman/, /postman/ y /tmp/pruebas-carga/ del Git raíz; no se borraron archivos ni se modificó el índice de Git. Se conservan .env.example, código, lockfiles, documentación, migraciones, pruebas del proyecto y Cron. Las previsualizaciones ya versionadas en otras subcarpetas tmp no se retiraron en esta operación. Sin commit ni push.


### 2026-11-22 — Eliminación manual y rechazos completos

Implementación solicitada explícitamente por Karol. Nueva migración `202611220002_delete_files_rejections.sql`, pendiente de aplicar: solicitud privada de borrado por propietario, exclusión de reservas y reclamaciones, recuperación manual/automática de pendientes y conteo administrativo exclusivo de rechazos de descarga. Reutiliza tablas/eventos/leases de limpieza; añade una columna y no borra archivos al aplicarse. SQL de reserva y registro mantiene orden de bloqueo archivo antes de enlace. No se tocó el bloqueo compartido progresivo 1/5/15 minutos.

Mis archivos incorpora Eliminar archivo con confirmación y actualización de contador solo al completar Storage y cierre; fallos conservan cuota y permiten reintento. Pendientes no permiten abrir configuración ni guardar cambios. DELETE /api/archivos/:id usa identidad verificada del propietario, impide descargas en curso y no expone ruta ni token interno. Limpieza y Cron ya desplegados pueden recuperar pendientes sin cambiar su código.

El registro de rechazos solo ocurre en POST de descarga. GET no cuenta. Nuevos rechazos incluyen vencimiento, revocación, límite agotado, bloqueo, cupo ocupado y enlace/archivo no disponible; motivos fijos sin secretos. Métrica de últimos 60 días excluye fallos de limpieza/eliminación, conserva históricos de contraseñas erróneas y no inventa datos anteriores.

Pendiente validar migración en BD y flujo visual/integración real antes del despliegue. No se ejecutó SQL remoto, no se borraron archivos reales y no se hizo commit ni push. Instrucciones de actualización en docs/LIMPIEZA.md.
