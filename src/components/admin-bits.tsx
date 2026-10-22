import { Notice } from "./ui";

export function NoPermission({ perm }: { perm: string }) {
  return <Notice tone="warn" title="Not available for your staff role">This page needs the <code>{perm}</code> permission. Ask a superadmin if you need access.</Notice>;
}
