import type { Request, RequestHandler } from "express";
import { isIP } from "node:net";

const maximoPeticiones = 100;
const ventanaMs = 60_000;

function claveCliente(request: Request): string {
  const ipProxy = process.env.RENDER === "true" ? request.get("CF-Connecting-IP") : undefined;
  const ip = ipProxy && isIP(ipProxy) ? ipProxy : request.socket.remoteAddress;
  const direccion = ip?.split("%", 1)[0] ?? "";
  if (isIP(direccion) === 4) return direccion;
  if (isIP(direccion) !== 6) return "desconocida";

  const ipv6 = new URL(`http://[${direccion}]/`).hostname.slice(1, -1);
  if (ipv6.startsWith("::ffff:")) {
    const [alto, bajo] = ipv6.slice("::ffff:".length).split(":").map((grupo) => parseInt(grupo, 16));
    return [alto >> 8, alto & 255, bajo >> 8, bajo & 255].join(".");
  }

  const [inicio, fin] = ipv6.split("::");
  const grupos = inicio ? inicio.split(":") : [];
  if (fin !== undefined) {
    const gruposFinales = fin ? fin.split(":") : [];
    grupos.push(...Array<string>(8 - grupos.length - gruposFinales.length).fill("0"), ...gruposFinales);
  }
  return `${grupos.slice(0, 4).join(":")}::/64`;
}

export function crearLimitePeticiones(): RequestHandler {
  const ventanas = new Map<string, { peticiones: number; venceEn: number }>();
  let siguienteLimpieza = 0;

  return (request, response, next) => {
    const ahora = Date.now();
    if (ahora >= siguienteLimpieza) {
      for (const [clave, ventana] of ventanas) {
        if (ahora >= ventana.venceEn) ventanas.delete(clave);
      }
      siguienteLimpieza = ahora + ventanaMs;
    }

    const clave = claveCliente(request);
    let ventana = ventanas.get(clave);
    if (!ventana || ahora >= ventana.venceEn) {
      ventana = { peticiones: 0, venceEn: ahora + ventanaMs };
      ventanas.set(clave, ventana);
    }

    if (ventana.peticiones >= maximoPeticiones) {
      return response
        .set("Retry-After", String(Math.ceil((ventana.venceEn - ahora) / 1000)))
        .set("Cache-Control", "no-store")
        .status(429)
        .json({ error: "Demasiadas solicitudes. Inténtalo más tarde." });
    }

    ventana.peticiones++;
    next();
  };
}
