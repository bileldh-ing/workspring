"use client";

import { useState } from "react";

/** Hidden input carrying the browser's UTC offset (minutes) so datetime-local values can be stored as UTC. */
export function TzOffsetInput() {
  const [offset] = useState(() => (typeof window === "undefined" ? "0" : String(new Date().getTimezoneOffset())));
  return <input type="hidden" name="tzOffset" value={offset} suppressHydrationWarning />;
}
