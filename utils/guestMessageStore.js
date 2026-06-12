const { v4: uuidv4 } = require('uuid');

// In-memory store for guest messages. Messages live for a configurable TTL (ms).
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

class GuestMessageStore {
  constructor() {
    this.store = new Map(); // conversationId -> { messages: [], timeout }
    this.ttl = DEFAULT_TTL;
  }

  configure({ ttlMs } = {}) {
    if (typeof ttlMs === 'number') this.ttl = ttlMs;
  }

  _ensure(convId) {
    if (!this.store.has(String(convId))) {
      this.store.set(String(convId), { messages: [], timeout: null });
    }
    return this.store.get(String(convId));
  }

  addMessage(convId, message) {
    const entry = this._ensure(convId);
    const msg = Object.assign({}, message, { _id: message._id || uuidv4(), sentAt: message.sentAt || new Date() });
    entry.messages.push(msg);
    // refresh TTL
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.timeout = setTimeout(() => this.clearConversation(convId), this.ttl);
    return msg;
  }

  getMessages(convId) {
    const entry = this.store.get(String(convId));
    if (!entry) return [];
    // return a shallow copy
    return entry.messages.slice();
  }

  clearConversation(convId) {
    const key = String(convId);
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.timeout) clearTimeout(entry.timeout);
    this.store.delete(key);
    return true;
  }

  clearAll() {
    for (const [k, v] of this.store.entries()) {
      if (v.timeout) clearTimeout(v.timeout);
    }
    this.store.clear();
  }
}

module.exports = new GuestMessageStore();
