import { qualifyProspect } from './rules.js';
const limit = Number((process.argv.find(a => a.startsWith('--limit=')) || '--limit=100').split('=')[1]);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');
async function request(path, options = {}) { const res = await fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) } }); if (!res.ok) throw new Error(`${res.status} ${await res.text()}`); return res.status === 204 ? null : res.json(); }
const prospects = await request(`prospects?select=*&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 1000))}`);
const counts = { processed: 0, priority: 0, qualified: 0, rejected: 0 };
for (const p of prospects) { const q = qualifyProspect(p); const metadata = { ...(p.metadata || {}), qualification: { merchantConfidence: q.merchantConfidence, reason: q.reason, qualifiedAt: new Date().toISOString() } }; await request(`prospects?id=eq.${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ qualification_score: q.score, status: q.status, metadata, updated_at: new Date().toISOString() }) }); counts.processed++; counts[q.status]++; }
console.log(JSON.stringify(counts, null, 2));
