import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createEvents(stateDir, sinks = []) {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, 'events.jsonl');
  return function emit(evt) {
    const line = JSON.stringify({ t: Date.now(), ...evt });
    appendFileSync(file, line + '\n');
    for (const sink of sinks) sink(line);
  };
}
