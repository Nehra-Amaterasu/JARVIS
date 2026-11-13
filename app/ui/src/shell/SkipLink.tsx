/**
 * "Skip to canvas" (A.N02 f, WCAG 2.4.1 Bypass Blocks): the first Tab stop of the shell. Hidden until it has
 * focus, then a 44 px plate at the top left. It moves focus to the canvas (`<main id="s2-canvas" tabIndex=-1>`)
 * by script and cancels the link's own jump, because the URL fragment carries the sandbox token and the route
 * (`#t=...`, `#/day/today`): writing `#s2-canvas` into it would drop both.
 */
import type { MouseEvent } from 'react'

export interface SkipLinkProps {
  /** The id of the element that receives focus; it must have tabIndex -1 or be focusable. */
  target?: string
  label?: string
}

export function SkipLink({ target = 's2-canvas', label = 'Skip to canvas' }: SkipLinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(target)?.focus()
  }
  return (
    <a className="s2-skip" href={`#${target}`} onClick={onClick}>
      {label}
    </a>
  )
}
