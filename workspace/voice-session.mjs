/** Realtime speech delegates every request to the existing authorized agent.
 * The browser receives audio/events but never owns tool execution or credentials.
 */
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export const VOICE_TOOL = { type: 'function', name: 'ask_agent', description: 'Ask the conversation’s existing agent to handle the current spoken request.', parameters: { type: 'object', properties: {}, additionalProperties: false } };
export const voiceConfiguration = () => ({
  max_output_tokens: 1000,
  instructions: 'You are the voice interface to the existing workspace agent. Call ask_agent for each request. Only that agent can access workspace information or take actions. Speak its answer concisely and accurately. Never invent tool results. Approvals must be answered in the chat UI. Audio is local to the caller; a shared channel retains the transcript.',
  tools: [VOICE_TOOL],
  audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true } } },
});

export class VoiceSessions {
  constructor({ open, key, callback, socket = (url, options) => new WebSocket(url, options), now = Date.now, fetchImpl = fetch }) {
    this.fetch = fetchImpl; this.open = open; this.key = key; this.callback = callback; this.socket = socket; this.now = now; this.sessions = new Map();
  }
  async start({ id, offer, userId }) {
    if (this.sessions.has(id)) throw new Error('Voice session already started');
    const row = { id, state: 'connecting', until: this.now() + 300000, seen: new Set(), queue: [], busy: false, current: null, closed: false };
    this.sessions.set(id, row);
    try {
      await this.callback({ id, operation: 'authorize' });
      const call = await this.open({ offer, userId, configuration: voiceConfiguration(), returnCall: true });
      row.call = call.call;
      if (!/^rtc_[A-Za-z0-9_-]+$/.test(row.call)) throw new Error('Missing provider call identifier');
      const ws = row.ws = this.socket(`wss://api.openai.com/v1/realtime?call_id=${row.call}`, { headers: { Authorization: `Bearer ${this.key}` } });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Voice connection timed out')), 10000);
        ws.once('open', () => { clearTimeout(timer); resolve(); });
        ws.once('error', () => { clearTimeout(timer); reject(new Error('Voice connection failed')); });
      });
      row.state = 'live';
      row.send = event => { if (!row.closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
      ws.on('message', raw => { void Promise.resolve().then(() => this.event(row, JSON.parse(String(raw)))).catch(() => this.stop(id)); });
      ws.on('error', () => { void this.stop(id); });
      ws.on('close', () => { void this.stop(id); });
      row.timer = setInterval(() => { void (async () => {
        if (this.now() >= row.until) return this.stop(id);
        await this.callback({ id, operation: 'authorize' });
      })().catch(() => this.stop(id)); }, 5000).unref();
      return { id, answer: call.answer, maxSeconds: 300 };
    } catch (error) { await this.stop(id); throw error; }
  }
  async dispatch(row) {
    if (row.closed || row.busy || !row.queue.length) return;
    row.busy = true;
    await this.callback({ id: row.id, operation: 'authorize' });
    if (row.closed) return;
    row.current = row.queue.shift();
    row.send({ type: 'response.create', response: { tools: [VOICE_TOOL], tool_choice: { type: 'function', name: 'ask_agent' } } });
  }
  async event(row, event) {
    if (row.closed) return;
    if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
      throw new Error('Voice provider failed');
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const text = event.transcript?.trim();
      if (!text || text.length > 12000 || row.seen.has(event.item_id)) return;
      if (row.queue.length >= 20) throw new Error('Too many pending requests');
      row.seen.add(event.item_id);
      row.queue.push({ event: event.item_id, body: text, requestId: randomUUID() });
      await this.dispatch(row);
    } else if (event.type === 'response.function_call_arguments.done' && event.name === 'ask_agent' && row.current) {
      const item = row.current; row.current = null;
      // Provider callbacks, not browser-supplied arguments, determine the request.
      let result = await this.callback({ id: row.id, operation: 'request', ...item });
      while (!row.closed && result.pending) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await this.callback({ id: row.id, operation: 'result', requestId: item.requestId });
      }
      if (row.closed) return;
      row.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(result) } });
      row.send({ type: 'response.create', response: { tools: [], tool_choice: 'none', metadata: { voice_stage: 'speech' } } });
      row.speaking = true;
    } else if (event.type === 'response.done') {
      await this.callback({ id: row.id, operation: 'record', event: event.response?.id || randomUUID(), kind: 'usage', data: event.response?.usage || {} });
      if (['failed', 'incomplete'].includes(event.response?.status)) throw new Error('Voice response did not complete');
      if (row.speaking && event.response?.metadata?.voice_stage === 'speech') { row.speaking = false; row.busy = false; await this.dispatch(row); }
    } else if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(event.type)) {
      await this.callback({ id: row.id, operation: 'record', event: event.item_id, kind: 'spoken', data: event.transcript });
    }
  }
  async stop(id) {
    const row = this.sessions.get(id);
    if (!row || row.closed) return;
    row.closed = true; clearInterval(row.timer); row.ws?.close();
    try { if (row.call) await this.fetch(`https://api.openai.com/v1/realtime/calls/${row.call}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(5000) }); }
    finally { this.sessions.delete(id); await this.callback({ id, operation: 'ended' }).catch(() => {}); }
  }
  async close() { await Promise.allSettled([...this.sessions.keys()].map(id => this.stop(id))); }
}
