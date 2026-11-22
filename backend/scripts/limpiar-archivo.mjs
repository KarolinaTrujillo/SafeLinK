// Ejecución manual de la limpieza de UN archivo. Las claves se leen de backend/.env.
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../src/config/supabase.ts';
import { crearHandler } from '../../supabase/functions/limpiar-archivos/limpieza.ts';

const [id, modo = 'revision', ...extras] = process.argv.slice(2);
if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? '') ||
    !['revision', 'ejecutar'].includes(modo) || extras.length) {
  console.error('Uso: node --import tsx scripts/limpiar-archivo.mjs UUID [revision|ejecutar]');
  process.exit(1);
}
async function rpc(nombre, argumentos) {
  const { data, error } = await supabaseAdmin.rpc(nombre, argumentos);
  if (error) throw new Error('No se pudo completar la operación en Supabase.');
  return data;
}
// Se reutiliza el trabajador probado; el plan queda limitado al ID solicitado.
// La purga general de eventos se reserva para la tarea diaria.
const almacen = {
  async revisar() {
    const plan = await rpc('revisar_limpieza');
    return { ...plan, archivos: plan.archivos.filter(a => a.id === id) };
  },
  preparar: () => rpc('preparar_limpieza'),
  reclamar: archivoId => rpc('reclamar_limpieza', { p_id: archivoId }),
  async borrarObjeto(ruta) {
    const { error } = await supabaseAdmin.storage.from('safelink-files').remove([ruta]);
    if (error) throw new Error('No se pudo borrar el objeto.');
  },
  cerrar: (archivoId, token, exito) => rpc('cerrar_limpieza', { p_id: archivoId, p_token: token, p_exito: exito }),
  purgarEventos: async () => 0,
};
const secreto = randomBytes(32).toString('hex');
const handler = crearHandler(secreto, () => almacen);
const respuesta = await handler(new Request('http://localhost/limpieza-manual', {
  method: 'POST', headers: { 'x-limpieza-secret': secreto, 'Content-Type': 'application/json' },
  body: JSON.stringify({ modo }),
}));
console.log(JSON.stringify(await respuesta.json(), null, 2));
if (!respuesta.ok || respuesta.status === 207) process.exitCode = 1;
if (modo === 'ejecutar' && respuesta.status === 200) {
  const { data, error } = await supabaseAdmin.from('archivos').select('id, estado_limpieza').eq('id', id).maybeSingle();
  if (error) { console.error('No se pudo verificar el resultado final.'); process.exitCode = 1; }
  else console.log(JSON.stringify({ archivoEliminado: data === null, archivoRestante: data }));
}
