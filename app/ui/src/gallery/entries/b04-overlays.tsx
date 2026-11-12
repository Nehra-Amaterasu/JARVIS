// The overlays of the kit: drawer, sheet, popover and the two retro dialogs. Each is drawn closed with its trigger; the bench
// page opens one on mount with ?open=<Overlay> so a probe can measure it. In the gallery they open on a press and close
// on Escape, and focus returns to the trigger.
import { useRef, useState } from 'react'
import * as kit from '../../shared/kit'
import type { GalleryEntryX } from '../types'
import { openParam } from '../fixtures'

const merged = 'kit move, first half, 12 Nov'

function DrawerDemo() {
  const [open, setOpen] = useState(openParam() === 'Drawer')
  return (
    <>
      <kit.Button onClick={() => setOpen(true)}>Open drawer</kit.Button>
      <kit.Drawer open={open} onClose={() => setOpen(false)} title="Settings">
        <p>Drawer body text.</p>
        <kit.Field label="Name" />
        <kit.Button>Save</kit.Button>
      </kit.Drawer>
    </>
  )
}
function SheetDemo() {
  const [open, setOpen] = useState(openParam() === 'Sheet')
  return (
    <>
      <kit.Button onClick={() => setOpen(true)}>Open sheet</kit.Button>
      <kit.Sheet open={open} onClose={() => setOpen(false)} title="Quick actions">
        <p>Sheet body text.</p>
        <kit.Button>Do it</kit.Button>
      </kit.Sheet>
    </>
  )
}
function PopoverDemo() {
  const [open, setOpen] = useState(openParam() === 'Popover')
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <kit.Button ref={anchor} onClick={() => setOpen(!open)}>Toggle popover</kit.Button>
      <kit.Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="More">
        <kit.Button size="sm">One</kit.Button> <kit.Button size="sm">Two</kit.Button>
      </kit.Popover>
    </>
  )
}
function DialogDemo() {
  const [open, setOpen] = useState(openParam() === 'RetroDialog')
  return (
    <>
      <kit.Button onClick={() => setOpen(true)}>Open dialog</kit.Button>
      <kit.RetroDialog open={open} title="Save changes" confirmLabel="Save" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} error="The last save failed">
        Keep these changes?
      </kit.RetroDialog>
    </>
  )
}
function DestructiveDemo() {
  const [open, setOpen] = useState(openParam() === 'RetroDialogDestructive')
  return (
    <>
      <kit.Button onClick={() => setOpen(true)}>Open destructive</kit.Button>
      <kit.RetroDialog open={open} destructive title="Delete note" confirmLabel="Delete" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)}>
        This cannot be undone.
      </kit.RetroDialog>
    </>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'kit/Drawer', title: 'Drawer and Sheet', group: 'kit', legacy: true, overlay: true, merged, also: ['Sheet'],
    note: 'A side drawer and a bottom sheet. Both trap focus, close on Escape and hand focus back.',
    states: [
      { label: 'closed (trigger) and open on ?open=Drawer', node: <DrawerDemo /> },
      { label: 'sheet (bottom)', node: <SheetDemo /> },
    ],
  },
  {
    id: 'kit/Popover', title: 'Popover', group: 'kit', legacy: true, overlay: true, merged,
    note: 'A small panel anchored to its trigger.',
    states: [{ label: 'closed (trigger) and open on ?open=Popover', node: <PopoverDemo /> }],
  },
  {
    id: 'kit/RetroDialog', title: 'RetroDialog', group: 'kit', legacy: true, overlay: true, merged,
    note: 'A confirm dialog. The destructive form names what will be lost and defaults to Cancel.',
    states: [
      { label: 'closed (trigger) and open on ?open=RetroDialog', node: <DialogDemo /> },
      { label: 'destructive (?open=RetroDialogDestructive)', node: <DestructiveDemo /> },
    ],
  },
]
export default entries
