// katex 0.16 ships no types and @types/katex is not installed (a new dependency needs the owner's OK),
// so this declares the one call the app makes.
declare module 'katex' {
  export interface KatexOptions {
    displayMode?: boolean
    throwOnError?: boolean
    output?: 'html' | 'mathml' | 'htmlAndMathml'
    strict?: boolean | string
    trust?: boolean
    errorColor?: string
  }
  export function renderToString(tex: string, options?: KatexOptions): string
  const katex: { renderToString: typeof renderToString }
  export default katex
}
