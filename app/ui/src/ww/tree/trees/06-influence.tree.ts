import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'influence',
  name: 'Influence and persuasion',
  about: 'Understanding how people are persuaded, so you can argue honestly and spot pressure. Recognition and writing only, never tactics aimed at one person.',
  refreshDays: 90,
  branches: [
    br('Cognitive biases', 'Naming ten common biases | Spotting one in an article | Checking your own reasoning for one'),
    br('Principles of persuasion', 'The six principles in research | Finding them in adverts | Explaining where each one is fair'),
    br('Framing', 'Same facts, two frames | Rewriting a headline | Describing a choice neutrally'),
    br('Spotting manipulation', 'Pressure and false urgency | Dark patterns in an app | A short report on one you found'),
    br('Honest negotiation', 'Interests and positions | Preparing a fair offer | A written plan with a fallback'),
    br('Argument structure', 'Claim, reason, evidence | Answering an objection | A one-page argument'),
    br('Storytelling', 'A beginning, middle and end | A true story with a point | A story told aloud'),
    br('Resisting pressure', 'Pausing before you answer | Asking for time | Declining a push in writing'),
    br('Consent and ethics', 'Why consent matters | Telling persuasion from coercion | A personal rule list'),
  ],
}
export default tree
