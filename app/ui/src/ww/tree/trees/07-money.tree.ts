import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'money',
  name: 'Money',
  about: 'Everyday money skills for a student: tracking, saving and understanding what you sign.',
  refreshDays: 90,
  branches: [
    br('Budgeting', 'List income and costs | A monthly plan | A month kept to the plan'),
    br('Spend-log habit', 'Logging for a week | Logging for a month | Reading what the log shows'),
    br('Saving', 'A first small goal | A regular transfer | A goal reached'),
    br('Banking basics', 'Account types | Cards and limits | Reading a statement'),
    br('Taxes basics', 'What tax is for | Forms a student may meet | A worked example'),
    br('Scholarship search', 'Where to look | A shortlist | A finished application'),
    br('Loans explained', 'Interest in plain words | Comparing two offers | A repayment table'),
    br('Scams awareness', 'Common scam signs | Checking a sender | A reported or declined attempt'),
    br('Currency basics', 'Exchange rates | Fees and spreads | A converted budget'),
    br('Funding plan', 'Costs of a study plan | Sources of funds | A full written plan'),
  ],
}
export default tree
