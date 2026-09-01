const assert = require("node:assert/strict");
const test = require("node:test");

const {
  archiveEntryMatches,
  getArchiveQueryTokens,
  normalizeArchiveText,
} = require("../docs/javascripts/archive-filter.js");

test("normalizes width, case and whitespace for archive search", () => {
  assert.equal(normalizeArchiveText("  ＡＩ   QuickAdd  "), "ai quickadd");
});

test("splits a multi-term archive query", () => {
  assert.deepEqual(getArchiveQueryTokens("AI   Obsidian 修复"), [
    "ai",
    "obsidian",
    "修复",
  ]);
});

test("matches every search term regardless of order", () => {
  assert.equal(
    archiveEntryMatches(
      {
        collection: "D",
        searchText: "Obsidian QuickAdd：一键修复 Markdown 与公式",
      },
      "公式 Obsidian",
    ),
    true,
  );
});

test("filters entries by collection", () => {
  const entry = {
    collection: "B",
    searchText: "RAG 与 n8n 的关系分析",
  };

  assert.equal(archiveEntryMatches(entry, "n8n", "B"), true);
  assert.equal(archiveEntryMatches(entry, "n8n", "D"), false);
});

test("rejects an entry when any query term is missing", () => {
  assert.equal(
    archiveEntryMatches(
      { collection: "A", searchText: "一周健身训练计划" },
      "健身 饮食",
    ),
    false,
  );
});
