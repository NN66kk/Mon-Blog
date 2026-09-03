const assert = require("node:assert/strict");
const test = require("node:test");

const {
  bindShareLinkButtons,
  copyShareLink,
  copyShareLinkWithExecCommand,
  getShareLinkUrl,
} = require("../docs/javascripts/share-link.js");

test("builds a clean share URL without query parameters or a hash", () => {
  assert.equal(
    getShareLinkUrl("https://blog.example.com/notes/one/?q=ai#section"),
    "https://blog.example.com/notes/one/",
  );
});

test("uses the Clipboard API when it succeeds", async () => {
  const calls = [];
  const result = await copyShareLink("https://blog.example.com/notes/one/", {
    isSecureContext: true,
    clipboard: {
      async writeText(value) {
        calls.push(["clipboard", value]);
      },
    },
    legacyCopy(value) {
      calls.push(["legacy", value]);
      return true;
    },
  });

  assert.equal(result, "clipboard");
  assert.deepEqual(calls, [["clipboard", "https://blog.example.com/notes/one/"]]);
});

test("falls back when the Clipboard API is present but rejects", async () => {
  const calls = [];
  const result = await copyShareLink("https://blog.example.com/notes/two/", {
    isSecureContext: true,
    clipboard: {
      async writeText() {
        calls.push("clipboard");
        throw new Error("permission denied");
      },
    },
    legacyCopy(value) {
      calls.push(["legacy", value]);
      return true;
    },
  });

  assert.equal(result, "execCommand");
  assert.deepEqual(calls, [
    "clipboard",
    ["legacy", "https://blog.example.com/notes/two/"],
  ]);
});

test("reports failure only after every copy path fails", async () => {
  await assert.rejects(
    copyShareLink("https://blog.example.com/notes/three/", {
      isSecureContext: true,
      clipboard: {
        async writeText() {
          throw new Error("permission denied");
        },
      },
      legacyCopy() {
        return false;
      },
    }),
    /Unable to copy share link/,
  );
});

function createLegacyCopyHarness({ commandError, commandResult = true } = {}) {
  const originalRange = { name: "original range" };
  const state = {
    activeFocusCount: 0,
    appended: false,
    attributes: {},
    command: "",
    range: null,
    removed: false,
    selectionCleared: 0,
    selectionRestored: 0,
    textareaFocusCount: 0,
    textareaSelected: 0,
  };
  const selection = {
    rangeCount: 1,
    getRangeAt() {
      return originalRange;
    },
    removeAllRanges() {
      state.selectionCleared += 1;
    },
    addRange(range) {
      state.selectionRestored += 1;
      state.range = range;
    },
  };
  const body = {
    appendChild(element) {
      state.appended = true;
      element.parentNode = body;
    },
    removeChild(element) {
      state.removed = true;
      element.parentNode = null;
    },
  };
  const textarea = {
    parentNode: null,
    style: {},
    focus() {
      state.textareaFocusCount += 1;
    },
    remove() {
      state.removed = true;
      this.parentNode = null;
    },
    select() {
      state.textareaSelected += 1;
    },
    setAttribute(name, value) {
      state.attributes[name] = value;
    },
    setSelectionRange(start, end) {
      state.selectionRange = [start, end];
    },
  };
  const activeElement = {
    focus() {
      state.activeFocusCount += 1;
    },
  };
  const documentObject = {
    activeElement,
    body,
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return textarea;
    },
    execCommand(command) {
      state.command = command;
      if (commandError) {
        throw commandError;
      }
      return commandResult;
    },
    getSelection() {
      return selection;
    },
  };

  return { documentObject, originalRange, state, textarea };
}

test("legacy copy selects the full URL and restores page state", () => {
  const harness = createLegacyCopyHarness();
  const text = "https://blog.example.com/notes/four/";

  assert.equal(copyShareLinkWithExecCommand(text, harness.documentObject), true);
  assert.equal(harness.textarea.value, text);
  assert.deepEqual(harness.state.selectionRange, [0, text.length]);
  assert.equal(harness.state.command, "copy");
  assert.equal(harness.state.removed, true);
  assert.equal(harness.state.selectionCleared, 1);
  assert.equal(harness.state.selectionRestored, 1);
  assert.equal(harness.state.range, harness.originalRange);
  assert.equal(harness.state.activeFocusCount, 1);
  assert.equal(harness.state.attributes["aria-hidden"], "true");
});

test("legacy copy always removes its temporary textarea when copying throws", () => {
  const harness = createLegacyCopyHarness({ commandError: new Error("blocked") });

  assert.throws(
    () => copyShareLinkWithExecCommand("https://blog.example.com/", harness.documentObject),
    /blocked/,
  );
  assert.equal(harness.state.removed, true);
  assert.equal(harness.state.selectionRestored, 1);
  assert.equal(harness.state.activeFocusCount, 1);
});

test("binding is idempotent across repeated instant-navigation events", () => {
  const listeners = [];
  const button = {
    dataset: {},
    addEventListener(type, listener) {
      listeners.push([type, listener]);
    },
  };
  const root = {
    querySelectorAll() {
      return [button];
    },
  };

  bindShareLinkButtons(root);
  bindShareLinkButtons(root);

  assert.equal(button.dataset.shareLinkBound, "true");
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], "click");
});
