import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import {
  dceEmissionPath,
  dceInfoPath,
  mapDceInfo,
  mapShipmentSla,
  shipmentSlaPath,
} from "./fulfillment.ts";

const read = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

Deno.test("mapeia o prazo de despacho do exemplo oficial em UTC", async () => {
  assert.deepEqual(mapShipmentSla(await read("shipment_sla.json")), {
    status: "on_time",
    expectedAt: "2024-05-23T02:59:59.000Z",
    lastUpdated: "2024-05-21T17:16:04.000Z",
  });
});

Deno.test("prazo fora do contrato gera ContractError", async () => {
  const sla = await read("shipment_sla.json");
  assert.throws(() => mapShipmentSla(null), ContractError);
  assert.throws(() => mapShipmentSla({ ...sla, status: "late" }), ContractError);
  assert.throws(() => mapShipmentSla({ ...sla, last_updated: "ontem" }), ContractError);
  assert.equal(mapShipmentSla({ ...sla, expected_date: null }).expectedAt, null);
});

Deno.test("mapeia o status da DC-e do exemplo oficial", async () => {
  assert.deepEqual(mapDceInfo(await read("dce_info.json")), {
    status: "completed",
    documents: [{ key: "doc-789", status: "issued", errorCode: null }],
  });
});

Deno.test("DC-e com erro ou fora do contrato", async () => {
  const info = await read("dce_info.json");
  const failed = structuredClone(info);
  failed.status = "error";
  failed.documents[0].error = { code: "E123", message: "rejeitada" };
  assert.equal(mapDceInfo(failed).documents[0]!.errorCode, "E123");
  assert.throws(() => mapDceInfo({ ...info, status: "done" }), ContractError);
  assert.throws(() => mapDceInfo({ ...info, documents: {} }), ContractError);
  assert.throws(() => mapDceInfo({ ...info, documents: [{}] }), ContractError);
  assert.throws(() => mapDceInfo(null), ContractError);
});

Deno.test("caminhos aceitam apenas ids numéricos", () => {
  assert.equal(shipmentSlaPath("43416180080"), "/shipments/43416180080/sla");
  assert.equal(dceEmissionPath("2000000483899592"), "/mlb/order/2000000483899592/dce/emission");
  assert.equal(dceInfoPath("2000000483899592"), "/mlb/order/2000000483899592/dce/info");
  assert.throws(() => dceInfoPath("1/../x"), RangeError);
});
