import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | unknown;

export function mockFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return result instanceof Response ? result : jsonResponse(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Thumbnails are found by asset id (their src), because the alt text is the
// title or date and not unique per asset (P3.4).
export function queryThumb(id: string): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>(`img[src*="/thumb/${id}?"]`);
}

export function getThumb(id: string): HTMLImageElement {
  const found = queryThumb(id);
  if (!found) throw new Error(`no thumbnail for asset ${id}`);
  return found;
}

export async function findThumb(id: string): Promise<HTMLImageElement> {
  const { waitFor } = await import("@testing-library/react");
  return waitFor(() => getThumb(id));
}
