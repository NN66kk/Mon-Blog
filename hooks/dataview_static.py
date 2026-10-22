"""Build a deliberately small, opt-in subset of Obsidian Dataview.

Only ``task where file.path = this.file.path and !completed`` is supported.
No query, JavaScript, or cross-note lookup is executed. Other Dataview blocks
remain examples unless a page opts in; unsupported opted-in blocks warn so a
strict build cannot publish query source by accident.
"""

from fnmatch import fnmatchcase
import logging
import re


log = logging.getLogger("mkdocs.hooks.dataview_static")
FENCE = re.compile(r"^([ \t]*)(`{3,}|~{3,})([^\r\n]*)$")
LIST_ITEM = re.compile(r"^( *)(?:[-+*]|\d+[.)])[ \t]+")
TASK = re.compile(r"^( *)(?:[-+*]|\d+[.)])[ \t]+\[([^\]\r\n])\](?:[ \t]+(.*))?$")
QUOTE = re.compile(r"^(?: {0,3}>[ \t]?)+")
QUERY = re.compile(
    r"task\s+where\s+file\.path\s*=\s*this\.file\.path\s+and\s+!\s*completed",
    re.IGNORECASE,
)


def enabled_for_page(src_uri, metadata, config):
    """An explicit page boolean overrides the configured source-path allowlist."""
    if "dataview_static" in metadata:
        value = metadata["dataview_static"]
        if not isinstance(value, bool):
            log.warning("%s: dataview_static must be a YAML boolean", src_uri)
        return value is True
    patterns = config.get("extra", {}).get("dataview_static_paths", [])
    return any(fnmatchcase(src_uri, pattern) for pattern in patterns)


def supported_query(query):
    return QUERY.fullmatch(query.strip()) is not None


def _without_comments(line, in_comment):
    visible = ""
    while line:
        if in_comment:
            _, separator, line = line.partition("-->")
            if not separator:
                return visible, True
            in_comment = False
        else:
            before, separator, line = line.partition("<!--")
            visible += before
            if not separator:
                break
            in_comment = True
    return visible, in_comment


def _fences(lines):
    """Recognize complete outer fences; a shorter nested fence cannot close one."""
    blocks = []
    start = 0
    in_comment = False
    while start < len(lines):
        visible, in_comment = _without_comments(lines[start], in_comment)
        opening = FENCE.match(visible)
        if not opening or (opening[2][0] == "`" and "`" in opening[3]):
            start += 1
            continue
        fence = opening[2]
        closing = re.compile(r"^[ \t]*" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}[ \t]*$")
        end = start + 1
        while end < len(lines) and not closing.match(lines[end]):
            end += 1
        closed = end < len(lines)
        blocks.append((start, min(end + 1, len(lines)), opening[3].strip(), closed, opening[1]))
        start = end + 1
    return blocks


def _supported_block(lines, block):
    start, end, language, closed, indent = block
    return (
        closed
        and language.lower() == "dataview"
        and len(indent.expandtabs(4)) <= 3
        and supported_query("\n".join(lines[start + 1:end - 1]))
    )


def count_supported_queries(markdown):
    """Count only active queries that this hook will replace, for artifact checks."""
    lines = markdown.splitlines()
    return sum(_supported_block(lines, block) for block in _fences(lines))


def _quoted_features(lines, blocks):
    """Detect unsupported containers without interpreting their query contents."""
    protected = {index for start, end, *_ in blocks for index in range(start, end)}
    tasks = []
    queries = []
    in_comment = False
    closing = None
    for index, line in enumerate(lines):
        if index in protected:
            continue
        visible, in_comment = _without_comments(line, in_comment)
        quote = QUOTE.match(visible)
        if not quote:
            closing = None
            continue
        content = visible[quote.end():]
        if closing is not None:
            if closing.match(content):
                closing = None
            continue
        fence = FENCE.match(content)
        if fence:
            closing = re.compile(
                r"^[ \t]*" + re.escape(fence[2][0]) + "{" + str(len(fence[2])) + r",}[ \t]*$"
            )
            if fence[3].strip().lower().split(maxsplit=1)[:1] in (["dataview"], ["dataviewjs"]):
                queries.append(index)
        elif TASK.match(content):
            tasks.append(index)
    return tasks, queries


def _tasks(lines, blocks):
    """Collect source tasks once, ignoring fenced/indented code and comments.

    Lists are flattened for a same-note task summary. Indented continuation
    paragraphs stay attached to their task; child tasks are selected separately
    so completing a parent does not hide an unfinished child.
    """
    protected = set()
    for start, end, *_ in blocks:
        protected.update(range(start, end))
    # MkDocs normally removes front matter before this hook, but source-checking
    # callers may supply a whole Markdown document.
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() in {"---", "..."}:
                protected.update(range(index + 1))
                break
    in_comment = False
    lines = list(lines)
    for index, line in enumerate(lines):
        if index in protected:
            continue
        lines[index], in_comment = _without_comments(line, in_comment)

    candidates = []
    list_indents = []
    for index, line in enumerate(lines):
        if index in protected or not line.strip():
            continue
        item = LIST_ITEM.match(line)
        indentation = len(line) - len(line.lstrip(" "))
        if not item:
            if indentation == 0:
                list_indents = []
            continue
        # Four-space indentation outside a list is a code example.
        if indentation >= 4 and not any(level < indentation for level in list_indents):
            continue
        list_indents = [level for level in list_indents if level < indentation]
        list_indents.append(indentation)
        task = TASK.match(line)
        if task:
            candidates.append((index, task))

    task_lines = {index for index, _ in candidates}
    selected = []
    for index, task in candidates:
        if task[2].lower() == "x":
            continue
        indent = len(task[1])
        continuation = []
        cursor = index + 1
        while cursor < len(lines):
            line = lines[cursor]
            if cursor in task_lines:
                break
            if line.strip() and len(line) - len(line.lstrip(" ")) <= indent:
                break
            continuation.append(line)
            cursor += 1
        while continuation and not continuation[-1].strip():
            continuation.pop()
        # A normalized unchecked box expresses the query's !completed filter.
        # Preserve nonstandard Obsidian status characters as visible text.
        label = task[3] or ""
        if task[2] != " ":
            label = f"`[{task[2]}]` {label}"
        body = [f"- [ ] {label}"]
        if continuation:
            # Remove the original list indentation, then give the summary item
            # a valid four-space continuation even when its source used two.
            nonblank = [len(line) - len(line.lstrip(" ")) for line in continuation if line.strip()]
            # Keep the additional indentation of a code block within a task.
            margin = indent + min(4, min(nonblank) - indent) if nonblank else indent + 2
            body.extend("    " + line[margin:] if line.strip() else "" for line in continuation)
        selected.append("\n".join(body))
    return selected


def on_page_markdown(markdown, page, config, files):
    src_uri = page.file.src_uri
    if not enabled_for_page(src_uri, page.meta, config):
        return markdown
    lines = markdown.splitlines()
    blocks = _fences(lines)
    quoted_tasks, quoted_queries = _quoted_features(lines, blocks)
    for index in quoted_queries:
        log.warning(
            "%s:%d: static Dataview queries inside blockquotes/callouts are unsupported",
            src_uri, index + 1,
        )
    if quoted_tasks and (quoted_queries or any(_supported_block(lines, block) for block in blocks)):
        log.warning(
            "%s:%d: static Dataview cannot summarize tasks inside blockquotes/callouts; "
            "move these tasks outside the container before publishing",
            src_uri, quoted_tasks[0] + 1,
        )
    replacements = []
    tasks = None
    for start, end, language, closed, indent in blocks:
        if language.lower().split(maxsplit=1)[:1] not in (["dataview"], ["dataviewjs"]):
            continue
        if not _supported_block(lines, (start, end, language, closed, indent)):
            log.warning(
                "%s:%d: unsupported static Dataview block; only the same-page "
                "incomplete-task query is supported (use dataview_static: false for examples)",
                src_uri, start + 1,
            )
            continue
        if tasks is None:
            tasks = _tasks(lines, blocks)
        content = "\n\n".join(tasks) if tasks else "本页没有未完成的任务。"
        replacements.append((start, end, [
            '<div class="garden-dataview" data-dataview-static="incomplete-tasks" markdown="1">',
            "", content, "", "</div>", "",
        ]))
    # Replace after extraction so repeated queries cannot re-ingest their output.
    for start, end, replacement in reversed(replacements):
        lines[start:end] = replacement
    if not replacements:
        return markdown
    return "\n".join(lines) + ("\n" if markdown.endswith("\n") else "")
