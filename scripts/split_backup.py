#!/usr/bin/env python3
"""Split a legacy writing-room ZIP into restorable v1 packages, entirely offline.

The input is never changed or extracted. Each output keeps original Markdown,
manifest records and referenced private images; no credential or service needed.
"""
import argparse
import json
from pathlib import Path
import binascii
import re
import struct
import zipfile


MAX_INPUT = 512 * 1024 * 1024
MAX_PACKAGE = 32 * 1024 * 1024
MAX_DRAFTS = 100
MAX_IMAGES = 1000
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
IMAGES = re.compile(r"/api/media/([a-f0-9-]{36}\.(?:png|jpg|webp|gif))")
README = "Mon 写作室分批备份\n每个 ZIP 在设置与备份中先预览、再恢复为新的私有草稿。原文件及历史发布状态不被覆盖。\n".encode()


def write_stored(path, entries):
    """Match the writer's UTF-8 STORE ZIP format (including zero extra attrs)."""
    central = []
    with Path(path).open("xb") as output:
        for name, data in entries:
            encoded = name.encode("utf-8")
            checksum = binascii.crc32(data) & 0xffffffff
            offset = output.tell()
            local = struct.pack("<I5H3I2H", 0x04034b50, 20, 0x800, 0, 0, 33,
                                checksum, len(data), len(data), len(encoded), 0)
            output.write(local + encoded)
            output.write(data)
            central.append(struct.pack("<I6H3I5H2I", 0x02014b50, 20, 20, 0x800, 0, 0, 33,
                                       checksum, len(data), len(data), len(encoded), 0, 0, 0, 0, 0, offset) + encoded)
        start = output.tell()
        for record in central:
            output.write(record)
        output.write(struct.pack("<I4H2IH", 0x06054b50, 0, 0, len(central), len(central),
                                 output.tell() - start, start, 0))


def split_backup(source, output_dir, max_bytes=MAX_PACKAGE):
    source, output_dir = Path(source), Path(output_dir)
    if not 1024 <= max_bytes <= MAX_PACKAGE:
        raise ValueError("分包大小须在 1 KB 至 32 MB 之间。")
    if source.stat().st_size > MAX_INPUT:
        raise ValueError("旧备份超过 512 MB，停止读取。")
    with zipfile.ZipFile(source) as archive:
        entries = {}
        total = 0
        for entry in archive.infolist():
            name = entry.filename
            parts = name.split("/")
            if not name or name.startswith("/") or "\\" in name or any(p in {".", ".."} for p in parts) or any(ord(c) < 32 for c in name) or name in entries:
                raise ValueError("备份含重复或无效路径。")
            if entry.compress_type != zipfile.ZIP_STORED or entry.flag_bits & 1:
                raise ValueError("只支持写作室原样导出的未加密 v1 ZIP。")
            total += entry.file_size
            if total > MAX_INPUT or entry.file_size > MAX_PACKAGE:
                raise ValueError("备份或单个文件过大，无法安全拆分。")
            entries[name] = entry
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        drafts = manifest.get("drafts") if isinstance(manifest, dict) else None
        if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(drafts, list) or not drafts:
            raise ValueError("需要包含草稿的 version: 1 备份。")
        ids = set()
        for draft in drafts:
            if not isinstance(draft, dict) or not isinstance(draft.get("id"), str) or not UUID.fullmatch(draft["id"]) or draft["id"] in ids or not isinstance(draft.get("body"), str):
                raise ValueError("草稿 ID、正文或重复记录无效。")
            ids.add(draft["id"])

        def package(group):
            files = set()
            for draft in group:
                folder = "trash" if draft.get("deleted_at") else "drafts"
                files.add(f"{folder}/{draft['id']}.md")
                files.update(f"assets/{name}" for name in IMAGES.findall(draft["body"]))
            missing = files - entries.keys()
            if missing:
                raise ValueError(f"备份缺失 {len(missing)} 个 Markdown/图片文件，原文件未修改。")
            metadata = json.dumps({**manifest, "drafts": group}, ensure_ascii=False, indent=2).encode()
            sizes = [(name, entries[name].file_size) for name in sorted(files)]
            sizes += [("manifest.json", len(metadata)), ("README.txt", len(README))]
            size = 22 + sum(76 + 2 * len(name.encode()) + length for name, length in sizes)
            return files, metadata, size, sum(name.startswith("assets/") for name in files)

        groups, current = [], []
        for draft in drafts:
            candidate = current + [draft]
            candidate_package = package(candidate)
            if len(candidate) > MAX_DRAFTS or candidate_package[2] > max_bytes or candidate_package[3] > MAX_IMAGES:
                if current:
                    groups.append(current)
                current = [draft]
                single = package(current)
                if single[2] > max_bytes or single[3] > MAX_IMAGES:
                    raise ValueError("单篇草稿连同引用图片超过分包上限（32 MB / 1000 张图片），请在本地人工拆分内容。")
            else:
                current = candidate
        if current:
            groups.append(current)
        # Validate CRCs before writing any output. Keep all filesystem writes
        # separate from the input ZIP and never overwrite earlier split results.
        if archive.testzip() is not None:
            raise ValueError("备份 CRC 校验失败。")
        output_dir.mkdir(parents=True, exist_ok=False)
        outputs = []
        for index, group in enumerate(groups, 1):
            files, metadata, _, _ = package(group)
            destination = output_dir / f"backup-part-{index:03d}.zip"
            def content():
                for name in sorted(files):
                    yield name, archive.read(name)
                yield "manifest.json", metadata
                yield "README.txt", README
            write_stored(destination, content())
            outputs.append(destination)
        return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True, help="new directory; never overwrite existing files")
    args = parser.parse_args()
    try:
        outputs = split_backup(args.backup, args.output_dir)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"拆包失败：{exc}\n")
    for path in outputs:
        print(path.resolve())


if __name__ == "__main__":
    main()
