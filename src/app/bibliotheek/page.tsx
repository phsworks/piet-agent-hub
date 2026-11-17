import { FilesSection } from "@/components/library/files-section";
import { NotesSection } from "@/components/library/notes-section";

/** Everything saved: files (Drive) and notes, side by side on wide screens. */
export default function LibraryPage() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
      <FilesSection />
      <NotesSection />
    </div>
  );
}
