/**
 * Lets the lake model job prove who it is without a shared secret.
 *
 * GitHub Actions can hand a running workflow a short-lived token signed by GitHub. The token
 * names the repository, the branch and the workflow file. The app checks the signature against
 * GitHub's published keys and accepts the token only from this repository's lake model workflow
 * on its main branch. Nothing has to be copied into GitHub's settings.
 */
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { fetchText } from "./fetcher";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
export interface Jwks { keys: (JsonWebKey & { kid?: string })[] }
export interface Expected { repository: string; workflowFile: string; audience: string[]; now: Date }

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

/** Null when the token is good; otherwise why it was refused. The reason is for logs, never for the caller. */
export function refuseGithubToken(token: string, jwks: Jwks, expected: Expected): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return "not a token";
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try { header = decode(parts[0]!); claims = decode(parts[1]!); } catch { return "not a token"; }
  if (header.alg !== "RS256") return "wrong algorithm";
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return "unknown signing key";
  let signed = false;
  try { signed = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2]!, "base64url")); } catch { return "bad signature"; }
  if (!signed) return "bad signature";
  const seconds = expected.now.getTime() / 1000;
  if (claims.iss !== GITHUB_ISSUER) return "wrong issuer";
  if (typeof claims.exp !== "number" || claims.exp < seconds) return "expired";
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return "not yet valid";
  if (typeof claims.aud !== "string" || !expected.audience.includes(claims.aud)) return "wrong audience";
  if (claims.repository !== expected.repository) return "wrong repository";
  if (claims.ref !== "refs/heads/main") return "not the main branch";
  if (claims.job_workflow_ref !== `${expected.repository}/.github/workflows/${expected.workflowFile}@refs/heads/main`) return "wrong workflow";
  return null;
}

export async function githubKeys(): Promise<Jwks> {
  const res = await fetchText(`${GITHUB_ISSUER}/.well-known/jwks`, { key: "github/jwks", cacheMs: 3_600_000 });
  if (res.status !== 200) throw new Error(`GitHub keys answered ${res.status}`);
  return JSON.parse(res.body) as Jwks;
}
