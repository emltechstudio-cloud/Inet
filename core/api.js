/* api.js — HTTP fetch wrapper */
import { Config } from './state.js';

export async function apiFetch(path, options = {}, retries = 3) {
  const url = `${Config.API}${path}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      if (res.ok) return res;
      if (res.status >= 500) throw new Error(`Server ${res.status}`);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}
