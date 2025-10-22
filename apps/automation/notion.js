const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function updateNotion(lead) {
  if (!process.env.NOTION_DATABASE_ID) {
    console.warn('NOTION_DATABASE_ID not set; skipping notion update');
    return;
  }
  // lead: { name, email, phone, status, notes }
  const props = {
    Name: {
      title: [
        {
          text: { content: lead.name || 'Unknown' }
        }
      ]
    }
  };
  if (lead.email) {
    props.Email = { rich_text: [{ text: { content: lead.email } }] };
  }
  if (lead.phone) {
    props.Phone = { rich_text: [{ text: { content: lead.phone } }] };
  }
  if (lead.status) {
    props.Status = { rich_text: [{ text: { content: lead.status } }] };
  }
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: props
  });
}

module.exports = { updateNotion };
