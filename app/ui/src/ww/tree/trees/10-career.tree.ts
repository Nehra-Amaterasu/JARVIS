import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'career',
  name: 'Career skills',
  about: 'The documents and habits that carry a study plan into a job or an internship.',
  refreshDays: 90,
  branches: [
    br('CV', 'A one-page draft | Evidence for each line | A version someone reviewed'),
    br('Cover letter', 'A clear opening | Matching a role | A letter sent'),
    br('Portfolio', 'Choosing three pieces | Writing each one up | A page that is live'),
    br('Profile', 'A short summary | Skills with proof | A profile kept current'),
    br('Interview', 'Common questions | A story for each | A mock interview with feedback'),
    br('Project showcase', 'A repository that runs | A readme that explains | A demo shown to someone'),
    br('Referencing', 'Choosing a referee | Asking politely | A reference received'),
    br('Internship search', 'A target list | Tailored applications | An application sent'),
    br('Email etiquette', 'Subject and greeting | Short and clear | A reply thread handled well'),
    br('Time management', 'A weekly plan | Protecting focus time | A month of plans reviewed'),
    br('Certificate planning', 'Listing options | Costs and dates | A plan with a first step done'),
    br('German paperwork basics', 'Common forms | A checklist of documents | A form filled in and checked'),
    br('Career capstone', 'Pick a target role | Close the gaps you found | A complete, reviewed application', true),
  ],
}
export default tree
