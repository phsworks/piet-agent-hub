// Browser helpers to turn drops and file inputs into files with relative paths.

export type PickedFile = { file: File; path: string };

async function walk(entry: FileSystemEntry, out: PickedFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) =>
      (entry as FileSystemFileEntry).file(ok, fail)
    );
    out.push({ file, path: entry.fullPath.replace(/^\//, "") });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches until it returns an empty list.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

/** Files from a drop, including everything inside dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);

  if (entries.length === 0) {
    return [...dt.files].map((file) => ({ file, path: file.name }));
  }
  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

/** Files from an <input type="file">, using webkitRelativePath for folder pickers. */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return [...(list ?? [])].map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

export function isFileDrag(e: DragEvent | React.DragEvent) {
  return [...(e.dataTransfer?.types ?? [])].includes("Files");
}
