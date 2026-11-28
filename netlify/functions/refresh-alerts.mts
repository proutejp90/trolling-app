// Netlify scheduled function: refreshes marine alerts every 15 minutes.
// The full refresh also fetches them, so this one only fills the quarter hours in between.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("URL or CRON_SECRET is not set", { status: 500 });
  const res = await fetch(`${base}/api/jobs/alerts`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "15,45 * * * *" };
