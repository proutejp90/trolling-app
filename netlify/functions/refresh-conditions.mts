// Netlify scheduled function: asks the app to refresh its conditions cache every 30 minutes.
// Untested until the site is deployed. Any scheduler that can POST with the secret works the same.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("URL or CRON_SECRET is not set", { status: 500 });
  const res = await fetch(`${base}/api/jobs/refresh`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "*/30 * * * *" };
