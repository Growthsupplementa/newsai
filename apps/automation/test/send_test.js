const { generateVariants } = require('../mailer');

async function run() {
  const template = `Hi {name},\n\nI noticed your {company} is working on {researchSnippet}. {Would you be open to a 15-minute call|Could we schedule a quick chat|Are you available for a short call}?\n\nBest,\nSales Team`;
  const lead = { name: 'Alex', company: 'Acme Corp' };
  const variants = await generateVariants(template, lead, { variants: 4, refine: false, tone: 'friendly' });
  console.log('Generated variants:\n', variants.join('\n---\n'));
}

run().catch(err => console.error(err));
