import Link from "next/link";

export function Pagination({ page, pageSize, total, base, params }: { page: number; pageSize: number; total: number; base: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${base}?${q.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-sm">
      {page > 1 ? <Link className="font-semibold text-brand hover:underline" href={href(page - 1)}>← Previous</Link> : <span />}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? <Link className="font-semibold text-brand hover:underline" href={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
