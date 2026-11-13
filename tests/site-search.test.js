const test = require("node:test");
const assert = require("node:assert/strict");
const { searchMetadataKey, indexSearchMetadata } = require("../docs/javascripts/site-ui.js");

test("search result metadata matches encoded article links with queries and section anchors", () => {
  const base = "https://example.test/Mon-Blog/";
  const entry = { url: "B-Notes/中文 note/", collection: "格物札记", date: "2026-01-01" };
  const index = indexSearchMetadata([entry], base);
  const key = searchMetadataKey("/Mon-Blog/B-Notes/%E4%B8%AD%E6%96%87%20note/?h=中文#section", base);
  assert.equal(index.get(key), entry);
  assert.equal(index.has(searchMetadataKey("https://other.test/Mon-Blog/B-Notes/中文 note/", base)), false);
});

test("metadata resolution keeps the deployment subpath and ignores malformed entries", () => {
  const base = "http://127.0.0.1:8000/Mon-Blog/";
  const entry = { url: "D-Orginals/note/", collection: "原创手记", date: "" };
  const index = indexSearchMetadata([null, {}, entry], base);
  assert.equal(index.size, 1);
  assert.equal(index.get("http://127.0.0.1:8000/Mon-Blog/D-Orginals/note/"), entry);
  assert.equal(searchMetadataKey("https://[", base), "");
});
