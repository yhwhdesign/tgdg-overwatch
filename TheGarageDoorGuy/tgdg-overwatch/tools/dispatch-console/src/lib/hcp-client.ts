// Thin wrapper around the Housecall Pro Public API.
// Requires the account to be on HCP's MAX plan (API + webhooks are gated to that tier).

const HCP_BASE_URL = "https://api.housecallpro.com";

function hcpHeaders() {
  const apiKey = process.env.HCP_API_KEY;
  if (!apiKey) throw new Error("HCP_API_KEY is not set");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function hcpFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${HCP_BASE_URL}${path}`, {
    ...init,
    headers: { ...hcpHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`HCP API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// TODO: confirm exact endpoint paths/params against https://docs.housecallpro.com
// once the API key is live — used by the backfill job.
export async function listJobs(params?: Record<string, string>) {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  return hcpFetch(`/jobs${qs}`);
}

export async function listEmployees() {
  return hcpFetch(`/employees`);
}
