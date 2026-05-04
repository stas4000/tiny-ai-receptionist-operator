const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const DATA_FILE = process.env.LEADS_FILE || path.join(__dirname, 'leads.jsonl');
const WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || '';
const MAX_BODY_BYTES = 32768;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(payload);
}

function clean(value, maxLength = 400) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new Error('request_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function qualifyLead(input) {
  const text = clean(input, 4000);
  const lower = text.toLowerCase();
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d .()-]{6,}\d)/)?.[0] || '';
  const contact = email || phone || 'Missing';
  const name = extractName(text) || 'Unknown buyer';
  const business = classifyBusiness(lower);
  const need = classifyNeed(lower);
  const urgency = classifyUrgency(lower);
  const budget = extractBudget(text);
  const score = scoreLead({ contact, urgency, budget, need, text });
  const action = chooseAction(score, urgency, contact);

  return {
    received_at: new Date().toISOString(),
    name,
    contact,
    business,
    need,
    urgency,
    budget,
    score,
    action,
    summary: `${name} needs ${need.toLowerCase()} for ${business.toLowerCase()}. ${urgency} urgency. ${action}.`,
    raw: text
  };
}

function extractName(text) {
  const patterns = [
    /\bthis is ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
    /\bmy name is ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
    /\bi am ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
    /\bi'm ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
    /\bfrom ([A-Z][a-z]+) from\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const emailName = text.match(/([a-z]+)[._-]?[a-z]*@[a-z0-9.-]+\.[a-z]{2,}/i)?.[1];
  return emailName ? emailName.slice(0, 1).toUpperCase() + emailName.slice(1).toLowerCase() : '';
}

function classifyBusiness(lower) {
  if (/dental|clinic|doctor|patient|treatment|medical/.test(lower)) return 'Clinic or healthcare business';
  if (/restaurant|reservation|delivery|table|event/.test(lower)) return 'Restaurant or hospitality business';
  if (/agency|marketing|client|contractor|campaign/.test(lower)) return 'Agency or service business';
  if (/contractor|hvac|plumber|roof|repair/.test(lower)) return 'Home service business';
  return 'Local business';
}

function classifyNeed(lower) {
  if (/miss|calls|answer|reception|phone/.test(lower)) return 'AI call answering and receptionist handoff';
  if (/form|lead|qualif|score|summary/.test(lower)) return 'Lead qualification and owner summaries';
  if (/book|schedule|appointment|reservation/.test(lower)) return 'Booking and scheduling support';
  if (/follow up|gmail|telegram|whatsapp/.test(lower)) return 'Lead routing and follow-up automation';
  return 'Inbound lead handling';
}

function classifyUrgency(lower) {
  if (/today|asap|urgent|emergency|this week|before next weekend|quickly/.test(lower)) return 'High';
  if (/next week|soon|month|start/.test(lower)) return 'Medium';
  return 'Low';
}

function extractBudget(text) {
  const money = text.match(/(?:\$|usd\s*)\s?[\d,]+(?:\s?-\s?(?:\$|usd\s*)?\s?[\d,]+)?/i)?.[0];
  if (money) return money.replace(/\s+/g, ' ');
  const range = text.match(/\b[\d,]+\s?(?:to|-)\s?[\d,]+\b/)?.[0];
  return range || 'Not stated';
}

function scoreLead({ contact, urgency, budget, need, text }) {
  let score = 28;
  if (contact !== 'Missing') score += 18;
  if (urgency === 'High') score += 24;
  if (urgency === 'Medium') score += 12;
  if (budget !== 'Not stated') score += 14;
  if (/answer|qualif|book|summary|telegram|gmail|calls|lead/i.test(need)) score += 10;
  if (text.length > 120) score += 6;
  return Math.min(score, 98);
}

function chooseAction(score, urgency, contact) {
  if (contact === 'Missing') return 'Ask for contact details before routing';
  if (score >= 82 || urgency === 'High') return 'Call back within 5 minutes';
  if (score >= 62) return 'Send booking link and qualify budget';
  return 'Send nurture reply and request missing details';
}

async function notifyWebhook(lead) {
  if (!WEBHOOK_URL) return;
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead)
  });
  if (!response.ok) {
    throw new Error(`webhook_failed_${response.status}`);
  }
}

async function handleLead(req, res) {
  let payload;
  try {
    payload = JSON.parse(await collectBody(req) || '{}');
  } catch {
    return send(res, 400, { ok: false, error: 'Invalid JSON body' });
  }

  const lead = qualifyLead(payload.message || payload.inquiry || '');
  if (!lead.raw) {
    return send(res, 400, { ok: false, error: 'Missing inquiry text' });
  }

  fs.appendFileSync(DATA_FILE, JSON.stringify(lead) + '\n', 'utf8');

  try {
    await notifyWebhook(lead);
  } catch (error) {
    return send(res, 202, { ok: true, lead, warning: error.message });
  }

  return send(res, 200, { ok: true, lead });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/api/leads') return handleLead(req, res);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
  }

  return send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`tiny-ai-receptionist-operator listening on http://127.0.0.1:${PORT}`);
});
