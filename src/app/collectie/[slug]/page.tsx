import { PortflowCollection } from "@/components/school/portflow-collection";

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6">
      <PortflowCollection slug={slug} />
    </div>
  );
}
