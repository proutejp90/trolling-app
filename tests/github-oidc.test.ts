/** The lake model job's token check, with a key pair made for the test. No network. */
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GITHUB_ISSUER, refuseGithubToken, type Jwks } from "../src/server/github-oidc";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks: Jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }] };
const now = new Date("2026-11-28T15:40:00Z");
const expected = { repository: "proutejp90/trolling-app", workflowFile: "lake-model.yml", audience: ["https://evanstism.netlify.app"], now };
const good = {
  iss: GITHUB_ISSUER, aud: "https://evanstism.netlify.app", exp: now.getTime() / 1000 + 300, nbf: now.getTime() / 1000 - 5,
  repository: "proutejp90/trolling-app", ref: "refs/heads/main",
  job_workflow_ref: "proutejp90/trolling-app/.github/workflows/lake-model.yml@refs/heads/main",
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: object, opts: { key?: typeof privateKey; kid?: string; alg?: string } = {}) {
  const body = `${b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" })}.${b64(claims)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(opts.key ?? privateKey).toString("base64url")}`;
}

describe("GitHub token for the lake model job", () => {
  it("accepts a token GitHub signed for this repository's lake model workflow on main", () => {
    expect(refuseGithubToken(token(good), jwks, expected)).toBeNull();
  });

  it("refuses anything else", () => {
    const refused = (claims: object, opts = {}) => refuseGithubToken(token(claims, opts), jwks, expected);
    expect(refused({ ...good, repository: "someone/else" })).toBe("wrong repository");
    expect(refused({ ...good, ref: "refs/heads/feature" })).toBe("not the main branch");
    expect(refused({ ...good, ref: "refs/pull/3/merge" })).toBe("not the main branch");
    expect(refused({ ...good, job_workflow_ref: "proutejp90/trolling-app/.github/workflows/ci.yml@refs/heads/main" })).toBe("wrong workflow");
    expect(refused({ ...good, aud: "https://example.com" })).toBe("wrong audience");
    expect(refused({ ...good, iss: "https://example.com" })).toBe("wrong issuer");
    expect(refused({ ...good, exp: now.getTime() / 1000 - 1 })).toBe("expired");
    expect(refused(good, { key: other.privateKey })).toBe("bad signature"); // signed by someone who is not GitHub
    expect(refused(good, { kid: "k2" })).toBe("unknown signing key");
    expect(refused(good, { alg: "none" })).toBe("wrong algorithm");
    expect(refuseGithubToken("local-test-secret", jwks, expected)).toBe("not a token");
    // A token with its claims swapped after signing.
    const [h, , sig] = token(good).split(".");
    expect(refuseGithubToken(`${h}.${b64({ ...good, repository: "proutejp90/trolling-app", exp: 9e9 })}.${sig}`, jwks, expected)).toBe("bad signature");
  });
});
