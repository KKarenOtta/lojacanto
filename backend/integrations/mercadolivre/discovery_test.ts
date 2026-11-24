import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import { highlightsPath, mapHighlights, mapTrends, trendsPath } from "./discovery.ts";

const read = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

const highlights = await read("highlights_category.json");
const trends = await read("trends.json");

Deno.test("mapeia os 20 mais vendidos da categoria do exemplo oficial", () => {
  const result = mapHighlights(highlights);
  assert.equal(result.categoryId, "MLB432825");
  assert.equal(result.entries.length, 20);
  assert.deepEqual(result.entries[0], { id: "MLBU3013800008", position: 1, type: "USER_PRODUCT" });
  assert.deepEqual(result.entries[15], { id: "MLB6868664726", position: 16, type: "ITEM" });
});

Deno.test("mais vendidos fora do contrato geram ContractError com caminho", () => {
  assert.throws(() => mapHighlights(null), ContractError);
  assert.throws(() => mapHighlights({ ...highlights, content: {} }), ContractError);
  const broken = structuredClone(highlights);
  broken.content[2].type = "OTHER";
  assert.throws(
    () => mapHighlights(broken),
    (error: unknown) =>
      error instanceof ContractError && error.path === "highlights.content[2].type",
  );
  broken.content[2] = { id: "MLB1", position: 0, type: "ITEM" };
  assert.throws(() => mapHighlights(broken), ContractError);
  broken.content[2] = { id: "x", position: 3, type: "ITEM" };
  assert.throws(() => mapHighlights(broken), ContractError);
});

Deno.test("tendências seguem os três grupos da documentação", () => {
  const result = mapTrends(trends);
  assert.equal(result.length, 50);
  assert.deepEqual(result[0], { keyword: "detector metal", rank: 1, group: "fastest_growing" });
  assert.equal(result[10]!.group, "most_wanted");
  assert.equal(result[29]!.group, "most_wanted");
  assert.equal(result[30]!.group, "most_popular");
});

Deno.test("tendências fora do contrato geram ContractError", () => {
  assert.throws(() => mapTrends({}), ContractError);
  assert.throws(() => mapTrends([{ keyword: " " }]), ContractError);
});

Deno.test("caminhos aceitam apenas categorias do MLB", () => {
  assert.equal(highlightsPath("MLB432825"), "/highlights/MLB/category/MLB432825");
  assert.equal(trendsPath(), "/trends/MLB");
  assert.equal(trendsPath("MLB1430"), "/trends/MLB/MLB1430");
  assert.throws(() => highlightsPath("MLA1"), RangeError);
  assert.throws(() => trendsPath("../x"), RangeError);
});
