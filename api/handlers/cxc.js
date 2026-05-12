// api/handlers/cxc.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

export async function handleRegistrarAbono(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_ABONO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ABONO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar abonos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto, formaPago, referencia } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente y su saldo actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_pendiente`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    const saldoActual = Number(cliente.saldo_pendiente || 0);
    if (Number(monto) > saldoActual) {
      return jsonError(`El abono ($${monto}) supera el saldo pendiente ($${saldoActual})`, 400, request);
    }

    const nuevoSaldo = saldoActual - Number(monto);

    // 2. Registrar abono
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        tipo: 'abono',
        monto_usd: monto,
        forma_pago_abono: formaPago,
        referencia,
        saldo_usd: nuevoSaldo,
        descripcion: 'Abono recibido',
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar abono: ${err}`, 500, request);
    }
    const [abono] = await aRes.json();

    // 3. Actualizar saldo del cliente
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: nuevoSaldo }),
    });

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REGISTRAR_ABONO', descripcion: `Abono de $${monto} registrado para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, meta: { monto, forma_pago: formaPago, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo }, ip,
      });
    } catch {}

    return json({ id: abono.id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar abono', 500, request);
  }
}
