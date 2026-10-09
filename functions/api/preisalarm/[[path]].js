
const WORKER_URL =
  "https://kevcoupons-preisalarm.kevin03031991.workers.dev";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const path = url.pathname.replace(/^\/api\/preisalarm/, "");
  const target = WORKER_URL + (path || "/") + url.search;

  const headers = new Headers(request.headers);
  headers.set("Origin", "https://kevcoupons.pages.dev");
  headers.delete("Host");

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : request.body,
    redirect: "manual"
  });

  const resultHeaders = new Headers(response.headers);
  resultHeaders.delete("access-control-allow-origin");
  resultHeaders.delete("access-control-allow-credentials");

  return new Response(response.body, {
    status: response.status,
    headers: resultHeaders
  });
}
