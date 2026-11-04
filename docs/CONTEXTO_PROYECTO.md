# SafeLinK — Contexto, reglas y requerimientos

## 1. Propósito

SafeLinK es un proyecto académico de Seguridad Informática: plataforma web para compartir archivos con controles sobre quién puede acceder, durante cuánto tiempo y cuántas veces. Se debe conservar la propuesta tecnológica porque forma parte de la evaluación. El alcance debe mantenerse realizable en aproximadamente dos semanas y dentro de planes gratuitos.

## 2. Fuente de requisitos

La propuesta académica describe el problema, alcance y arquitectura. Los acuerdos posteriores de la estudiante concretan controles y límites. Si una regla de este documento contradice la propuesta evaluada, confirmar antes de cambiarla. Las sugerencias aún no aprobadas están marcadas como pendientes/propuestas y no son requisitos definitivos.

## 3. Stack que no se debe cambiar

- **Frontend:** Next.js, TypeScript y Tailwind CSS.
- **Backend/API:** Node.js y Express, API REST.
- **Datos y autenticación:** PostgreSQL en Supabase y Supabase Auth.
- **Archivos:** Supabase Storage en bucket privado.
- **Seguridad/pruebas:** JWT, HTTPS y Postman.
- **Despliegue previsto:** Vercel para frontend y Render para backend, usando planes gratuitos.

La propuesta define estas capas y tecnologías; no especifica nombres de carpetas ni una estructura de repositorio concreta.

## 4. Usuarios y casos principales

1. Cualquier persona puede registrarse; el registro es abierto.
   - **Correo durante desarrollo:** la confirmación queda pendiente y se desactivará temporalmente en Supabase para probar registro e inicio de sesión sin SMTP. Al desactivarla, Supabase marca automáticamente el correo como confirmado, aunque no valida que el usuario lo controle. Reactivarla y probar el envío antes del despliegue. La recuperación de contraseña sigue dependiendo del servicio de correo.
2. El emisor inicia sesión para subir y administrar sus archivos.
3. El emisor crea un enlace con vencimiento y máximo de descargas; puede protegerlo con contraseña.
4. El emisor comparte el enlace y, si configuró contraseña, la envía por otro canal.
5. El receptor no necesita cuenta; presenta el enlace/código y contraseña si aplica.
6. La API verifica vigencia, revocación, bloqueo, contraseña y límite antes de permitir la descarga.
7. El panel administrativo muestra métricas básicas y permite visualizar/gestionar la información conforme a permisos.

## 5. Reglas de negocio acordadas

- Cada usuario puede tener **hasta 10 archivos activos** (propuesta acordada en conversación).
- Cada usuario tiene una cuota prevista de **100,000,000 bytes (100 MB decimal)** de almacenamiento; se valida al reservar metadatos de carga.
- El tamaño máximo de un archivo es **10,000,000 bytes (10 MB decimal)**.
- Tipos permitidos: **PDF, JPG, PNG y DOCX**. Rechazar ejecutables, scripts y archivos comprimidos genéricos. Validar en servidor el contenido real; no confiar solo en extensión o MIME declarado por navegador.
- Solo el propietario puede administrar sus archivos y enlaces.
- El bucket de Storage debe ser privado. No crear URLs públicas permanentes; la API debe autorizar antes de entregar el archivo (por ejemplo, URL firmada de corta duración).
- El receptor descarga sin cuenta usando el secreto del enlace y, opcionalmente, una contraseña.
- El token del enlace no se almacena en claro: generar uno aleatorio de alta entropía y persistir su hash.
- La contraseña opcional del enlace se almacena mediante una función KDF con sal (por ejemplo, Argon2id, bcrypt o scrypt), no como texto ni con SHA-256 simple. Se comunica por un canal distinto al enlace.
- Los enlaces tienen fecha de expiración, límite de descargas y pueden revocarse. Un enlace vencido, revocado, agotado o bloqueado no autoriza la descarga. Límites de descargas acordados: presets 1, 3, 5 y 10; valor personalizado hasta un máximo de 20. Vencimientos acordados: presets 1 h, 12 h, 1 d, 2 d y opciones de 5 d a 10 d; personalizado hasta 15 d. Se interpreta “5 d hasta 10 d” como disponibilidad de cada día en ese intervalo.
- Solo las descargas exitosas y completadas cuentan; las transferencias fallidas o interrumpidas no deben consumir el límite. La autorización/reserva debe ser atómica para evitar excederlo con solicitudes simultáneas. La solución técnica debe poder confirmar finalización (por ejemplo, la API transmite el archivo); una URL firmada entregada directamente no permite asumir que la descarga terminó.
- Propuesta de bloqueo: después de 5 intentos incorrectos, bloquear progresivamente 1, 5 y 15 minutos. Falta definir la ventana de intentos, el reinicio de contador y el nivel tras desbloqueo.
- Guardar datos personales mínimos. No registrar IP ni credenciales, tokens o contraseñas en eventos.
- Registrar métricas/eventos básicos: descargas exitosas, accesos rechazados, archivos por usuario, total de archivos y acciones administrativas relevantes. Conservar eventos 60 días y eliminarlos después.
- Tras vencimiento/revocación de todos los enlaces utilizables, bloquear acceso de inmediato. Eliminar físicamente el archivo aproximadamente 10 días después, mediante una tarea diaria Supabase Cron que invoque una Edge Function privada (confirmar disponibilidad/costo en Free). Borrar primero el objeto de Storage y después los metadatos. Un archivo pendiente de limpieza sigue ocupando uno de los 10 espacios hasta confirmar el borrado del objeto.
- Asignación de rol administrador solo desde un contexto confiable; nunca permitir autoasignación durante el registro.
- Habilitar recuperación de contraseña y verificación de correo con Supabase Auth dentro de límites gratuitos, comprobando la configuración del proyecto y URLs de retorno. La confirmación de correo se mantiene pendiente; temporalmente desactivada en el entorno de desarrollo y debe reactivarse antes del despliegue.

## 6. Requerimientos funcionales mínimos

- **RF-01 Registro y autenticación:** registro abierto, inicio/cierre de sesión, verificación de correo y recuperación de contraseña.
- **RF-02 Carga:** permitir solo usuarios autenticados; validar tamaño, tipo/contenido y cupo por usuario.
- **RF-03 Administración de archivos:** listar y administrar solo los archivos propios; revocar enlaces asociados.
- **RF-04 Enlaces seguros:** generar y validar enlace temporal con máximo de descargas y contraseña opcional.
- **RF-05 Descarga de receptor:** permitir acceso sin cuenta solo si todas las condiciones se cumplen.
- **RF-06 Auditoría/métricas:** registrar acciones mínimas y mostrar conteos al rol administrativo.
- **RF-07 Limpieza:** hacer inaccesibles los archivos elegibles y eliminar Storage/metadatos conforme a la retención definida.
- **RF-08 Validación de roles:** proteger las operaciones administrativas fuera del control del cliente.

## 7. Requerimientos de seguridad

- Activar RLS en tablas propias. El diseño acordado es que el navegador acceda a los datos mediante la API Express, no directamente por la Data API; por eso anon/authenticated no reciben permisos directos y las tablas quedan sin políticas cliente (denegación por defecto). Express valida JWT, propietario y rol antes de usar la clave privada `service_role`.
- Mantener desactivada la exposición automática de nuevas tablas. La migración revoca grants de `anon` y `authenticated` y concede operaciones al rol privado `service_role`, usado solo por Express.
- El bucket de Storage es privado y no permite acceso directo del cliente; Express valida propietario/enlace antes de descargar, cargar o borrar objetos usando `service_role`.
- Las cargas se envían al backend Express, que comprueba la sesión, tamaño, extensión, MIME y firma básica del contenido. El backend genera la ruta de Storage y registra metadatos con un bloqueo de perfil para aplicar los topes por usuario; nunca aceptar propietario o ruta desde el navegador.
- Claves públicas de cliente solo son aceptables junto con RLS/grants correctos. `service_role`, contraseña PostgreSQL y secretos solo en backend/entorno privado; nunca en frontend ni repositorio.
- Validar autenticación y autorización en servidor para cada recurso. No confiar en IDs, propietario, MIME o rutas enviados por cliente.
- La interfaz puede mostrar opciones de administración solo con el rol devuelto por la API Express; el rol se consulta en `perfiles` después de validar el JWT. Nunca confiar en un rol editable enviado por el navegador.
- Limitar tamaño y frecuencia de solicitudes para reducir abuso de almacenamiento y fuerza bruta.
- Usar HTTPS en despliegue.
- Manejar mensajes de rechazo sin revelar innecesariamente existencia o metadatos de archivos privados.
- Mantener eventos mínimos y sanitizados.

## 8. Estructura actual y crecimiento acordado

La propuesta académica **no fija** nombres de carpetas. Se acordó mantener un monorepo, con frontend, backend, documentación y migraciones separados. La estructura debe crecer conforme se implementen las vistas; no crear carpetas o archivos vacíos para funcionalidades futuras.

### Estructura que existe ahora

```text
SafeLinK/
├── .gitignore
├── docs/
│   ├── BITACORA.md
│   └── CONTEXTO_PROYECTO.md
├── frontend/
│   ├── app/
│   │   ├── iniciar-sesion/
│   │   │   ├── page.tsx
│   │   │   └── iniciarSesion.module.css
│   │   ├── registro/
│   │   │   ├── page.tsx
│   │   │   └── registro.module.css
│   │   ├── mis-archivos/
│   │   │   ├── page.tsx
│   │   │   └── misArchivos.module.css
│   │   ├── subir-archivo/
│   │   │   ├── page.tsx
│   │   │   └── subirArchivo.module.css
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx             # redirige a /registro
│   ├── components/
│   │   ├── auth/
│   │   │   ├── InicioSesionForm.tsx
│   │   │   └── RegistroForm.tsx
│   │   └── archivos/
│   │       ├── MisArchivosVista.tsx
│   │       └── SubirArchivoVista.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   └── supabase.ts
│   ├── public/                  # recursos estáticos actuales de Next.js
│   ├── .gitignore
│   ├── .env.example
│   ├── eslint.config.mjs
│   ├── next.config.ts
│   ├── package.json
│   ├── package-lock.json
│   ├── README.md
│   └── tsconfig.json
├── backend/
│   ├── src/
│   │   ├── config/supabase.ts
│   │   ├── middleware/auth.ts
│   │   ├── app.ts
│   │   └── server.ts
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
└── supabase/
    └── migrations/
        ├── 202611010001_initial_schema.sql
        └── 202611020001_upload_quota.sql
```

### Cómo se ampliará cuando se implementen las siguientes vistas

- Las páginas y rutas de Next.js se agregan bajo `frontend/app/`, una carpeta por ruta.
- Los componentes reutilizables se agrupan por área dentro de `frontend/components/`; actualmente `auth/` y `archivos/` ya contienen componentes.
- Las funciones compartidas del navegador permanecen en `frontend/lib/`; tipos compartidos pueden agregarse en `frontend/types/` cuando se necesiten.
- El backend conserva su estructura simple actual. Al agregar funciones, se incorporan rutas y lógica por módulo dentro de `backend/src/`; no crear capas vacías por anticipado.
- SQL nuevo o cambios de esquema se guardan como nuevas migraciones en `supabase/migrations/`.
- Las pantallas previstas son registro, inicio de sesión, recuperación/restablecimiento de contraseña, mis archivos, carga, configuración de enlace, descarga pública y administración. Las variaciones de error o bloqueo serán estados de esas páginas, no rutas independientes salvo que el flujo lo requiera.

La estructura es una decisión del equipo y puede ajustarse con acuerdo, sin cambiar el stack obligatorio. No guardar secretos en `.env.example`; incluir solo nombres de variables y valores ficticios.

## 9. Pendientes por decidir antes de cerrar el diseño

- [x] Límite exacto: 10,000,000 bytes (10 MB decimal).
- [x] Los archivos pendientes de limpieza ocupan cupo hasta confirmar su eliminación de Storage.
- [x] Bloqueo de contraseña: 5 fallos consecutivos causan 1 minuto; los siguientes grupos de 5 causan 5 y 15 minutos, manteniéndose en 15. Un acierto reinicia contador y nivel.
- [ ] Diseñar cómo confirmar descargas exitosas completadas sin contar transferencias fallidas/interrumpidas y sin exceder el máximo ante concurrencia.
- [x] Máximo de descargas: presets 1, 3, 5 y 10; valor personalizado hasta 20.
- [x] Vencimientos de enlaces: presets 1 h, 12 h, 1 d, 2 d, 5 d–10 d; fecha/hora personalizada hasta 15 d.
- [ ] Confirmar en el proyecto que Supabase Cron puede usarse dentro del plan Free sin costo adicional; implementar una ejecución diaria de limpieza y purga de eventos vencidos.
- [x] Retención de `eventos_acceso`: 60 días; métricas visibles administrativas básicas.
- [x] Usar raíz común y un solo repositorio (monorepo); creados `frontend/`, `backend/`, `docs/` y `supabase/migrations/`.
- [ ] Confirmar límites gratuitos vigentes de Supabase/Vercel/Render antes del despliegue.
- [ ] Configurar un método de envío de correo, comprobar verificación y recuperación, y reactivar la confirmación antes del despliegue.

## 10. Fuera de alcance por ahora

- Cifrado de extremo a extremo.
- Antivirus o APIs externas de análisis de malware.
- Registro de IP.
- MFA o administración avanzada de sesiones.
- Funciones ajenas a la propuesta académica que aumenten el tiempo de entrega.

## 11. Cómo mantener este documento

Actualizar este archivo cuando la estudiante confirme una decisión o cambie un requisito. Distinguir siempre entre: **acordado**, **propuesta por confirmar** y **sugerencia técnica**. Registrar fecha y motivo del cambio en `BITACORA.md`.


### Navegación compartida (2026-11-03)

Las vistas Mis archivos y Subir archivo utilizan `frontend/components/layout/Topbar.tsx` y `Topbar.module.css`. Las siguientes vistas privadas deben reutilizarlos sin duplicar estilos de navegación. Cada vista entrega el correo de la sesión y el rol consultado en el backend; la topbar marca la ruta activa y ofrece cierre de sesión. Administración se muestra únicamente para el rol administrador; la autorización real de operaciones sigue correspondiendo al backend.

La pantalla de carga usa capacidad real, selección por clic o arrastre, eliminación de la selección y el último resultado de validación de esta pantalla. La comprobación inicial de extensión y tamaño no equivale a validar el contenido en el servidor. Después de cargar, el botón abre Compartir enlace con el archivo recién subido seleccionado.


### Configuración de enlaces (2026-11-03)

Implementada la ruta `frontend/app/compartir-enlace/page.tsx`, con estilos en `compartirEnlace.module.css`, componente `frontend/components/archivos/ConfigurarEnlaceVista.tsx` y funciones de API en `frontend/lib/api.ts`. Reutiliza la Topbar. Las rutas del módulo están en `backend/src/routes/enlaces.ts`, montadas desde `app.ts`.

Permite seleccionar un archivo propio, crear enlaces, consultar sus configuraciones, editar vencimiento y límite, generar contraseña opcional y revocar con confirmación. Usa los presets acordados: máximo 15 días desde creación y entre 1 y 20 descargas. Editar no reinicia las descargas realizadas. El backend valida sesión y propiedad del archivo; las ediciones comprueban la versión para evitar sobrescribir cambios anteriores.

El token se guarda como SHA-256 y la contraseña como scrypt con sal aleatoria. La URL completa se entrega al crear; la contraseña solo al crear o reemplazarla. Permanecen temporalmente en memoria de esta vista y deben copiarse antes de salir. Al consultar enlaces existentes no se recuperan secretos ni hashes. No se requiere una nueva migración: se usa `enlaces_compartidos` del esquema inicial.

**Pendiente:** ruta pública `/descargar/[token]`, validación de contraseña del destinatario, bloqueo por intentos, control atómico de descargas y auditoría. Las URL generadas todavía no permiten descargar. También queda la prueba visual y de integración con una sesión real en Supabase.

### 2026-11-04 — Una configuración por enlace

La pantalla Compartir enlace muestra directamente la configuración guardada más recientemente para el archivo. Si no existe ninguna, permite crearla; si la última fue revocada, permite crear un enlace nuevo de manera explícita. Al subir un archivo se abre la configuración. Los enlaces existentes se conservan. La URL secreta y la contraseña originales solo se muestran al generarlas; la descarga pública sigue pendiente.
