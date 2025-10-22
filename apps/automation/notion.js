
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function findPageByEmailOrPhone(email, phone) {
  if (!process.env.NOTION_DATABASE_ID) return null;
  const filters = { or: [] };
  if (email) {
    filters.or.push({
      property: 'Email',
      rich_text: { contains: email }
    });
  }
  if (phone) {
    filters.or.push({
      property: 'Phone',
      rich_text: { contains: phone }
    });
  }
  if (filters.or.length === 0) return null;

  const resp = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: filters,
    page_size: 1
  });
  return resp.results && resp.results.length ? resp.results[0] : null;
}

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

  // Try to find existing page by email or phone, update if found
  const existing = await findPageByEmailOrPhone(lead.email, lead.phone);
  if (existing) {
    console.log('Updating existing Notion page', existing.id);
    await notion.pages.update({
      page_id: existing.id,
      properties: props
    });
    return;
  }

  console.log('Creating new Notion page for lead');
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: props
  });
}

module.exports = { updateNotion };
