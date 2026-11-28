import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import test from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
const { app } = await import("../src/app.ts");

test("La API cuenta por cliente, responde 429 y restablece el cupo al vencer", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const origen = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const anterior = process.env.RENDER;
  delete process.env.RENDER;
  t.after(() => {
    if (anterior === undefined) delete process.env.RENDER;
    else process.env.RENDER = anterior;
  });

  function consulta(ruta, cabeceras = {}, method = "GET") {
    return new Promise((resolve, reject) => {
      const fragmentos = [];
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          fragmentos.push(chunk);
          callback();
        },
      });
      Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
      const request = new IncomingMessage(socket);
      request.method = method;
      request.url = ruta;
      request.headers = { origin: origen, ...Object.fromEntries(
        Object.entries(cabeceras).map(([nombre, valor]) => [nombre.toLowerCase(), valor]),
      ) };

      const response = new ServerResponse(request);
      response.assignSocket(socket);
      response.once("error", reject);
      response.once("finish", () => {
        const salida = Buffer.concat(fragmentos).toString("utf8");
        resolve({
          status: response.statusCode,
          cabecera: (nombre) => response.getHeader(nombre),
          cuerpo: salida.slice(salida.indexOf("\r\n\r\n") + 4),
        });
        socket.destroy();
      });
      app(request, response);
    });
  }

  for (let i = 0; i < 100; i++) {
    const ruta = i % 2 === 0 ? "/api/auth/me" : "/api/archivos";
    const response = await consulta(ruta);
    assert.equal(response.status, 401);

  }

  const sobreCupoLocal = await consulta("/api/auth/me", {
    "X-Forwarded-For": "198.51.100.1",
    "CF-Connecting-IP": "198.51.100.2",
  });
  assert.equal(sobreCupoLocal.status, 429);
  assert.equal(sobreCupoLocal.cabecera("Retry-After"), "60");
  assert.match(sobreCupoLocal.cabecera("Access-Control-Expose-Headers") ?? "", /Retry-After/i);
  assert.deepEqual(JSON.parse(sobreCupoLocal.cuerpo), {
    error: "Demasiadas solicitudes. Inténtalo más tarde.",
  });

  const preflight = await consulta("/api/auth/me", {
    "Access-Control-Request-Method": "GET",
  }, "OPTIONS");
  assert.equal(preflight.status, 204);

  process.env.RENDER = "true";
  const otroCliente = await consulta("/api/auth/me", { "CF-Connecting-IP": "198.51.100.2" });
  assert.equal(otroCliente.status, 401);


  t.mock.timers.tick(59_001);
  const aunBloqueado = await consulta("/api/archivos");
  assert.equal(aunBloqueado.status, 429);
  assert.equal(aunBloqueado.cabecera("Retry-After"), "1");


  t.mock.timers.tick(999);
  const restaurado = await consulta("/api/archivos");
  assert.equal(restaurado.status, 401);

});
