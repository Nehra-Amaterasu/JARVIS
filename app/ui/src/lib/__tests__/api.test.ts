// R32 (27 Nov): `msg = j.detail ?? ...` turned an object detail into "[object Object]" on the engine's 409 {message, id, present}, which lost
// the engine's sentence. The sentence is the object's message, and the object itself rides on the ApiError.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, errorSentence } from '../api'

const answer = (status: number, body: unknown, statusText = 'Conflict') =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, statusText, json: async () => body })))

afterEach(() => vi.unstubAllGlobals())

describe('errorSentence', () => {
  it('reads a string detail as it is', () => expect(errorSentence({ detail: 'No such paper.' }, 'x')).toBe('No such paper.'))
  it('reads the message of an object detail, not "[object Object]"', () => {
    expect(errorSentence({ detail: { message: 'That counter changed in another window.', id: 'water', present: 5 } }, 'x')).toBe('That counter changed in another window.')
  })
  it('falls back to error, then to the status text', () => {
    expect(errorSentence({ error: 'bad' }, 'x')).toBe('bad')
    expect(errorSentence({ detail: { id: 'water' } }, 'Conflict')).toBe('Conflict')
    expect(errorSentence(null, 'Conflict')).toBe('Conflict')
  })
})

describe('api on a refusal', () => {
  it('a 409 with an object detail says the engine sentence and keeps the detail on the error', async () => {
    const detail = { message: 'Water is 5 on the server now.', id: 'water', present: 5 }
    answer(409, { detail })
    const err = await api('/x', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe('Water is 5 on the server now.')
    expect((err as ApiError).detail).toEqual(detail)
  })
  it('a string detail still reads as the string, and the detail is that string', async () => {
    answer(404, { detail: 'No such counter.' }, 'Not Found')
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError
    expect(err.message).toBe('No such counter.')
    expect(err.detail).toBe('No such counter.')
  })
  it('a body that is not JSON keeps the status text and a null detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, statusText: 'Bad Gateway', json: async () => { throw new Error('no') } })))
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError
    expect(err.message).toBe('Bad Gateway')
    expect(err.detail).toBeNull()
  })
})
