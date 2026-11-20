// The dMAT practice logic (plan 4.15), moved out of the classic page so the classic Dmat and the rebuilt DmatBoard run the same code.
// A set is (kind, seed, level, n): the same seed is the same set. The server marks it, so no key is ever held here. The countdown
// runs only while a timed set is on screen; at 0 the set is marked as it stands.
import { useEffect, useRef, useState } from 'react'
import { dmatHistory, dmatScore, dmatSet, type DmatKind, type DmatResult, type DmatRow, type DmatSet } from '../api'

export const KIND_LABEL: Record<DmatKind, string> = { figure: 'Figure sequences', equation: 'Equations', latin: 'Latin squares' }

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function useDmat() {
  const [kind, setKind] = useState<DmatKind>('figure')
  const [n, setN] = useState('10')
  const [level, setLevel] = useState('1')
  const [timer, setTimer] = useState<'on' | 'off'>('on')
  const [seedText, setSeedText] = useState('')
  const [hist, setHist] = useState<DmatRow[] | null | 'absent'>(null)
  const [set, setSet] = useState<DmatSet | null>(null)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState<number | null>(null)
  const [result, setResult] = useState<DmatResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(0)

  const loadHist = () => dmatHistory().then((r) => setHist(r.results)).catch(() => setHist('absent'))
  useEffect(() => { void loadHist() }, [])

  const finish = async (s: DmatSet, a: (number | null)[]) => {
    setBusy(true)
    try {
      const r = await dmatScore(s.set_id, a, Math.round((Date.now() - started.current) / 1000))
      setResult(r)
      setSet(null)
      void loadHist()
    } catch {
      setErr('The score could not be saved. Is the app running?')
    } finally { setBusy(false) }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (!set || left === null) return
    if (left <= 0) { void finishRef.current(set, answers); return }
    const t = setTimeout(() => setLeft((x) => (x === null ? x : x - 1)), 1000)
    return () => clearTimeout(t)
  }, [set, left, answers])

  const start = async () => {
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      const seed = seedText.trim() ? Number(seedText) : Math.floor(Math.random() * 1_000_000) + 1
      const s = await dmatSet(kind, seed, Number(n), Number(level))
      started.current = Date.now()
      setSet(s)
      setAnswers(s.items.map(() => null))
      setAt(0)
      setLeft(timer === 'on' ? s.time_limit_s : null)
    } catch (e) {
      setErr((e as Error).message || 'The set could not be built.')
    } finally { setBusy(false) }
  }

  const pick = (i: number) => setAnswers((a) => a.map((v, j) => (j === at ? i : v)))
  const last = hist && hist !== 'absent' && hist.length ? hist[0] : null

  return { kind, setKind, n, setN, level, setLevel, timer, setTimer, seedText, setSeedText, hist, set, answers, at, setAt, left, result, err, busy, start, finish, pick, last }
}
