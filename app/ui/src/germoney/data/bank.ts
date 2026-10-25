/**
 * The skill-tree DATA BANK: typed loader + validator.
 *
 * Research agents write the JSON files into ./bank/ (skilltree.json, certs.json,
 * resources-career.json, resources-academic.json, math-track.json). Any subset may
 * exist at a time: Vite's import.meta.glob bundles exactly the files that are there.
 * Private academics are NOT here; the server serves them (/api/mission/academics).
 *
 * Rules, the same as the server's merge_bank (app/jarvis_app/germoney.py):
 *   - an unknown id (prerequisite, resource, certificate, career weight) is a
 *     WARNING and the reference is dropped, so one typo never locks a node forever;
 *   - a prerequisite cycle is an ERROR (the tree would be unplayable);
 *   - a file that is not the expected shape is an ERROR and is skipped.
 * Both loaders are tested against the same fixtures (src/__tests__/fixtures).
 */

export interface BankContract {
  id: string
  title: string
  minutes: number
  context: string
  steps: string[]
  hint: string
  success_check: string
  xp: number
}

export interface BankProject { title: string; deliverable: string; linkedin_line: string }

export interface BankNode {
  id: string
  name: string
  branch: string
  tier: number
  prereqs: string[]
  outcomes: string[]
  hours_est: number
  resources: string[]
  certs: string[]
  project: BankProject | null
  contracts: BankContract[]
  /** Skill tree v2: how much of each maths-track node this needs, 0..1 (only non-zero weights kept). */
  maths: Record<string, number>
}

export interface BankResource {
  id: string
  title: string
  kind: string
  url: string
  free: boolean
  legal_pdf_url: string | null
  /** A certs.json id, or the certificate's own details ({provider, exam_fee_inr, note}). */
  certificate: string | Record<string, unknown> | null
  covers: string[]
  skip_topics: string[]
  hours: number | null
}

export interface BankCert {
  id: string
  name: string
  issuer: string
  cost_inr: number | null
  free_option: string | null
  time_hours: number | null
  /** 1-5 in the real bank (a word in older files). */
  credibility: number | string
  credibility_by_career: Record<string, number>
  linkedin_worthy: boolean
  node_ids: string[]
  url: string | null
  notes: string
  price_status: string
  /** Made from a resource's certificate field (a node listed the resource id as a cert). */
  from_resource?: boolean
}

export interface Career { id: string; name: string; summary: string; weights: Record<string, number> }

export interface Bank {
  version: string | null
  careers: Career[]
  nodes: Record<string, BankNode>
  order: string[]
  resources: Record<string, BankResource>
  certs: Record<string, BankCert>
  math: { diagnostic: unknown[]; practice_engine: Record<string, unknown> }
  /** contract id → node id (contract ids are global in the real bank: "math.numerical_methods.c01"). */
  contractIndex: Record<string, string>
  warnings: string[]
  errors: string[]
  files: string[]
}

export const BANK_FILES = ['skilltree.json', 'certs.json', 'resources-career.json', 'resources-academic.json', 'math-track.json'] as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] =>
  typeof v === 'string' ? (v.trim() ? [v] : []) : list(v).filter((x) => typeof x === 'string' || typeof x === 'number').map(String)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.trunc(n))) : dflt
}

function cleanContract(c: unknown, nodeId: string, i: number, warn: string[]): BankContract | null {
  if (!isObj(c) || !c.title) {
    warn.push(`node ${nodeId}: contract #${i + 1} has no title, skipped`)
    return null
  }
  const id = c.id ? String(c.id) : `c${i + 1}`
  if (!c.id) warn.push(`node ${nodeId}: contract '${String(c.title)}' has no id, using ${id}`)
  return {
    id, title: String(c.title), minutes: clampInt(c.minutes || 30, 5, 240, 30), context: String(c.context ?? ''),
    steps: strs(c.steps), hint: String(c.hint ?? ''), success_check: String(c.success_check ?? ''), xp: clampInt(c.xp || 20, 0, 200, 20),
  }
}

function cleanNode(n: unknown, defaultBranch: string | null, warn: string[]): BankNode | null {
  if (!isObj(n) || !n.id || !n.name) {
    warn.push('a node without id or name was skipped')
    return null
  }
  const id = String(n.id)
  const p = n.project
  const contracts = list(n.contracts).map((c, i) => cleanContract(c, id, i, warn)).filter((c): c is BankContract => !!c)
  const seen = new Set<string>()
  for (const c of contracts) {
    if (seen.has(c.id)) c.id = `${c.id}-${seen.size}`
    seen.add(c.id)
  }
  return {
    id, name: String(n.name), branch: String(n.branch || defaultBranch || 'general'), tier: clampInt(n.tier ?? 0, 0, 99, 0),
    prereqs: strs(n.prereqs), outcomes: strs(n.outcomes), hours_est: Math.max(0, num(n.hours_est) ?? 0),
    resources: strs(n.resources), certs: strs(n.certs),
    project: isObj(p) && p.title ? { title: String(p.title), deliverable: String(p.deliverable ?? ''), linkedin_line: String(p.linkedin_line ?? '') } : null,
    contracts, maths: cleanMaths(n.maths, id, warn),
  }
}

function cleanMaths(v: unknown, id: string, warn: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, w] of Object.entries(isObj(v) ? v : {})) {
    const x = num(w)
    if (x === null) warn.push(`node ${id}: maths weight for ${k} is not a number`)
    else if (x > 0) out[k] = Math.min(1, x)
  }
  return out
}

/** Every prerequisite cycle as a list of ids (first id repeated at the end). Iterative DFS. */
export function findCycles(nodes: Record<string, BankNode>): string[][] {
  const colour: Record<string, 0 | 1 | 2> = {}
  for (const k of Object.keys(nodes)) colour[k] = 0
  const cycles: string[][] = []
  for (const root of Object.keys(nodes)) {
    if (colour[root] !== 0) continue
    const path: string[] = []
    const stack: [string, number][] = [[root, 0]]
    while (stack.length) {
      const [u, i] = stack.pop()!
      if (i === 0) {
        colour[u] = 1
        path.push(u)
      }
      const pre = nodes[u].prereqs.filter((p) => p in nodes)
      if (i < pre.length) {
        stack.push([u, i + 1])
        const v = pre[i]
        if (colour[v] === 1) cycles.push([...path.slice(path.indexOf(v)), v])
        else if (colour[v] === 0) stack.push([v, 0])
      } else {
        colour[u] = 2
        path.pop()
      }
    }
  }
  return cycles
}

/** Merge whatever bank files exist (file name → parsed JSON) into one validated bank. */
export function mergeBank(files: Partial<Record<string, unknown>>): Bank {
  const warn: string[] = []
  const err: string[] = []
  const nodes: Record<string, BankNode> = {}
  const order: string[] = []
  const resources: Record<string, BankResource> = {}
  const certs: Record<string, BankCert> = {}
  const careers: Career[] = []
  let math: Bank['math'] = { diagnostic: [], practice_engine: {} }
  let version: string | null = null

  const addNodes = (raw: unknown, defaultBranch: string | null, src: string) => {
    for (const n of list(raw)) {
      const node = cleanNode(n, defaultBranch, warn)
      if (!node) continue
      if (nodes[node.id]) {
        warn.push(`${src}: duplicate node id ${node.id}, the first one wins`)
        continue
      }
      nodes[node.id] = node
      order.push(node.id)
    }
  }
  const addResources = (raw: unknown, src: string) => {
    for (const r of list(raw)) {
      if (!isObj(r) || !r.id || !r.url) {
        warn.push(`${src}: a resource without id or url was skipped`)
        continue
      }
      const id = String(r.id)
      if (resources[id]) {
        warn.push(`${src}: duplicate resource id ${id}, the first one wins`)
        continue
      }
      resources[id] = {
        id, title: String(r.title || id), kind: String(r.kind || 'link'), url: String(r.url), free: r.free === undefined ? true : !!r.free,
        legal_pdf_url: r.legal_pdf_url ? String(r.legal_pdf_url) : null,
        certificate: typeof r.certificate === 'string' && r.certificate ? r.certificate : isObj(r.certificate) ? r.certificate : null,
        covers: strs(r.covers), skip_topics: strs(r.skip_topics), hours: num(r.hours),
      }
    }
  }

  const tree = files['skilltree.json']
  if (tree !== undefined) {
    if (!isObj(tree)) err.push('skilltree.json: expected an object {version, careers, nodes}')
    else {
      version = tree.version == null ? null : String(tree.version)
      for (const c of list(tree.careers)) {
        if (!isObj(c) || !c.id) continue
        const weights: Record<string, number> = {}
        for (const [k, v] of Object.entries(isObj(c.weights) ? c.weights : {})) {
          const w = num(v)
          if (w === null) warn.push(`career ${String(c.id)}: weight for ${k} is not a number`)
          else weights[k] = Math.max(0, Math.min(1, w))
        }
        careers.push({ id: String(c.id), name: String(c.name || c.id), summary: String(c.summary ?? ''), weights })
      }
      addNodes(tree.nodes, null, 'skilltree.json')
    }
  }
  const mt = files['math-track.json']
  if (mt !== undefined) {
    if (!isObj(mt)) err.push('math-track.json: expected an object {version, diagnostic, nodes, resources, practice_engine}')
    else {
      addNodes(mt.nodes, 'math', 'math-track.json')
      addResources(mt.resources, 'math-track.json')
      math = { diagnostic: list(mt.diagnostic), practice_engine: isObj(mt.practice_engine) ? mt.practice_engine : {} }
    }
  }
  for (const name of ['resources-career.json', 'resources-academic.json']) {
    if (files[name] === undefined) continue
    if (!Array.isArray(files[name])) err.push(`${name}: expected a list of resources`)
    else addResources(files[name], name)
  }
  const cf = files['certs.json']
  if (cf !== undefined) {
    if (!Array.isArray(cf)) err.push('certs.json: expected a list of certificates')
    else {
      for (const c of cf) {
        if (!isObj(c) || !c.id || !c.name) {
          warn.push('certs.json: a certificate without id or name was skipped')
          continue
        }
        certs[String(c.id)] = {
          id: String(c.id), name: String(c.name), issuer: String(c.issuer ?? ''), cost_inr: num(c.cost_inr),
          free_option: c.free_option ? String(c.free_option) : null, time_hours: num(c.time_hours),
          credibility: typeof c.credibility === 'number' || typeof c.credibility === 'string' ? c.credibility : '',
          credibility_by_career: isObj(c.credibility_by_career) ? (c.credibility_by_career as Record<string, number>) : {},
          linkedin_worthy: !!c.linkedin_worthy, node_ids: strs(c.node_ids), url: c.url ? String(c.url) : null,
          notes: String(c.notes ?? ''), price_status: String(c.price_status ?? ''),
        }
      }
    }
  }

  // ---- cross references: warn and drop, never crash
  const resolved = new Set<string>()
  for (const n of Object.values(nodes)) {
    for (const p of n.prereqs) if (!nodes[p]) warn.push(`node ${n.id}: unknown prerequisite ${p} (ignored)`)
    n.prereqs = n.prereqs.filter((p) => nodes[p] && p !== n.id)
    for (const k of Object.keys(n.maths)) {
      if (!nodes[k]) {
        warn.push(`node ${n.id}: unknown maths node ${k} (ignored)`)
        delete n.maths[k]
      }
    }
    for (const r of n.resources) if (!resources[r]) warn.push(`node ${n.id}: unknown resource ${r}`)
    n.resources = n.resources.filter((r) => resources[r])
    if (cf !== undefined) {
      n.certs = n.certs.map((c) => {
        if (certs[c]) return c
        const r = resources[c]
        // math-track lists resource ids as certs: use the resource's certificate (seen in the real bank, 2026-10-23)
        if (r?.certificate) {
          if (typeof r.certificate === 'string' && certs[r.certificate]) return r.certificate
          const info = isObj(r.certificate) ? r.certificate : {}
          certs[c] = {
            id: c, name: `Certificate: ${r.title}`, issuer: String(info.provider ?? ''), cost_inr: num(info.exam_fee_inr),
            free_option: info.note ? String(info.note) : null, time_hours: r.hours, credibility: '', credibility_by_career: {},
            linkedin_worthy: true, node_ids: [], url: r.url, notes: "from the resource's certificate field", price_status: '', from_resource: true,
          }
          resolved.add(c)
          return c
        }
        warn.push(`node ${n.id}: unknown certificate ${c}`)
        return ''
      }).filter((c) => c && certs[c])
    }
  }
  for (const c of [...resolved].sort()) warn.push(`certificate id ${c} is a resource, not in certs.json: used the resource's certificate details`)
  for (const n of Object.values(nodes)) {
    for (const c of n.certs) if (certs[c]?.from_resource && !certs[c].node_ids.includes(n.id)) certs[c].node_ids.push(n.id)
  }
  for (const c of Object.values(certs)) {
    for (const id of c.node_ids) if (!nodes[id]) warn.push(`certificate ${c.id}: unknown node ${id}`)
    c.node_ids = c.node_ids.filter((id) => nodes[id])
    for (const id of c.node_ids) if (!nodes[id].certs.includes(c.id)) nodes[id].certs.push(c.id)
  }
  for (const car of careers) {
    for (const k of Object.keys(car.weights)) {
      if (!nodes[k]) {
        warn.push(`career ${car.id}: unknown node ${k}`)
        delete car.weights[k]
      }
    }
  }
  for (const cyc of findCycles(nodes)) err.push(`prerequisite cycle: ${cyc.join(' -> ')}`)
  const contractIndex: Record<string, string> = {}
  for (const id of order) for (const c of nodes[id].contracts) if (!(c.id in contractIndex)) contractIndex[c.id] = id
  return { version, careers, nodes, order, resources, certs, math, contractIndex, warnings: warn, errors: err, files: Object.keys(files).sort() }
}

/** The bundled bank: whatever files exist in ./bank/ at build time. */
const RAW = import.meta.glob('./bank/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

let cached: Bank | null = null
export function loadBank(): Bank {
  if (cached) return cached
  const files: Record<string, unknown> = {}
  for (const [path, json] of Object.entries(RAW)) {
    const name = path.split('/').pop()!
    if ((BANK_FILES as readonly string[]).includes(name)) files[name] = json
  }
  cached = mergeBank(files)
  return cached
}

/** A career's weight for a node; with no career chosen, the best weight any career gives it. */
export function careerWeight(bank: Bank, career: string | null, nodeId: string): number {
  const car = bank.careers.find((c) => c.id === career)
  if (!car) return bank.careers.length ? Math.max(...bank.careers.map((c) => c.weights[nodeId] ?? 0)) : 0.5
  return car.weights[nodeId] ?? 0
}
