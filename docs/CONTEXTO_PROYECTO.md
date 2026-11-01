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
2. El emisor inicia sesión para subir y administrar sus archivos.
3. El emisor crea un enlace con vencimiento y máximo de descargas; puede protegerlo con contraseña.
4. El emisor comparte el enlace y, si configuró contraseña, la envía por otro canal.
5. El receptor no necesita cuenta; presenta el enlace/código y contraseña si aplica.
6. La API verifica vigencia, revocación, bloqueo, contraseña y límite antes de permitir la descarga.
7. El panel administrativo muestra métricas básicas y permite visualizar/gestionar la información conforme a permisos.

## 5. Reglas de negocio acordadas

- Cada usuario puede tener **hasta 10 archivos activos** (propuesta acordada en conversación).
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
- Habilitar recuperación de contraseña y verificación de correo con Supabase Auth dentro de límites gratuitos, comprobando la configuración del proyecto y URLs de retorno.

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

- Activar RLS en las tablas expuestas y diseñar políticas explícitas por operación/rol; no asumir que habilitar RLS por sí solo crea autorización.
- Configurar grants de Data API junto con RLS. Mantener la exposición automática de nuevas tablas desactivada y conceder acceso solo cuando la política esté lista.
- Políticas de Storage deben asegurar aislamiento por propietario y bucket privado.
- Claves públicas de cliente solo son aceptables junto con RLS/grants correctos. `service_role`, contraseña PostgreSQL y secretos solo en backend/entorno privado; nunca en frontend ni repositorio.
- Validar autenticación y autorización en servidor para cada recurso. No confiar en IDs, propietario, MIME o rutas enviados por cliente.
- Limitar tamaño y frecuencia de solicitudes para reducir abuso de almacenamiento y fuerza bruta.
- Usar HTTPS en despliegue.
- Manejar mensajes de rechazo sin revelar innecesariamente existencia o metadatos de archivos privados.
- Mantener eventos mínimos y sanitizados.

## 8. Estructura de carpetas recomendada

La propuesta académica **no fija** estructura de directorios. Se acordó una raíz común y un único repositorio para separar responsabilidades y poder desplegar frontend y backend independientemente:

```text
SafeLinK/
├── README.md
├── .gitignore
├── docs/
│   ├── BITACORA.md
│   ├── CONTEXTO_PROYECTO.md
│   ├── arquitectura.md
│   ├── modelo-datos.md
│   ├── matriz-riesgos.md
│   └── pruebas/
├── frontend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── app/                 # rutas/páginas Next.js
│       ├── components/          # componentes reutilizables
│       ├── features/            # auth, archivos, enlaces, administración
│       ├── lib/                 # cliente Supabase y utilidades
│       └── types/
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── app.ts               # configuración Express
│       ├── server.ts            # arranque HTTP
│       ├── config/              # configuración/env validado
│       ├── routes/              # rutas REST
│       ├── controllers/         # HTTP entrada/salida
│       ├── middleware/          # JWT, validación, límites, errores
│       ├── services/            # reglas de negocio
│       ├── repositories/        # acceso a datos
│       ├── validators/          # esquemas de entrada/archivo
│       └── types/
└── supabase/
    └── migrations/              # SQL versionado: tablas, constraints, RLS, policies
```

Se creó la raíz común `SafeLinK/` con `frontend/`, `backend/`, `docs/` y `supabase/migrations/`, y se inicializó un solo repositorio Git. Los documentos viven en `docs/`. Esta organización es una decisión del equipo, no una exigencia de la propuesta. Las carpetas originales vacías `SafeLinK-Frontend` y `SafeLinK-Backend` se conservaron por ahora; usar la nueva raíz `SafeLinK/` en VS Code. No guardar secretos en `.env.example`; incluir solo nombres de variables y valores ficticios.

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

## 10. Fuera de alcance por ahora

- Cifrado de extremo a extremo.
- Antivirus o APIs externas de análisis de malware.
- Registro de IP.
- MFA o administración avanzada de sesiones.
- Funciones ajenas a la propuesta académica que aumenten el tiempo de entrega.

## 11. Cómo mantener este documento

Actualizar este archivo cuando la estudiante confirme una decisión o cambie un requisito. Distinguir siempre entre: **acordado**, **propuesta por confirmar** y **sugerencia técnica**. Registrar fecha y motivo del cambio en `BITACORA.md`.
