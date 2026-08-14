const httpBase = () => `http://127.0.0.1:${process.env.DEBUG_PORT || 9223}`;

async function getTargets() {
  const res = await fetch(`${httpBase()}/json/list`);
  return res.json();
}

async function createPage() {
  const res = await fetch(`${httpBase()}/json/new?about:blank`, {
    method: "PUT",
  });
  return res.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const list = this.listeners.get(msg.method) || [];
        for (const fn of list) fn(msg.params);
      }
    };
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(method, fn) {
    (this.listeners.get(method) ||
      this.listeners.set(method, []).get(method)).push(fn);
  }

  close() {
    this.ws.close();
  }
}

export { getTargets, createPage, CDP };
