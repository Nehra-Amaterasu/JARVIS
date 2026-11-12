// How a plate, a chip or a disabled control asks for the "What is coming" card. The shell (B05) owns the one
// overlay host and installs the opener; until then each product passes its own `onOpen`, and with neither the
// click does nothing (a planned control must never do something that looks like work).
type Opener = (id: string) => void

let opener: Opener | null = null

/** Install the shell's opener. Returns the function that removes it, for tests and for hot reload. */
export function setPlannedOpener(fn: Opener | null): () => void {
  opener = fn
  return () => {
    if (opener === fn) opener = null
  }
}

export function openPlanned(id: string): void {
  opener?.(id)
}
