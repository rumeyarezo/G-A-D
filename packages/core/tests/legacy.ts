import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Carrega o JavaScript ORIGINAL do "Grana a Dois" (o arquivo salvo em fixtures/) dentro de uma
 * sandbox, sem navegador, para que os testes comparem o resultado antigo com o novo.
 */
export function loadLegacy() {
  const html = readFileSync(new URL('./fixtures/grana-legacy.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const code = scripts[scripts.length - 1]![1]!;
  const el = () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, style: {}, innerHTML: '' });
  const ctx = vm.createContext({
    document: {
      addEventListener() {},
      documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: el,
    },
    window: { matchMedia: () => ({ matches: false }), supabase: undefined },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    console,
  });
  vm.runInContext(code, ctx);
  /** Executa uma expressão dentro do app original e devolve o resultado (via JSON, pois são "realms" diferentes). */
  const run = <T>(expr: string): T => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx) ?? 'null') as T;
  const set = (name: string, value: unknown) => {
    vm.runInContext(`${name} = ${JSON.stringify(value)}`, ctx);
  };
  return { run, set, HOJE: run<string>('HOJE') };
}
