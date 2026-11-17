import { PortflowEvidence } from "@/components/school/portflow-evidence";

export default async function EvidencePage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key } = await params;
  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6">
      <PortflowEvidence slug={slug} rowKey={decodeURIComponent(key)} />
    </div>
  );
}
