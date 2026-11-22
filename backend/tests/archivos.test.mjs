import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { supabaseAdmin } = await import('../src/config/supabase.ts');
const { archivosRouter } = await import('../src/routes/archivos.ts');
const { requireAuth } = await import('../src/middleware/auth.ts');
const eliminar = archivosRouter.stack.find(l => l.route?.methods.delete).route.stack[0].handle;
const id = '11111111-1111-4111-8111-111111111111';
function response() { return { locals: { userId: 'propietario-autenticado' }, code: 200, status(n) { this.code=n;return this; }, json(body) { this.body=body;return this; } }; }
const reserva = { estado: 'preparado', id, ruta: 'privado/archivo.pdf', token: 'token-interno' };

test('La eliminación está detrás de autenticación', () => assert.equal(archivosRouter.stack[0].handle, requireAuth));

test('Ni ID inválido ni otro propietario pueden provocar un borrado', async t => {
  t.mock.method(supabaseAdmin.storage, 'from', () => assert.fail('No debe borrar Storage'));
  let calls=0;
  t.mock.method(supabaseAdmin,'rpc',async (name,args) => {
    calls++;
    assert.equal(name,'solicitar_eliminacion_archivo');
    assert.equal(args.p_propietario_id,'propietario-autenticado');
    return { data: { estado: 'no_disponible' }, error: null };
  });
  const invalid=response();await eliminar({params:{id:'invalido'}},invalid);assert.equal(invalid.code,400);assert.equal(calls,0);
  const other=response();await eliminar({params:{id},body:{propietarioId:'falsificado'}},other);assert.equal(other.code,404);assert.equal(calls,1);
});

test('Con reservas o con otro borrado en curso no se toca Storage',async t => {
  let estado='ocupado';
  t.mock.method(supabaseAdmin,'rpc',async () => ({data:{estado},error:null}));
  t.mock.method(supabaseAdmin.storage,'from',() => assert.fail('No debe borrar'));
  for(const value of ['ocupado','en_proceso']) { estado=value;const res=response();await eliminar({params:{id}},res);assert.equal(res.code,409); }
});

test('Elimina Storage antes de cerrar metadatos y nunca devuelve rutas o tokens',async t => {
  const pasos=[];
  t.mock.method(supabaseAdmin,'rpc',async (name,args) => {
    pasos.push(name);
    if(name==='solicitar_eliminacion_archivo')return {data:reserva,error:null};
    assert.deepEqual(args,{p_id:id,p_token:reserva.token,p_exito:true});return {data:true,error:null};
  });
  t.mock.method(supabaseAdmin.storage,'from',bucket => {
    assert.equal(bucket,'safelink-files');return {remove:async paths=>{assert.deepEqual(paths,[reserva.ruta]);pasos.push('Storage');return {error:null};}};
  });
  const res=response();await eliminar({params:{id}},res);
  assert.deepEqual(pasos,['solicitar_eliminacion_archivo','Storage','cerrar_limpieza']);
  assert.deepEqual(res.body,{eliminado:true});
});

test('Si Storage falla, cierra como fallido y no anuncia eliminación ni libera cuota',async t => {
  const cierres=[];
  t.mock.method(supabaseAdmin,'rpc',async (name,args) => {
    if(name==='solicitar_eliminacion_archivo')return {data:reserva,error:null};
    cierres.push(args);return {data:false,error:null};
  });
  t.mock.method(supabaseAdmin.storage,'from',()=>({remove:async()=>({error:{message:'simulado'}})}));
  const res=response();await eliminar({params:{id}},res);
  assert.equal(res.code,503);assert.equal(res.body.eliminado,undefined);
  assert.deepEqual(cierres,[{p_id:id,p_token:reserva.token,p_exito:false}]);
});

test('Si falla el cierre tras borrar Storage, conserva la reclamación para recuperación',async t => {
  const cierres=[];
  t.mock.method(supabaseAdmin,'rpc',async (name,args) => {
    if(name==='solicitar_eliminacion_archivo')return {data:reserva,error:null};
    cierres.push(args);return {data:null,error:{code:'simulado'}};
  });
  t.mock.method(supabaseAdmin.storage,'from',()=>({remove:async()=>({error:null})}));
  const res=response();await eliminar({params:{id}},res);
  assert.equal(res.code,503);assert.deepEqual(cierres,[{p_id:id,p_token:reserva.token,p_exito:true}]);
});
