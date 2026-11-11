from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


SOURCE_DIRECTORIES = ("src", "tests", "public")
SECRET_SUFFIXES = {".key", ".pem", ".p12", ".pfx", ".crt"}
SECRET_NAMES = {"credentials.json", "service-account.json", "secrets.json"}


def is_secret(file: Path) -> bool:
    name = file.name.lower()
    return name == ".env" or name.startswith(".env.") or name in SECRET_NAMES or file.suffix.lower() in SECRET_SUFFIXES


def included_tree(directory: Path, output: Path):
    if not directory.is_dir() or directory.is_symlink():
        return
    for current, directories, files in os.walk(directory, topdown=True, followlinks=False):
        current_path = Path(current)
        directories[:] = sorted(
            name for name in directories
            if not (current_path / name).is_symlink()
            and name not in {"node_modules", ".next", ".runtime", "__pycache__"}
        )
        for name in sorted(files):
            file = current_path / name
            if file.is_symlink() or file == output or name == ".DS_Store" or file.suffix.lower() == ".pyc" or is_secret(file):
                continue
            yield file


def included_files(root: Path, output: Path):
    for name in ("AGENTS.md", "README.md", ".gitignore"):
        file = root / name
        if file.is_file() and not file.is_symlink() and not is_secret(file):
            yield file
    skills = root / ".agents" / "skills"
    yield from included_tree(skills, output)
    workbench = root / "workbench"
    for file in sorted(workbench.glob("package*.json")):
        if file.is_file() and not file.is_symlink() and not is_secret(file):
            yield file
    config = workbench / "next.config.mjs"
    if config.is_file() and not config.is_symlink():
        yield config
    for name in SOURCE_DIRECTORIES:
        yield from included_tree(workbench / name, output)


def package(root: Path, output: Path) -> dict:
    root = root.resolve()
    output = output.resolve()
    required = [
        root / "AGENTS.md",
        root / "README.md",
        root / ".agents" / "skills",
        root / "workbench" / "package.json",
        root / "workbench" / "src",
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.exists()]
    if missing:
        raise RuntimeError("專案缺少必要檔案：" + "、".join(missing))
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    entries = []
    prefix = "review-with-agent"
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for file in included_files(root, output):
            relative = file.relative_to(root)
            archive_name = f"{prefix}/{relative.as_posix()}"
            info = ZipInfo(archive_name)
            info.date_time = (1980, 1, 1, 0, 0, 0)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (file.stat().st_mode & 0xFFFF) << 16
            archive.writestr(info, file.read_bytes())
            entries.append(archive_name)

    forbidden = ("/.git/", "/.next/", "/.runtime/", "/dist/", "/lessons/", "/node_modules/")
    invalid = [
        name
        for name in entries
        if any(marker in f"/{name}/" for marker in forbidden)
        or name.endswith("/.DS_Store")
        or name.endswith(".pyc")
        or Path(name).name.lower() == ".env"
        or Path(name).name.lower().startswith(".env.")
    ]
    if invalid:
        output.unlink(missing_ok=True)
        raise RuntimeError("打包內容含有禁止項目：" + "、".join(invalid[:5]))
    return {"package": str(output), "files": len(entries), "projectRoot": str(root)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    root = arguments.project_root.resolve()
    output = arguments.output or root / "dist" / "review-with-agent.zip"
    print(json.dumps(package(root, output.resolve()), ensure_ascii=False))


if __name__ == "__main__":
    main()
