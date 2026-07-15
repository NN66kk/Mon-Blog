const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findCurrentTocLink,
  getTocLinkHash,
  isSamePageAnchor,
  normalizeTocSearchText,
  tocTextMatchesQuery,
} = require("../docs/javascripts/article-toc.js");

const currentLocation = new URL(
  "https://nn66kk.github.io/Mon-Blog/B-Notes/example/",
);

function linkTo(href) {
  return {
    getAttribute(name) {
      return name === "href" ? href : null;
    },
  };
}

test("accepts a hash-only table-of-contents link", () => {
  assert.equal(
    isSamePageAnchor(linkTo("#section"), currentLocation),
    true,
  );
});

test("accepts the absolute TOC URL produced by Material", () => {
  assert.equal(
    isSamePageAnchor(
      linkTo(
        "https://nn66kk.github.io/Mon-Blog/B-Notes/example/#section",
      ),
      currentLocation,
    ),
    true,
  );
});

test("rejects links to another page", () => {
  assert.equal(
    isSamePageAnchor(
      linkTo("https://nn66kk.github.io/Mon-Blog/B-Notes/other/#section"),
      currentLocation,
    ),
    false,
  );
});

test("extracts the hash from Material's absolute TOC URL", () => {
  assert.equal(
    getTocLinkHash(
      linkTo(
        "https://nn66kk.github.io/Mon-Blog/B-Notes/example/#section",
      ),
      currentLocation,
    ),
    "#section",
  );
});

test("finds the last heading above the reading line", () => {
  const links = [linkTo("#one"), linkTo("#two"), linkTo("#three")];
  const headingTops = { one: -120, two: 48, three: 180 };
  const root = {
    querySelector() {
      return {
        getBoundingClientRect() {
          return { bottom: 48 };
        },
      };
    },
    getElementById(id) {
      return {
        getBoundingClientRect() {
          return { top: headingTops[id] };
        },
      };
    },
  };

  assert.equal(findCurrentTocLink(links, root, currentLocation), links[1]);
});

test("normalizes case and repeated whitespace for searching", () => {
  assert.equal(
    normalizeTocSearchText("  Where   Did U Go  "),
    "where did u go",
  );
});

test("matches Chinese directory text by substring", () => {
  assert.equal(tocTextMatchesQuery("创作背景故事", "背景"), true);
  assert.equal(tocTextMatchesQuery("歌词", "背景"), false);
});
