const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isSamePageAnchor,
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
