import { CreateForms } from "@/components/CreateForms";
import { Shell } from "@/components/Shell";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Shell>
      <h1>A private page for someone in the hospital.</h1>
      <p>A few people at the bedside post updates. Everyone else can read, and that's all. No replies.</p>
      <CreateForms error={error} />
    </Shell>
  );
}
