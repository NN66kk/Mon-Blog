import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.split_backup import split_backup, write_stored


class SplitBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "original.zip"
        self.image = "a1234567-1234-1234-1234-123456789012.png"
        self.drafts = [{"id": f"a1234567-1234-1234-1234-12345678901{i}", "body": f"![image](/api/media/{self.image})", "title": f"Note {i}"} for i in range(3)]
        self.manifest = {"version": 1, "exported_at": "2026-10-22T00:00:00Z", "drafts": self.drafts}
        entries = [("manifest.json", json.dumps(self.manifest).encode()), (f"assets/{self.image}", b"original-image-bytes")]
        entries += [(f"drafts/{d['id']}.md", (d["body"] + "\n" + "x" * 650).encode()) for d in self.drafts]
        write_stored(self.source, entries)

    def test_split_preserves_manifest_markdown_and_shared_images(self):
        original = self.source.read_bytes()
        outputs = split_backup(self.source, self.root / "parts", max_bytes=2000)
        self.assertEqual(len(outputs), 3)
        recovered = []
        with zipfile.ZipFile(self.source) as source:
            for path in outputs:
                self.assertLessEqual(path.stat().st_size, 2000)
                with zipfile.ZipFile(path) as archive:
                    data = json.loads(archive.read("manifest.json"))
                    recovered.extend(data["drafts"])
                    self.assertIsNone(archive.testzip())
                    for entry in archive.infolist():
                        self.assertEqual(entry.flag_bits, 0x800)
                        self.assertEqual(entry.external_attr, 0)
                        if entry.filename.startswith(("drafts/", "assets/")):
                            self.assertEqual(archive.read(entry), source.read(entry.filename))
        self.assertEqual(recovered, self.drafts)
        self.assertEqual(self.source.read_bytes(), original)

    def test_missing_image_and_invalid_manifest_fail_without_outputs(self):
        for manifest in ([], {**self.manifest, "drafts": [self.drafts[0]]}):
            bad = self.root / f"bad-{isinstance(manifest, list)}.zip"
            write_stored(bad, [("manifest.json", json.dumps(manifest).encode())])
            with self.assertRaises(ValueError):
                split_backup(bad, self.root / "parts")
            self.assertFalse((self.root / "parts").exists())

    def test_existing_output_is_never_overwritten(self):
        output = self.root / "parts"
        output.mkdir()
        sentinel = output / "keep.txt"
        sentinel.write_text("unchanged")
        with self.assertRaises(FileExistsError):
            split_backup(self.source, output)
        self.assertEqual(sentinel.read_text(), "unchanged")

    def many_images_backup(self, single=False):
        images = [f"{i:08x}-1234-1234-1234-123456789012.png" for i in range(1002)]
        groups = [images] if single else [images[:501], images[501:]]
        drafts = [{**self.drafts[i], "body": "\n".join(f"![](/api/media/{name})" for name in group)} for i, group in enumerate(groups)]
        source = self.root / "many-images.zip"
        entries = [("manifest.json", json.dumps({**self.manifest, "drafts": drafts}).encode())]
        entries += [(f"drafts/{draft['id']}.md", draft["body"].encode()) for draft in drafts]
        entries += [(f"assets/{name}", b"small-image") for name in images]
        write_stored(source, entries)
        return source

    def test_many_small_images_are_split_before_restore_entry_limit(self):
        outputs = split_backup(self.many_images_backup(), self.root / "many-parts")
        self.assertEqual(len(outputs), 2)
        for path in outputs:
            with zipfile.ZipFile(path) as archive:
                self.assertEqual(sum(name.startswith("assets/") for name in archive.namelist()), 501)
                self.assertLessEqual(len(archive.namelist()), 1202)

    def test_single_draft_with_too_many_images_fails_before_writing(self):
        with self.assertRaisesRegex(ValueError, "1000"):
            split_backup(self.many_images_backup(single=True), self.root / "many-parts")
        self.assertFalse((self.root / "many-parts").exists())


if __name__ == "__main__":
    unittest.main()
