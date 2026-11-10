// The Life workspace (plan 4.6): five cards in the order the plan fixes them, on one laptop canvas.
//
//   Today view   LF1 Add to day | LF4 Quest over LF2 Attendance
//   Week view    LF3 This week | LF5 Gym
//
// The new layout rule (10 Nov) is "no page scroll": what does not fit one screen becomes a second view, a drawer
// or a pager, never a longer column. The wireframe's screen two (LF3, LF5) is the Week view; both views stay in
// the DOM and the idle one is `hidden`, so the cards keep their state and the card order stays LF1, LF4, LF2, LF3, LF5.
import { Segmented } from '../kit'
import { useWorkspaceValue } from '../frame/workspaceMemory'
import { AddToDay } from './AddToDay'
import { Attendance } from './Attendance'
import { GymCard } from './GymCard'
import { QuestCard } from './QuestCard'
import { ThisWeek } from './ThisWeek'
import { classProgress } from './derive'
import { useAttendance, useBody, useLifeDay } from './useLife'
import './life.css'

export type LifeView = 'today' | 'week'
const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week and gym' },
] as const

export function LifeWorkspace() {
  const [view, setView] = useWorkspaceValue<LifeView>('life', 'view', 'today')
  const day = useLifeDay()
  const att = useAttendance()
  const body = useBody()
  // While a class is unmarked the left column's All present owns the fill and Life declares no primary (plan 3.3).
  const classPending = classProgress(att.data?.today).pending > 0
  return (
    <div className="ww-life" data-view={view} data-ww-life="">
      <div className="ww-life-bar">
        <Segmented<LifeView> label="Life views" value={view} onChange={setView} options={[...VIEWS]} />
      </div>
      <div className="ww-life-pane" data-pane="today" hidden={view !== 'today'}>
        <AddToDay state={day} index={0} />
        <div className="ww-life-col">
          <QuestCard classPending={classPending} index={1} />
          <Attendance state={att} index={2} />
        </div>
      </div>
      <div className="ww-life-pane" data-pane="week" hidden={view !== 'week'}>
        <ThisWeek state={body} />
        <GymCard />
      </div>
    </div>
  )
}
