"""Use the same diagram renderer and styles in MkDocs and the writing room."""

from pathlib import Path

from mkdocs.structure.files import File


ASSETS = Path(__file__).resolve().parents[1] / "publisher/public/diagrams"


def on_files(files, config):
    for name in ("mermaid-theme.mjs", "mermaid-renderer.mjs", "mermaid.css"):
        files.append(File.generated(
            config, f"assets/diagrams/{name}", abs_src_path=str(ASSETS / name)
        ))
    return files


def on_serve(server, config, builder):
    server.watch(str(ASSETS))
    return server
