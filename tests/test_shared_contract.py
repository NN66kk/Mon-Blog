import json
from pathlib import Path
import tempfile
import unittest

from scripts.check_site import load_config_data
from scripts.sync_shared import generated_files
from shared.content_contract import CONTRACT, valid_article_path

ROOT = Path(__file__).resolve().parents[1]


class SharedContractTests(unittest.TestCase):
    def test_mirrors_match_single_source(self):
        for path, expected in generated_files():
            self.assertEqual(path.read_bytes(), expected, f"Run scripts/sync_shared.py --write: {path}")

    def test_mkdocs_inherits_public_rules(self):
        config = load_config_data(ROOT / "mkdocs.yml")
        for key in ("site_url", "repo_name", "exclude_docs", "extra"):
            self.assertEqual(config[key], CONTRACT[key])
        from mkdocs.config import load_config
        actual = load_config(str(ROOT / "mkdocs.yml"))
        self.assertEqual(actual.site_url, CONTRACT["site_url"])
        self.assertEqual(actual.extra["collections"], CONTRACT["extra"]["collections"])

    def test_article_path_contract_shared_with_publisher(self):
        for value in (None, 42, {}, []):
            self.assertFalse(valid_article_path(value))
        for case in json.loads((ROOT / "shared/path-cases.json").read_text()):
            with self.subTest(path=case["path"]):
                self.assertEqual(valid_article_path(case["path"]), case["valid"])

    def test_literal_exclusions_match_mkdocs_at_every_depth(self):
        from mkdocs.config import load_config
        config = load_config(str(ROOT / "mkdocs.yml"))
        for source in ("B-Notes/superpowers/example.md", "A-Life/nested/superpowers/example.md", "B-Notes/003英语/总结.md", "D-Orginals/苹果电脑自动化脚本教程_2025070215169.md"):
            self.assertTrue(config.exclude_docs.match_file(source), source)
            self.assertFalse(valid_article_path("docs/" + source), source)
        self.assertTrue(valid_article_path("docs/B-Notes/superpowers-example.md"))

    def test_data_loader_merges_inheritance_without_evaluating_tags(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "base.json").write_text('{"extra":{"one":1,"two":2},"list":[1,2]}')
            (root / "child.yml").write_text('INHERIT: base.json\nextra:\n  two: 3\nlist: [4]\nsite_dir: !ENV [NOT_A_REAL_VARIABLE, site]\ncallable: !!python/name:os.system\n')
            data = load_config_data(root / "child.yml")
            self.assertEqual(data["extra"], {"one": 1, "two": 3})
            self.assertEqual(data["list"], [4])
            self.assertEqual(data["site_dir"], "site")
            self.assertIsNone(data["callable"])

    def test_data_loader_rejects_cycles(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cycle.yml"
            path.write_text("INHERIT: cycle.yml\n")
            with self.assertRaisesRegex(ValueError, "Cyclic"):
                load_config_data(path)


if __name__ == "__main__":
    unittest.main()
