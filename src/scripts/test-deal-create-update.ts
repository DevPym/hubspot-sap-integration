/**
 * Prueba CREATE y UPDATE completo de Deal → SAP Sales Order.
 *
 * Flujo:
 *   1. CREATE Deal en HubSpot con propiedades estándar + custom
 *   2. Asociar Deal → Company (existente con Customer Master en SAP)
 *   3. Transformar con mapper y CREATE SalesOrder en SAP
 *   4. Verificar todos los campos en SAP
 *   5. UPDATE Deal en HubSpot (cambiar nombre, fecha, condición pago)
 *   6. PATCH SalesOrder en SAP
 *   7. Verificar UPDATE en SAP
 *
 * ⚠️ REQUISITO: SoldToParty debe ser un BP con Customer Master activo.
 *    Usamos BP 70123456 que está verificado en producción.
 *
 * Uso: npx tsx src/scripts/test-deal-create-update.ts
 */
import 'dotenv/config';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import { sapClient } from '../adapters/sap/sap.client';
import * as mapper from '../services/mapper.service';
import type { HubSpotDeal } from '../adapters/hubspot/hubspot.types';
import type { ODataResponse } from '../adapters/sap/sap.types';

// BP con Customer Master activo (verificado en producción)
const SAP_SOLD_TO_PARTY = '70123456';
// Company asociada en HubSpot (para la asociación Deal→Company)
const HUBSPOT_COMPANY_ID = '53147869965'; // Empresa Test SAP Integration

let passCount = 0;
let failCount = 0;

function pass(msg: string) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, e?: unknown) {
  failCount++;
  const detail = e instanceof Error ? e.message : e ? String(e) : '';
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
}

function check(field: string, expected: string | undefined, actual: string | unknown, caseInsensitive = false) {
  const exp = expected ?? '';
  const act = typeof actual === 'string' ? actual : String(actual ?? '');
  const matches = caseInsensitive
    ? exp.toUpperCase() === act.toUpperCase()
    : exp === act || act.includes(exp);
  if (matches) {
    pass(`${field}: "${act}"`);
  } else {
    fail(`${field}: "${act}" (esperado: "${exp}")`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Deal CREATE + UPDATE → SAP Sales Order             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  SoldToParty (SAP BP): ${SAP_SOLD_TO_PARTY}`);
  console.log(`  Company (HubSpot):    ${HUBSPOT_COMPANY_ID}\n`);

  const ts = Date.now();

  // ═══════════════════════════════════════════════════════════════════════
  // PARTE 1: CREATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('══════════════════ CREATE ══════════════════');

  // ── 1. Crear Deal en HubSpot ──
  console.log('\n1️⃣  Creando Deal en HubSpot...');
  const createProps: Record<string, string> = {
    dealname: `DealTest_${ts}`,
    pipeline: '132611721',          // Ventas
    dealstage: '229341459',          // EnviarCotizacion
    closedate: '2026-12-31',
    deal_currency_code: 'CLP',
    condicion_de_pago: '30 días',
    fecha_de_entrega: '2026-11-15',
    orden_de_compra_o_contratoo: `OC-${ts}`,
    cuanto_es_la_cantidad_requerida_del_producto_: '50',
  };

  let dealId: string;
  try {
    const res = await hubspotClient.post<HubSpotDeal>(
      '/crm/v3/objects/deals',
      { properties: createProps },
    );
    dealId = res.data.id;
    pass(`HubSpot CREATE Deal → ID: ${dealId}`);
  } catch (e: unknown) {
    fail('HubSpot CREATE Deal', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const ax = e as { response?: { data?: unknown } };
      if (ax.response?.data) console.log('   Detail:', JSON.stringify(ax.response.data, null, 2));
    }
    return;
  }

  // ── 2. Asociar Deal → Company ──
  console.log('\n2️⃣  Asociando Deal → Company...');
  try {
    await hubspotClient.put(
      `/crm/v3/objects/deals/${dealId}/associations/company/${HUBSPOT_COMPANY_ID}/deal_to_company`,
    );
    pass(`Asociación Deal ${dealId} → Company ${HUBSPOT_COMPANY_ID}`);
  } catch {
    // Fallback v4
    try {
      await hubspotClient.post(
        `/crm/v4/objects/deals/${dealId}/associations/companies/${HUBSPOT_COMPANY_ID}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
      );
      pass(`Asociación (v4) Deal ${dealId} → Company ${HUBSPOT_COMPANY_ID}`);
    } catch (e2) {
      fail('Asociar Deal→Company', e2);
    }
  }

  // ── 3. Leer Deal con todas las propiedades ──
  console.log('\n3️⃣  Leyendo Deal de HubSpot...');
  let dealProps: HubSpotDeal['properties'];
  try {
    const res = await hubspotClient.get<HubSpotDeal>(
      `/crm/v3/objects/deals/${dealId}`,
      {
        params: {
          properties: [
            'dealname', 'amount', 'closedate', 'deal_currency_code', 'dealstage',
            'pipeline', 'condicion_de_pago', 'fecha_de_entrega',
            'orden_de_compra_o_contratoo', 'cuanto_es_la_cantidad_requerida_del_producto_',
            'hs_lastmodifieddate',
          ].join(','),
        },
      },
    );
    dealProps = res.data.properties;
    pass(`Deal: ${dealProps.dealname}`);
    console.log(`   dealname:          ${dealProps.dealname}`);
    console.log(`   closedate:         ${dealProps.closedate}`);
    console.log(`   deal_currency:     ${dealProps.deal_currency_code}`);
    console.log(`   condicion_pago:    ${dealProps.condicion_de_pago}`);
    console.log(`   fecha_entrega:     ${dealProps.fecha_de_entrega}`);
    console.log(`   orden_compra:      ${dealProps.orden_de_compra_o_contratoo}`);
    console.log(`   cantidad_producto: ${dealProps.cuanto_es_la_cantidad_requerida_del_producto_}`);
    console.log(`   dealstage:         ${dealProps.dealstage}`);
    console.log(`   pipeline:          ${dealProps.pipeline}`);
  } catch (e) {
    fail('HubSpot READ Deal', e);
    return;
  }

  // ── 4. Transformar y crear SalesOrder en SAP ──
  console.log('\n4️⃣  Creando Sales Order en SAP...');
  let sapSOId: string;
  try {
    const payload = mapper.dealToSalesOrder(dealProps, SAP_SOLD_TO_PARTY);
    console.log(`   Payload (resumen):`);
    console.log(`     SalesOrderType:        ${payload.SalesOrderType}`);
    console.log(`     SalesOrganization:     ${payload.SalesOrganization}`);
    console.log(`     DistributionChannel:   ${payload.DistributionChannel}`);
    console.log(`     OrganizationDivision:  ${payload.OrganizationDivision}`);
    console.log(`     SoldToParty:           ${payload.SoldToParty}`);
    console.log(`     PurchaseOrderByCust:   ${payload.PurchaseOrderByCustomer}`);
    console.log(`     TransactionCurrency:   ${payload.TransactionCurrency}`);
    console.log(`     RequestedDeliveryDate: ${payload.RequestedDeliveryDate}`);
    console.log(`     CustomerPaymentTerms:  ${payload.CustomerPaymentTerms}`);
    console.log(`     Items:                 ${JSON.stringify(payload.to_Item?.results)}`);

    const res = await sapClient.post<ODataResponse<{ SalesOrder: string }>>(
      '/API_SALES_ORDER_SRV/A_SalesOrder',
      payload,
    );
    sapSOId = res.data.d.SalesOrder;
    pass(`SAP CREATE SalesOrder → ID: ${sapSOId}`);
  } catch (e: unknown) {
    fail('SAP CREATE SalesOrder', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const ax = e as { response?: { data?: unknown } };
      if (ax.response?.data) console.log('   SAP Error:', JSON.stringify(ax.response.data, null, 2));
    }
    return;
  }

  // ── 5. Verificar CREATE en SAP ──
  console.log('\n5️⃣  Verificando CREATE en SAP...');
  console.log('────────────────────────────────────────');

  const soRes = await sapClient.get<ODataResponse<Record<string, unknown>>>(
    `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')`,
  );
  const so = soRes.data.d;

  check('SalesOrder', sapSOId, so.SalesOrder);
  check('SalesOrderType', 'OR', so.SalesOrderType);
  check('SalesOrganization', '4601', so.SalesOrganization);
  check('DistributionChannel', 'CF', so.DistributionChannel);
  check('OrganizationDivision', '10', so.OrganizationDivision);
  check('SoldToParty', SAP_SOLD_TO_PARTY, so.SoldToParty);
  check('PurchaseOrderByCustomer', `OC-${ts}`, so.PurchaseOrderByCustomer);
  check('TransactionCurrency', 'CLP', so.TransactionCurrency);
  check('CustomerPaymentTerms', 'NT30', so.CustomerPaymentTerms); // "30 días" → NT30

  // Verificar RequestedDeliveryDate (formato /Date(epoch)/)
  const expectedDeliveryISO = '2026-11-15';
  const actualDeliveryISO = mapper.sapDateToISO(so.RequestedDeliveryDate as string);
  if (actualDeliveryISO && actualDeliveryISO.startsWith(expectedDeliveryISO)) {
    pass(`RequestedDeliveryDate: "${so.RequestedDeliveryDate}" → ${actualDeliveryISO.split('T')[0]}`);
  } else {
    fail(`RequestedDeliveryDate: "${so.RequestedDeliveryDate}" → ${actualDeliveryISO} (esperado: ${expectedDeliveryISO})`);
  }

  // Verificar TotalNetAmount (READ-ONLY, calculado por SAP desde items)
  console.log(`  ℹ️  TotalNetAmount (READ-ONLY): ${so.TotalNetAmount} ${so.TransactionCurrency}`);

  // Verificar Items
  console.log('\n  --- Items ---');
  try {
    const itemsRes = await sapClient.get<{ d: { results: Record<string, unknown>[] } }>(
      `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')/to_Item`,
    );
    const items = itemsRes.data.d.results;
    if (items.length > 0) {
      const item = items[0];
      check('Item.SalesOrderItem', '10', item.SalesOrderItem);
      check('Item.Material', 'Q01', item.Material);
      check('Item.RequestedQuantity', '50', item.RequestedQuantity);
      check('Item.RequestedQuantityUnit', 'L', item.RequestedQuantityUnit);
      pass(`Items encontrados: ${items.length}`);
    } else {
      fail('No hay items en SalesOrder');
    }
  } catch (e) {
    fail('Leer Items', e);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARTE 2: UPDATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n\n══════════════════ UPDATE ══════════════════');

  // ── 6. Actualizar Deal en HubSpot ──
  console.log('\n6️⃣  Actualizando Deal en HubSpot...');
  const ts2 = Date.now();
  const updateHubSpotProps = {
    dealname: `DealUpdated_${ts2}`,
    closedate: '2027-03-15',
    condicion_de_pago: '60 días',
    orden_de_compra_o_contratoo: `OC-UPD-${ts2}`,
    fecha_de_entrega: '2027-03-15',  // Prioridad sobre closedate en mapper
  };

  try {
    await hubspotClient.patch(
      `/crm/v3/objects/deals/${dealId}`,
      { properties: updateHubSpotProps },
    );
    pass('HubSpot PATCH Deal exitoso');
    console.log(`   Props actualizadas: ${JSON.stringify(updateHubSpotProps)}`);
  } catch (e) {
    fail('HubSpot PATCH Deal', e);
    return;
  }

  // Leer actualizado
  const updRes = await hubspotClient.get<HubSpotDeal>(
    `/crm/v3/objects/deals/${dealId}`,
    {
      params: {
        properties: 'dealname,closedate,condicion_de_pago,orden_de_compra_o_contratoo,fecha_de_entrega',
      },
    },
  );
  const updProps = updRes.data.properties;

  // ── 7. PATCH SalesOrder en SAP ──
  console.log('\n7️⃣  PATCH SalesOrder en SAP...');
  const soUpdatePayload = mapper.dealToSalesOrderUpdate(updProps);
  console.log(`   Payload: ${JSON.stringify(soUpdatePayload)}`);
  try {
    await sapClient.patchWithETag(
      `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')`,
      soUpdatePayload,
    );
    pass('SAP PATCH SalesOrder exitoso');
  } catch (e: unknown) {
    fail('SAP PATCH SalesOrder', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const ax = e as { response?: { data?: unknown } };
      if (ax.response?.data) console.log('   SAP Error:', JSON.stringify(ax.response.data, null, 2));
    }
  }

  // ── 8. Verificar UPDATE en SAP ──
  console.log('\n8️⃣  Verificando UPDATE en SAP...');
  console.log('────────────────────────────────────────');

  const soUpdRes = await sapClient.get<ODataResponse<Record<string, unknown>>>(
    `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')`,
  );
  const soUpd = soUpdRes.data.d;

  // orden_de_compra_o_contratoo tiene prioridad sobre dealname para PurchaseOrderByCustomer
  check('PurchaseOrderByCust (updated)', `OC-UPD-${ts2}`.substring(0, 35), soUpd.PurchaseOrderByCustomer);
  check('CustomerPaymentTerms (updated)', 'NT60', soUpd.CustomerPaymentTerms); // "60 días" → NT60

  // Verificar RequestedDeliveryDate actualizada
  const expectedUpdDate = '2027-03-15';
  const actualUpdDate = mapper.sapDateToISO(soUpd.RequestedDeliveryDate as string);
  if (actualUpdDate && actualUpdDate.startsWith(expectedUpdDate)) {
    pass(`RequestedDeliveryDate (updated): ${actualUpdDate.split('T')[0]}`);
  } else {
    fail(`RequestedDeliveryDate (updated): ${actualUpdDate} (esperado: ${expectedUpdDate})`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════ RESUMEN ══════════════════');
  console.log(`  ✅ Pasaron:  ${passCount}`);
  console.log(`  ❌ Fallaron: ${failCount}`);
  console.log(`  Total:      ${passCount + failCount}`);
  console.log(`\n  HubSpot Deal ID:   ${dealId}`);
  console.log(`  SAP SalesOrder ID: ${sapSOId}`);

  if (failCount > 0) {
    console.log('\n⚠️  Hay pruebas fallidas.');
    process.exit(1);
  } else {
    console.log('\n🎉 Deal CREATE + UPDATE: todos los campos verificados.');
  }
}

main().catch((e) => {
  console.error('Error fatal:', e.message);
  if (e.response?.data) {
    console.error('SAP detail:', JSON.stringify(e.response.data, null, 2));
  }
  process.exit(1);
});
