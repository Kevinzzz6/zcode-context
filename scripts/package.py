"""Build and verify the local marketplace archive using only the Python standard library."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text())["version"]
source = root / "dist/local-marketplace"
archive = root / f"zcode-context-{version}-marketplace.zip"
files = sorted(p for p in source.rglob("*") if p.is_file())
assert files and (source / "marketplace.json").is_file(), "Build the marketplace first"
with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in files:
        bundle.write(path, "local-marketplace/" + path.relative_to(source).as_posix())
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None, "ZIP CRC failed"
    assert len(bundle.namelist()) == len(files)
    for path in files:
        assert bundle.read("local-marketplace/" + path.relative_to(source).as_posix()) == path.read_bytes()
    plugin = "local-marketplace/plugins/zcode-context/"
    for relative in [".zcode-plugin/plugin.json", "dist/server.mjs", "dist/worker.mjs", "dist/context.html", "THIRD_PARTY_NOTICES.txt"]:
        assert plugin + relative in bundle.namelist()
    assert json.loads(bundle.read(plugin + ".zcode-plugin/plugin.json"))["version"] == version
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + ".sha256").write_text(f"{checksum}  {archive.name}\n")
report = {"passed": True, "version": version, "archive": archive.name, "bytes": archive.stat().st_size,
          "files": len(files), "sha256": checksum, "checks": ["ZIP CRC", "required files", "manifest version", "every file equals marketplace source"]}
(root / "output/verification/package-result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
