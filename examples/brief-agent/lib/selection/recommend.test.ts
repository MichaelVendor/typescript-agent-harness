import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendCatalog } from "./recommend.ts";

test("只推荐过观察线的搜索词，并带上最多 3 个已有商品", () => {
  const products = [
    ...Array.from({ length: 8 }, (_, i) => ({
      asin: `B0DEKO000${i}`,
      title: `Deko ${i}`,
      price: 10 + i,
      query: "dekotablett",
      reviewCount: i === 0 ? 400 : 10,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      asin: `B0BATH000${i}`,
      title: `Bad ${i}`,
      price: 8,
      query: "badezimmer tablett",
      reviewCount: i < 5 ? 400 : 10,
    })),
  ];
  const items = recommendCatalog(products, {
    dekotablett: { monthlySearchVolume: 9778, trend3m: 0.4087 },
    "badezimmer tablett": { monthlySearchVolume: 2826, trend3m: 0.0733 },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.query, "dekotablett");
  assert.equal(items[0]?.action, "观察");
  assert.equal(items[0]?.marketplace, "DE");
  assert.equal(items[0]?.send, "德国站 dekotablett");
  assert.equal(items[0]?.products.length, 3);
  assert.equal(items[0]?.products[0]?.title, "Deko 0");
});

test("美国站推荐用美元和美国站发送词", () => {
  const products = Array.from({ length: 5 }, (_, i) => ({
    asin: `B0USBTR00${i}`,
    title: `Tray ${i}`,
    price: 14 + i,
    query: "bathroom tray",
    reviewCount: 50 + i,
  }));
  const items = recommendCatalog(
    products,
    { "bathroom tray": { monthlySearchVolume: 22000, trend3m: 0.28 } },
    { "bathroom tray": 0.34 },
    "US",
  );
  assert.equal(items[0]?.marketplace, "US");
  assert.equal(items[0]?.currency, "USD");
  assert.equal(items[0]?.send, "美国站 bathroom tray");
  assert.equal(items[0]?.action, "上架");
});

test("演示净利率写上之后，同一批可以上架", () => {
  const products = Array.from({ length: 8 }, (_, i) => ({
    asin: `B0DEKO000${i}`,
    title: `Deko ${i}`,
    price: 10 + i,
    query: "dekotablett",
    reviewCount: 10,
  }));
  const items = recommendCatalog(
    products,
    { dekotablett: { monthlySearchVolume: 18000, trend3m: 0.45 } },
    { dekotablett: 0.36 },
  );
  assert.equal(items[0]?.action, "上架");
  assert.ok((items[0]?.total ?? 0) >= 0.65);
});
