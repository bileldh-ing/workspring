import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-10 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <LinkButton href="/">Back to home</LinkButton>
    </div>
  );
}
