export type Phase = "dns" | "tcp" | "tls" | "http" | "render";

export interface Target {
  scheme: "http" | "https";
  host: string;
  port: number;
  path: string;
}

export function parseTarget(text: string): Target {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`URLとして読めません（https:// から書きます）: "${text}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`http か https のURLだけを扱います: "${text}"`);
  }
  const scheme = url.protocol === "https:" ? "https" : "http";
  // URL は既定のポートを空文字にするので、スキームから補う
  const port = url.port ? Number(url.port) : scheme === "https" ? 443 : 80;
  return { scheme, host: url.hostname, port, path: `${url.pathname}${url.search}` };
}

export function loadPage(
  text: string,
  options: { fail?: Phase },
): { target: Target; phases: { phase: Phase; ok: boolean }[]; failedAt: Phase | null } {
  const target = parseTarget(text);
  const order: Phase[] =
    target.scheme === "https"
      ? ["dns", "tcp", "tls", "http", "render"]
      : ["dns", "tcp", "http", "render"];
  const phases: { phase: Phase; ok: boolean }[] = [];
  for (const phase of order) {
    const ok = options.fail !== phase;
    phases.push({ phase, ok });
    if (!ok) return { target, phases, failedAt: phase };
  }
  return { target, phases, failedAt: null };
}
