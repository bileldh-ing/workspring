"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 py-10 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted">The error was logged. You can try again.</p>
      <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
