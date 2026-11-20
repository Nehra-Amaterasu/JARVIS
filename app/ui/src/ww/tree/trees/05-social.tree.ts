import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'social',
  name: 'Social skills',
  about: 'Talking and working with other people, practised in real conversations.',
  refreshDays: 90,
  branches: [
    br('Listening', 'Letting the other finish | Asking a follow-up | Repeating it back accurately'),
    br('Small talk', 'Opening a conversation | Keeping it going | Closing it kindly'),
    br('Asking for help', 'Naming what is stuck | A clear, short request | Thanking and following up'),
    br('Giving feedback', 'Specific and kind | Offering a next step | A feedback talk that was received well'),
    br('Conflict repair', 'Calming down first | Saying what happened | An apology or an agreement'),
    br('Meetings', 'Joining in once | Taking notes | Leading a short meeting'),
    br('Networking', 'Introducing yourself | Following up after an event | A contact who helped'),
    br('Public speaking', 'A one-minute talk | A five-minute talk | A talk with questions'),
    br('Interviews', 'Telling your story | Answering a hard question | A full practice interview'),
    br('Boundaries', 'Noticing what you need | Saying no politely | Holding a boundary under pressure'),
    br('Social capstone', 'Pick a goal with a person | Practise it over a month | Write what changed', true),
  ],
}
export default tree
