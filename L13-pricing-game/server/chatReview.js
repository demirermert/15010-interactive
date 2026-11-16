// The AI legal review of the chat game (Mert, 2026-11-16): after a chat game with the review on, every pair's chat is
// sent to the model with the law in antitrust_law.md, and the model returns Legal or Illegal, who crossed the line, the
// rule, a short reason and the lines that decide it. The students' names never leave the server: the model sees
// "Station A" and "Station B". Same gateway and model as the AI player (OPENAI_BASE_URL, AI_MODEL, OPENAI_API_KEY).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const LAW_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'antitrust_law.md');
// from "## The setting" on: the note at the top is for whoever edits the file
const RAW = fs.readFileSync(LAW_FILE, 'utf8');
export const LAW_TEXT = RAW.includes('## The setting') ? RAW.slice(RAW.indexOf('## The setting')) : RAW;
const MODEL = process.env.AI_MODEL || 'gpt-4o';
const KEY = process.env.OPENAI_API_KEY;
const client = KEY ? new OpenAI({ apiKey: KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 60000, maxRetries: 1 }) : null;

export const reviewAvailable = () => !!client;

const SYSTEM = `You are an antitrust lawyer reviewing messages between two competing gas stations for a class exercise.
Apply exactly the law and the decision rule you are given. Answer with one JSON object and nothing else:
{"verdict": "Legal" or "Illegal",
 "crossedBy": "A", "B", "both" or "neither" (which station sent the messages that make it illegal; "neither" when Legal),
 "rule": the name of the rule that decides it, a few words (e.g. "Price agreement (Sherman Act Section 1)", "Invitation to collude (FTC Act Section 5)", "No discussion of prices"),
 "reason": two or three plain sentences for the students saying why, naming the stations as Station A and Station B and citing the rule,
 "evidence": up to three of the messages that decide it, each {"round": number, "station": "A" or "B", "text": the message copied exactly}; an empty list when nothing in the chat is about prices}`;

// messages: [{ round, station: 'A'|'B', text }]
function transcript(messages) {
  return messages.map(m => `Round ${m.round}, Station ${m.station}: ${m.text}`).join('\n');
}

function parse(text) {
  const m = /\{[\s\S]*\}/.exec(text || '');
  if (!m) throw new Error('no JSON in the answer');
  const j = JSON.parse(m[0]);
  const verdict = /illegal/i.test(j.verdict) ? 'Illegal' : /legal/i.test(j.verdict) ? 'Legal' : null;
  if (!verdict) throw new Error(`no verdict in the answer: ${String(j.verdict).slice(0, 40)}`);
  return { verdict, crossedBy: ['A', 'B', 'both', 'neither'].includes(j.crossedBy) ? j.crossedBy : (verdict === 'Legal' ? 'neither' : 'both'),
    rule: String(j.rule || '').slice(0, 200), reason: String(j.reason || '').slice(0, 1200), evidence: Array.isArray(j.evidence) ? j.evidence : [] };
}

// One pair. Returns { verdict, crossedBy, rule, reason, evidence: [{ round, station, text }] }; throws when the model
// cannot be reached or answers nonsense twice.
export async function reviewChat(messages) {
  if (!messages.length) return { verdict: 'Legal', crossedBy: 'neither', rule: 'No messages', reason: 'The two stations sent each other no messages, so there was no communication to review.', evidence: [] };
  if (!client) throw new Error('No OpenAI key on this server');
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `THE LAW\n\n${LAW_TEXT}\n\nTHE MESSAGES (oldest first)\n\n${transcript(messages)}` }
        ],
        ...(/gpt-[5-9]|o[1-9]/.test(MODEL) ? { max_completion_tokens: 4000, reasoning_effort: 'low' } : { temperature: 0, max_tokens: 600 })
      });
      const out = parse(completion.choices[0]?.message?.content);
      // keep only quotes that really are in the chat (a model can paraphrase); a quote must match a message of that station
      const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      out.evidence = out.evidence.slice(0, 3).map(e => {
        const st = e?.station === 'B' ? 'B' : 'A';
        const hit = messages.find(m => m.station === st && (norm(m.text) === norm(e?.text) || (norm(e?.text).length >= 8 && norm(m.text).includes(norm(e?.text)))))
          || messages.find(m => norm(e?.text).length >= 8 && norm(m.text).includes(norm(e?.text)));
        return hit ? { round: hit.round, station: hit.station, text: hit.text } : null;
      }).filter(Boolean);
      return out;
    } catch (err) {
      lastErr = err;
      console.error(`[Chat review] attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw lastErr;
}
