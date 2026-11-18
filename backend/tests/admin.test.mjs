import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
const { supabaseAdmin } = await import("../src/config/supabase.ts");
const { requireAuth } = await import("../src/middleware/auth.ts");
const { requireAdmin } = await import("../src/middleware/admin.ts");
const { adminRouter } = await import("../src/routes/admin.ts");
const ruta = (path, method) => adminRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
function respuesta() {
  return { locals: {}, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
function perfil(t, rol, error = null) {
  t.mock.method(supabaseAdmin, "from", (tabla) => {
    assert.equal(tabla, "perfiles");
    const query = { select(campos) { assert.equal(campos, "rol"); return query; }, eq(campo, valor) { assert.equal(campo, "id"); assert.equal(valor, "usuario-verificado"); return query; }, async maybeSingle() { return { data: rol ? { rol } : null, error }; } };
    return query;
  });
}

test("Las rutas administrativas están detrás de autenticación y comprobación de rol", () => {
  assert.equal(adminRouter.stack[0].handle, requireAuth);
  assert.equal(adminRouter.stack[1].handle, requireAdmin);
});

test("Sin sesión no se consulta el rol ni se accede al panel", async (t) => {
  t.mock.method(supabaseAdmin, "from", () => assert.fail("No debe consultar datos"));
  const res = respuesta();
  await requireAuth({ header: () => undefined }, res, () => assert.fail("No debe continuar"));
  assert.equal(res.code, 401);
});

test("Un usuario común no obtiene acceso enviando un rol falso desde el cliente", async (t) => {
  perfil(t, "usuario");
  const res = respuesta(); res.locals.userId = "usuario-verificado";
  await requireAdmin({ body: { rol: "administrador" } }, res, () => assert.fail("No debe continuar"));
  assert.equal(res.code, 403);
});

test("El rol administrador se consulta por la identidad validada por Auth", async (t) => {
  perfil(t, "administrador");
  const res = respuesta(); res.locals.userId = "usuario-verificado";
  let permitido = false;
  await requireAdmin({}, res, () => { permitido = true; });
  assert.equal(permitido, true);
});

test("Un error al comprobar el rol deniega el acceso", async (t) => {
  perfil(t, null, { code: "fallo-simulado" });
  const res = respuesta(); res.locals.userId = "usuario-verificado";
  await requireAdmin({}, res, () => assert.fail("No debe continuar"));
  assert.equal(res.code, 503);
});

test("Filtros y paginación inválidos no llegan a Supabase", async (t) => {
  t.mock.method(supabaseAdmin, "rpc", () => assert.fail("No debe consultar"));
  for (const query of [{ pagina: "-1" }, { pagina: "1.5" }, { estado: "desconocido" }, { busqueda: "a".repeat(151) }]) {
    const res = respuesta();
    await ruta("/panel", "get")({ query }, res);
    assert.equal(res.code, 400);
  }
});

test("La lista aplica búsqueda, filtro y página en servidor", async (t) => {
  const datos = { metricas: { archivos: 2 }, archivos: [], total: 0 };
  t.mock.method(supabaseAdmin, "rpc", async (nombre, args) => {
    assert.equal(nombre, "consultar_panel_admin");
    assert.deepEqual(args, { p_busqueda: "tesis", p_estado: "Activo", p_pagina: 2 });
    return { data: datos, error: null };
  });
  const res = respuesta();
  await ruta("/panel", "get")({ query: { busqueda: " tesis ", estado: "Activo", pagina: "2" } }, res);
  assert.deepEqual(res.body, datos);
});

test("La revocación administrativa usa la RPC transaccional y no devuelve secretos", async (t) => {
  const id = "11111111-1111-4111-8111-111111111111";
  t.mock.method(supabaseAdmin, "rpc", async (nombre, args) => {
    assert.equal(nombre, "revocar_enlace_admin"); assert.deepEqual(args, { p_enlace_id: id });
    return { data: true, error: null };
  });
  const res = respuesta();
  await ruta("/enlaces/:id/revocar", "post")({ params: { id } }, res);
  assert.deepEqual(res.body, { revocado: true });
});
