// The form the left rail is drawn in. 'column' is the desk's recessed channel (the default); 'row' is the phone's folded form: one
// short row (the date, the next sitting, how many classes are marked) and one key that opens the whole rail beneath it. A page
// sets it once for the rail it hosts; the rail reads it, so the host passes the rail as a plain node and no prop is threaded.
import { createContext, useContext, type ReactNode } from 'react'

export type RailForm = 'column' | 'row'

const Ctx = createContext<RailForm>('column')

export function RailFormProvider({ value, children }: { value: RailForm; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useRailForm = (): RailForm => useContext(Ctx)
