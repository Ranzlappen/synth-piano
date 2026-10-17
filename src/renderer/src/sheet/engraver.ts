// Client for the engraving worker. Only the latest request is rendered; older pending
// requests resolve as superseded.

export interface EngraveRequest {
  musicxml: string;
  options: Record<string, unknown>;
  headers: string;
}

export interface EngraveResult {
  pages: string[];
  version: string;
}

export class SupersededError extends Error {}

class EngraverClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: EngraveResult) => void; reject: (e: Error) => void }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const url = new URL('workers/engraver.js', document.baseURI);
    this.worker = new Worker(url, { type: 'classic', name: 'engraver' });
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, pages, error, version } = e.data as {
        id: number;
        ok: boolean;
        pages: string[];
        error: string;
        version: string;
      };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve({ pages, version });
      else p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Engraver failed to start'));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  render(req: EngraveRequest): Promise<EngraveResult> {
    const worker = this.ensure();
    const id = ++this.seq;
    for (const [pid, p] of this.pending) {
      p.reject(new SupersededError('superseded'));
      this.pending.delete(pid);
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...req });
    });
  }
}

export const engraver = new EngraverClient();
