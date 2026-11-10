// The counter tiles of the left column (L4), written here because their one rule belongs to Life: the
// "Went to college" tile is read from the class list and never tapped (LIFE-06). The left column mounts this;
// it needs the counters of /api/mission/life and the answer of /api/mission/attendance, nothing else.
import { Minus, Plus } from 'lucide-react'
import { Button, IconButton } from '../kit'
import { counterTiles, type AttendanceAnswer, type Counter } from './derive'

interface Props {
  counters: Counter[]
  attendance: AttendanceAnswer | null | undefined
  /** Moves a counter: `delta` for a count, `value` for a yes/no. The caller owns the server call and the rollback. */
  onCount?: (id: string, body: { delta?: number; value?: number }) => void
}

export function CounterTiles({ counters, attendance, onCount }: Props) {
  const tiles = counterTiles(counters, attendance)
  return (
    <ul className="ww-life-tiles" aria-label="Counters">
      {tiles.map((t) => (
        <li key={t.id} className="ww-life-tile" data-kind={t.kind} data-tile={t.id}>
          <span className="ww-life-tilename">{t.name}</span>
          {t.kind === 'derived' ? (
            <span className="ww-life-tilevalue" data-derived="">
              {t.word}
              <span className="ww-sr-only">, from today&apos;s class list</span>
            </span>
          ) : t.kind === 'yes' ? (
            <Button size="sm" grouped aria-pressed={!!t.value} onClick={() => onCount?.(t.id, { value: t.value ? 0 : 1 })}>
              {t.word}
            </Button>
          ) : (
            <span className="ww-life-tilecount">
              <IconButton label={`${t.name}: one less`} size="sm" grouped disabled={!t.value} onClick={() => onCount?.(t.id, { delta: -1 })}>
                <Minus size={14} aria-hidden="true" />
              </IconButton>
              <b className="ww-life-tilevalue">{t.word}</b>
              <IconButton label={`${t.name}: one more`} size="sm" grouped onClick={() => onCount?.(t.id, { delta: 1 })}>
                <Plus size={14} aria-hidden="true" />
              </IconButton>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
