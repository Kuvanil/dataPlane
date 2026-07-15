/** Small formatting helpers for the Security Admin UI. */

export function classNames(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function roleColor(role: string): string {
  switch (role) {
    case "admin":
      return "bg-red-500/10 text-red-300 border-red-500/30";
    case "analyst":
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    default:
      return "bg-blue-500/10 text-blue-300 border-blue-500/30";
  }
}

export function maskingTypeLabel(type: string): string {
  switch (type) {
    case "redact":
      return "Redact (***)";
    case "hash":
      return "Hash (SHA-256)";
    case "truncate":
      return "Truncate (first char)";
    case "substitute":
      return "Substitute ([MASKED])";
    case "nullify":
      return "Nullify (null)";
    default:
      return type;
  }
}

export function actionColor(action: string): string {
  if (action === "delete" || action === "admin") return "text-red-300";
  if (action === "edit" || action === "create" || action === "publish") return "text-amber-300";
  return "text-fg-subtle";
}
