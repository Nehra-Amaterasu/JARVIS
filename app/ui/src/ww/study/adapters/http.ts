// The transport of the Study adapters (package AD08): the three kinds of request the exam routes need, all through the app's
// own authenticated helper in lib/api.ts, so the token is read from the window's fragment there and is never written here.
//
//   json   api(): the token header, JSON both ways, ApiError(status, the engine's sentence) on a non-2xx answer.
//   bytes  a page crop (R-08) is a PNG that an <img src> could not fetch, because the token rides in a header, so it is read
//          here and handed over as a data URI.
//   upload the raw bytes of a dropped file (R-15 is application/octet-stream, which api() does not send).
//
// A class of failure is named once, here, so every member of the port maps it the same way (the plan file, section 9.1.5:
// 400 bad value, 404 unknown id, 409 a job is running, 413 too large; a 404 on the whole prefix is the engine not being there).
import { api, ApiError, TOKEN } from '../../../lib/api'

export { ApiError }

export type FailClass = 'absent' | 'refused' | 'busy' | 'network' | 'aborted' | 'server'

export interface Fail { cls: FailClass; status: number; detail: string }

/** What a failed call looks like to the mappers. `status` is 0 when no answer came at all. */
export function classify(e: unknown): Fail {
  if (e instanceof ApiError) {
    // A route that exists answers a sentence ("No such subject."); FastAPI answers "Not Found" or "Method Not Allowed" only when
    // nothing is mounted there (or when the static mount of the built UI catches the path), which is the engine being absent.
    if ((e.status === 404 && e.message === 'Not Found') || (e.status === 405 && e.message === 'Method Not Allowed')) return { cls: 'absent', status: e.status, detail: e.message }
    if (e.status === 409) return { cls: 'busy', status: e.status, detail: e.message }
    if (e.status >= 500) return { cls: 'server', status: e.status, detail: e.message }
    return { cls: 'refused', status: e.status, detail: e.message }
  }
  if ((e as { name?: string } | null)?.name === 'AbortError') return { cls: 'aborted', status: 0, detail: 'stopped' }
  // The built UI's fallback answers the HTML of the shell for an unknown path: not JSON, which api() reports as a SyntaxError.
  if (e instanceof SyntaxError) return { cls: 'absent', status: 200, detail: 'the answer was not JSON' }
  return { cls: 'network', status: 0, detail: e instanceof Error ? e.message : 'no answer' }
}

/** The one plain sentence a FAULT carries: the status and the engine's own words. */
export function faultReason(f: Fail): string {
  if (f.cls === 'network') return `The app did not answer (${f.detail}).`
  if (f.cls === 'server') return `The engine failed (HTTP ${f.status}): ${f.detail}`
  if (f.cls === 'busy') return `The engine is busy (HTTP ${f.status}): ${f.detail}`
  return `The engine refused it (HTTP ${f.status}): ${f.detail}`
}

export const getJson = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal })
export const sendJson = <T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown, signal?: AbortSignal) => api<T>(path, { method, body, signal })

const authHeaders = (): Record<string, string> => ({ 'X-Jarvis-Token': TOKEN })

async function failOf(res: Response): Promise<ApiError> {
  let msg = res.statusText
  try { const j = await res.json(); msg = j.detail ?? j.error ?? msg } catch { /* not JSON */ }
  return new ApiError(res.status, msg)
}

/** Raw bytes in (a dropped file), a JSON answer out. The name travels in the query, as R-15 reads it. */
export async function upload<T>(path: string, file: Blob, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' }, body: file, signal })
  if (!res.ok) throw await failOf(res)
  return res.json() as Promise<T>
}

const B64_CHUNK = 0x8000
/** Bytes to a data URI, in chunks so a large crop does not overflow the argument limit. */
export function dataUri(bytes: ArrayBuffer, mime: string): string {
  const u = new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u.length; i += B64_CHUNK) s += String.fromCharCode(...u.subarray(i, i + B64_CHUNK))
  return `data:${mime};base64,${btoa(s)}`
}

/** A page crop as a data URI. A missing crop (404 "No crop for this question.") throws ApiError like every other call. */
export async function getImage(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(path, { headers: authHeaders(), signal })
  if (!res.ok) throw await failOf(res)
  return dataUri(await res.arrayBuffer(), res.headers.get('content-type') ?? 'image/png')
}
