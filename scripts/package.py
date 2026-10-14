"""Package the repository marketplace (root marketplace.json + plugins/) into a distributable zip, standard library only."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
archive = root / f"zcode-context-{version}-marketplace.zip"
prefix = "zcode-context-marketplace/"
plugin_dir = root / "plugins/zcode-context"
files = {prefix + "marketplace.json": root / "marketplace.json"}
for path in sorted(p for p in plugin_dir.rglob("*") if p.is_file()):
    files[prefix + "plugins/zcode-context/" + path.relative_to(plugin_dir).as_posix()] = path
(root / "output/verification").mkdir(parents=True, exist_ok=True)
assert len(files) > 1 and all(p.is_file() for p in files.values()), "Build the marketplace first (npm run build)"
with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    for name, path in files.items():
        bundle.write(path, name)
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None, "ZIP CRC failed"
    assert len(bundle.namelist()) == len(files)
    for name, path in files.items():
        assert bundle.read(name) == path.read_bytes()
    plugin = prefix + "plugins/zcode-context/"
    for relative in [".zcode-plugin/plugin.json", "dist/server.mjs", "dist/worker.mjs", "dist/context.html", "THIRD_PARTY_NOTICES.txt"]:
        assert plugin + relative in bundle.namelist()
    assert json.loads(bundle.read(plugin + ".zcode-plugin/plugin.json"))["version"] == version
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + ".sha256").write_text(f"{checksum}  {archive.name}\n", encoding="utf-8")
report = {"passed": True, "version": version, "archive": archive.name, "bytes": archive.stat().st_size,
          "files": len(files), "sha256": checksum, "checks": ["ZIP CRC", "required files", "manifest version", "every file equals repository marketplace"]}
(root / "output/verification/package-result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
