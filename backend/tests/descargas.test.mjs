import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { scryptSync } from "node:crypto";

// Ninguna prueba contacta Supabase ni usa las claves locales.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
const { supabaseAdmin } = await import("../src/config/supabase.ts");
const { descargasRouter } = await import("../src/routes/descargas.ts");
const token = "A".repeat(43);
const hashClave = `scrypt:sal-de-prueba:${scryptSync("ClaveDePrueba!23", "sal-de-prueba", 64).toString("hex")}`;
const enlace = {
  id: "enlace", es_actual: true, archivo_id: "archivo", hash_contrasena: hashClave,
  vence_en: new Date(Date.now() + 86400000).toISOString(), maximo_descargas: 5,
  descargas_realizadas: 0, revocado_en: null, bloqueado_hasta: null, intentos_fallidos: 0,
};
const archivo = { nombre_original: "archivo.pdf", tipo_mime: "application/pdf", tamano_bytes: 4, estado_limpieza: "activo" };
const ruta = (metodo) => descargasRouter.stack.find((layer) => layer.route?.methods[metodo]).route.stack[0].handle;
const comprobar = descargasRouter.stack.find((layer) => !layer.route && layer.handle.constructor.name === "AsyncFunction").handle;

class Respuesta extends EventEmitter {
  locals = { enlace, archivo, hashToken: "hash-prueba" };
  code = 200;
  headers = {};
  destroyed = false;
  headersSent = false;
  writableFinished = false;
  status(code) { this.code = code; return this; }
  json(body) { this.body = body; return this; }
  setHeader(key, value) { this.headers[key] = value; }
  send(body) { this.body = body; this.headersSent = true; this.writableFinished = true; this.emit("finish"); this.emit("close"); return this; }
}

test("La información pública no entrega propietario, ruta, hashes ni secreto", async () => {
  const respuesta = new Respuesta();
  await ruta("get")({}, respuesta);
  assert.equal(respuesta.body.nombre, "archivo.pdf");
  assert.deepEqual(Object.keys(respuesta.body).sort(), ["nombre", "tipoMime", "tamanoBytes", "protegido", "intentosRestantes", "bloqueadoHasta"].sort());
});

test("Tokens inválidos y enlaces revocados/vencidos/agotados no entregan metadatos", async (t) => {
  t.mock.method(supabaseAdmin, "from", () => {
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: actual, error: null }; } };
    return query;
  });
  let actual = enlace;
  const invalido = new Respuesta();
  await comprobar({ params: { token: "incorrecto" } }, invalido, () => assert.fail("No debe continuar"));
  assert.equal(invalido.code, 404);
  for (const cambio of [{ es_actual: false }, { revocado_en: new Date().toISOString() }, { vence_en: "2000-01-01" }, { descargas_realizadas: 5 }]) {
    actual = { ...enlace, ...cambio };
    const respuesta = new Respuesta();
    await comprobar({ params: { token } }, respuesta, () => assert.fail("No debe continuar"));
    assert.equal(respuesta.code, 404);
    assert.equal(respuesta.body.nombre, undefined);
  }
});

test("La contraseña se verifica con scrypt y un rechazo no consulta Storage", async (t) => {
  t.mock.method(supabaseAdmin, "rpc", async (nombre, argumentos) => {
    assert.equal(nombre, "reservar_descarga");
    assert.equal(argumentos.p_clave_valida, false);
    return { data: { estado: "clave_incorrecta", intentosRestantes: 4 }, error: null };
  });
  t.mock.method(supabaseAdmin.storage, "from", () => assert.fail("No debe consultar Storage"));
  const respuesta = new Respuesta();
  await ruta("post")({ body: { contrasena: "incorrecta" } }, respuesta);
  assert.equal(respuesta.code, 401);
  assert.equal(respuesta.body.intentosRestantes, 4);
});

test("El bloqueo se respeta antes de comprobar la contraseña", async (t) => {
  t.mock.method(supabaseAdmin, "rpc", () => assert.fail("No debe reservar"));
  const respuesta = new Respuesta();
  respuesta.locals = { ...respuesta.locals, enlace: { ...enlace, bloqueado_hasta: new Date(Date.now() + 60000).toISOString() } };
  await ruta("post")({ body: { contrasena: "incorrecta" } }, respuesta);
  assert.equal(respuesta.code, 429);
});

test("Si falta la migración, devuelve 503 sin consultar Storage ni revelar datos", async (t) => {
  t.mock.method(supabaseAdmin, "rpc", async () => ({ data: null, error: { code: "PGRST202", message: "Función no encontrada" } }));
  t.mock.method(supabaseAdmin.storage, "from", () => assert.fail("No debe consultar Storage"));
  const mensajes = [];
  t.mock.method(console, "error", (...args) => mensajes.push(args.join(" ")));
  const respuesta = new Respuesta();
  await ruta("post")({ body: { contrasena: "ClaveDePrueba!23" } }, respuesta);
  assert.equal(respuesta.code, 503);
  assert.equal(respuesta.body.error, "No se pudo autorizar la descarga. Inténtalo más tarde.");
  assert.ok(mensajes[0].includes("202611150001_public_downloads.sql"));
  assert.ok(!mensajes.join(" ").includes(hashClave));
});

test("Un envío exitoso finaliza su reserva solo una vez", async (t) => {
  const cierres = [];
  t.mock.method(supabaseAdmin, "rpc", async (nombre, args) => {
    if (nombre === "reservar_descarga") {
      assert.equal(args.p_clave_valida, true);
      return { data: { estado: "autorizado", reservaId: "reserva", ruta: "ruta-privada", nombre: "archivo.pdf", tamanoBytes: 4 }, error: null };
    }
    cierres.push(args); return { error: null };
  });
  t.mock.method(supabaseAdmin.storage, "from", () => ({ download: async () => ({ data: new Blob(["test"]), error: null }) }));
  const respuesta = new Respuesta();
  await ruta("post")({ body: { contrasena: "ClaveDePrueba!23" } }, respuesta);
  assert.equal(respuesta.body.toString(), "test");
  assert.ok(respuesta.headers["Content-Disposition"].startsWith("attachment;"));
  assert.deepEqual(cierres, [{ p_reserva_id: "reserva", p_exito: true }]);
});

test("Un fallo de Storage libera la reserva sin sumar una descarga", async (t) => {
  const cierres = [];
  t.mock.method(supabaseAdmin, "rpc", async (nombre, args) => {
    if (nombre === "reservar_descarga") return { data: { estado: "autorizado", reservaId: "reserva", ruta: "ruta-privada" }, error: null };
    cierres.push(args); return { error: null };
  });
  t.mock.method(supabaseAdmin.storage, "from", () => ({ download: async () => ({ data: null, error: new Error("Fallo simulado") }) }));
  const respuesta = new Respuesta();
  await ruta("post")({ body: { contrasena: "ClaveDePrueba!23" } }, respuesta);
  assert.equal(respuesta.code, 503);
  assert.deepEqual(cierres, [{ p_reserva_id: "reserva", p_exito: false }]);
});
