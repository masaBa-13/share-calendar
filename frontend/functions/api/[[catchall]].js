const WORKER_URL = 'https://aima.miraidai.workers.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = WORKER_URL + url.pathname + url.search;
  return fetch(targetUrl, context.request);
}
