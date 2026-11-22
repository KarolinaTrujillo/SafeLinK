// Pruebas aisladas: no contactan Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { supabaseAdmin } = await import('../src/config/supabase.ts');
const { enlacesRouter } = await import('../src/routes/enlaces.ts');
const id = '11111111-1111-4111-8111-111111111111';
const route = (path, method) => enlacesRouter.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack[0].handle;
const response = () => ({ locals: { userId: 'owner' }, code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } });

test('La consulta del archivo devuelve solo su configuración actual sin el hash de contraseña', async t => {
  const filters = [];
  t.mock.method(supabaseAdmin, 'from', table => {
    const q = {
      select() { return q; }, eq(key, value) { filters.push([table, key, value]); return q; },
      order() { return q; }, maybeSingle: async () => ({ data: { id }, error: null }),
      then(resolve) { resolve({ data: [{ id, hash_contrasena: 'privado' }], error: null }); },
    }; return q;
  });
  const res = response();
  await route('/archivo/:archivoId', 'get')({ params: { archivoId: id } }, res);
  assert.ok(filters.some(f => f[0] === 'archivos' && f[1] === 'propietario_id' && f[2] === 'owner'));
  assert.ok(filters.some(f => f[0] === 'enlaces_compartidos' && f[1] === 'es_actual' && f[2] === true));
  assert.deepEqual(res.body, { enlaces: [{ id, protegido: true }] });
});

test('Guardar conserva la identidad, el contador y la contraseña si solo cambia el límite', async t => {
  const created = new Date().toISOString();
  let changes; const filters = [];
  t.mock.method(supabaseAdmin, 'from', () => {
    const q = { update(data) { changes = data; return q; }, eq(k,v) { filters.push([k,v]); return q; },
      is() { return q; }, select() { return q; }, maybeSingle: async () => ({ data: { id, ...changes, descargas_realizadas: 3 }, error: null }) };
    return q;
  });
  const res = response();
  res.locals.enlace = { id, creado_en: created, actualizado_en: created, hash_contrasena: 'hash-original', descargas_realizadas: 3 };
  res.locals.archivo = { estado_limpieza: 'activo' };
  await route('/:id', 'patch')({ body: { actualizadoEn: created, venceEn: new Date(Date.now()+86400000).toISOString(), maximoDescargas: 5, protegido: true } }, res);
  assert.equal(res.code, 200);
  assert.equal(changes.hash_contrasena, 'hash-original');
  assert.equal(changes.descargas_realizadas, undefined);
  assert.equal(changes.hash_token, undefined);
  assert.equal(res.body.enlace.id, id);
  assert.equal(res.body.contrasena, null);
  assert.ok(filters.some(([k,v]) => k === 'es_actual' && v === true));
});


test('Con tres descargas realizadas rechaza límites de uno o dos antes de escribir', async t => {
  t.mock.method(supabaseAdmin, 'from', () => assert.fail('No debe escribir una configuración inválida'));
  const created = new Date().toISOString();
  for (const limit of [1, 2]) {
    const res = response();
    res.locals.enlace = { id, creado_en: created, actualizado_en: created, descargas_realizadas: 3 };
    res.locals.archivo = { estado_limpieza: 'activo' };
    await route('/:id', 'patch')({ body: { actualizadoEn: created, venceEn: new Date(Date.now()+86400000).toISOString(), maximoDescargas: limit, protegido: false } }, res);
    assert.equal(res.code, 400);
    assert.match(res.body.error, /no puede ser menor que las descargas realizadas/);
  }
});
