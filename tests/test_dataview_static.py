from pathlib import Path
from types import SimpleNamespace
import importlib.util
import unittest
from unittest.mock import patch

import markdown


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("dataview_static", ROOT / "hooks/dataview_static.py")
DATAVIEW = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(DATAVIEW)
QUERY = "```dataview\ntask\nwhere file.path = this.file.path and !completed\n```"
CONFIG = {"extra": {"dataview_static_paths": ["B-Notes/003英语/英语一真题/*/Text[1-4].md"]}}


def transform(source, path="B-Notes/003英语/英语一真题/2008/Text2.md", meta=None):
    page = SimpleNamespace(file=SimpleNamespace(src_uri=path), meta=meta or {})
    return DATAVIEW.on_page_markdown(source, page, CONFIG, [])


class StaticDataviewTests(unittest.TestCase):
    def test_query_filters_completed_tasks_and_preserves_source_tasks(self):
        source = "- [ ] **learn** ==学习==\n- [x] done\n- [X] also done\n\n" + QUERY
        output = transform(source)
        summary = output.split('<div class="garden-dataview"', 1)[1]
        self.assertTrue(output.startswith(source.split("```dataview")[0]))
        self.assertIn("- [ ] **learn** ==学习==", summary)
        self.assertNotIn("done", summary)
        self.assertNotIn("where file.path", output)
        html = markdown.markdown(output, extensions=["md_in_html", "pymdownx.tasklist", "pymdownx.mark"])
        self.assertIn('data-dataview-static="incomplete-tasks"', html)
        self.assertIn("<strong>learn</strong> <mark>学习</mark>", html)
        self.assertIn('type="checkbox"', html)

    def test_empty_result_is_explicit(self):
        self.assertIn("本页没有未完成的任务。", transform("- [x] done\n\n" + QUERY))

    def test_tutorials_are_unchanged_even_with_the_same_query(self):
        source = "说明\n\n" + QUERY
        self.assertEqual(transform(source, path="D-Orginals/tutorial.md"), source)
        self.assertEqual(transform(source, meta={"dataview_static": False}), source)
        self.assertNotIn("where file.path", transform(source, path="notes/new.md", meta={"dataview_static": True}))

    def test_unsupported_query_and_javascript_warn_and_remain_source(self):
        for query in ("```dataview\nlist from #words\n```", "```dataviewjs\ndv.taskList([])\n```", "```dataview\ntask\n"):
            with self.subTest(query=query), self.assertLogs(DATAVIEW.log, level="WARNING") as logs:
                self.assertEqual(transform(query), query)
            self.assertIn("unsupported static Dataview block", logs.output[0])

    def test_task_examples_in_fences_comments_and_indented_code_are_excluded(self):
        source = """```markdown
- [ ] fenced example
```

~~~text
- [ ] tilde example
~~~

    - [ ] indented example

<!--
- [ ] comment example
-->

- [ ] real task

""" + QUERY
        summary = transform(source).split('<div class="garden-dataview"', 1)[1]
        self.assertIn("real task", summary)
        self.assertNotIn("example", summary)

    def test_long_outer_fence_protects_nested_query_examples(self):
        example = "````markdown\n" + QUERY + "\n- [ ] example\n````\n"
        self.assertEqual(transform(example), example)
        summary = transform(example + "\n- [ ] real\n\n" + QUERY).split('<div class="garden-dataview"', 1)[1]
        self.assertIn("real", summary)
        self.assertNotIn("example", summary)

    def test_commented_queries_stay_comments_and_inline_comments_do_not_hide_tasks(self):
        commented = "<!--\n" + QUERY + "\n-->\n"
        self.assertEqual(transform(commented), commented)
        summary = transform(commented + "\n- [ ] visible <!-- private annotation -->\n\n" + QUERY).split('<div class="garden-dataview"', 1)[1]
        self.assertIn("visible", summary)
        self.assertNotIn("private annotation", summary)

    def test_multiline_tasks_and_incomplete_children_survive(self):
        source = """- [ ] parent
  first continuation

  second paragraph
  - [x] finished child
  - [ ] unfinished child
    child continuation
- [x] finished parent
  - [ ] unfinished descendant

""" + QUERY
        summary = transform(source).split('<div class="garden-dataview"', 1)[1]
        self.assertIn("    first continuation", summary)
        self.assertIn("    second paragraph", summary)
        self.assertIn("- [ ] unfinished child\n    child continuation", summary)
        self.assertIn("- [ ] unfinished descendant", summary)
        self.assertNotIn("- [x]", summary)

    def test_code_in_task_continuation_keeps_its_indentation(self):
        source = "- [ ] inspect example\n\n        example = True\n\n" + QUERY
        summary = transform(source).split('<div class="garden-dataview"', 1)[1]
        self.assertIn("\n        example = True", summary)

    def test_quoted_tasks_and_queries_warn_instead_of_silently_disappearing(self):
        with self.assertLogs(DATAVIEW.log, level="WARNING") as logs:
            transform("> - [ ] quoted task\n\n" + QUERY)
        self.assertIn("cannot summarize tasks inside blockquotes/callouts", logs.output[0])
        quoted_query = "\n".join("> " + line for line in QUERY.splitlines())
        with self.assertLogs(DATAVIEW.log, level="WARNING") as logs:
            self.assertEqual(transform("> [!note]\n" + quoted_query), "> [!note]\n" + quoted_query)
        self.assertIn("queries inside blockquotes/callouts are unsupported", logs.output[0])

    def test_quote_detection_preserves_code_and_comments_and_does_not_require_query_free_pages_to_change(self):
        quoted_example = "> ````markdown\n> ```dataview\n> task\n> ```\n> - [ ] example\n> ````\n"
        source = quoted_example + "<!--\n> - [ ] comment\n> ```dataview\n-->\n\n" + QUERY
        with patch.object(DATAVIEW.log, "warning") as warning:
            self.assertIn(quoted_example, transform(source))
            self.assertEqual(transform("> - [ ] standalone task"), "> - [ ] standalone task")
            self.assertEqual(transform("> ```dataview\n> unsupported\n> ```", path="tutorial.md"), "> ```dataview\n> unsupported\n> ```")
        warning.assert_not_called()

    def test_query_counter_matches_active_queries_and_ignores_examples(self):
        source = "````markdown\n" + QUERY + "\n````\n\n<!--\n" + QUERY + "\n-->\n\n" + QUERY
        self.assertEqual(DATAVIEW.count_supported_queries(source), 1)
        self.assertEqual(DATAVIEW.count_supported_queries(QUERY + "\n\n" + QUERY), 2)
        self.assertEqual(DATAVIEW.count_supported_queries("```dataview\nlist\n```"), 0)

    def test_multiple_queries_do_not_duplicate_extracted_tasks(self):
        output = transform("- [ ] one source task\n\n" + QUERY + "\n\n" + QUERY)
        self.assertEqual(output.count('data-dataview-static="incomplete-tasks"'), 2)
        self.assertEqual(output.count("- [ ] one source task"), 3)

    def test_case_and_whitespace_variations_are_supported_but_extra_clauses_are_not(self):
        self.assertTrue(DATAVIEW.supported_query(" TASK\n WHERE file.path=this.file.path AND ! completed \n"))
        self.assertFalse(DATAVIEW.supported_query("task where file.path = this.file.path and !completed limit 10"))

    def test_existing_vocabulary_queries_convert_and_tutorials_remain(self):
        count = 0
        for path in (ROOT / "docs/B-Notes/003英语/英语一真题").glob("*/Text[1-4].md"):
            source = path.read_text(encoding="utf-8")
            if "```dataview" not in source:
                continue
            output = transform(source, path=path.relative_to(ROOT / "docs").as_posix())
            self.assertIn('data-dataview-static="incomplete-tasks"', output, str(path))
            self.assertNotIn("```dataview", output, str(path))
            count += 1
        self.assertGreaterEqual(count, 28)
        path = ROOT / "docs/D-Orginals/260317095640.md"
        source = path.read_text(encoding="utf-8")
        self.assertEqual(transform(source, path=path.relative_to(ROOT / "docs").as_posix()), source)


if __name__ == "__main__":
    unittest.main()
