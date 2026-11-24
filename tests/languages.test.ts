import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findLang, LANGS, normalize } from '../src/core/languages';

describe('languages', () => {
  it('names Java files after the public class', () => {
    const java = findLang('java')!;
    expect(java.filename('public class Sum { }')).toBe('Sum.java');
    expect(java.filename('class X {}')).toBe('Main.java');
  });

  it('matches CSES option labels', () => {
    const cpp = findLang('cpp')!;
    const opt = (id: string) => cpp.options!.find((o) => o.id === id)!;
    expect(opt('c++17').matches('C++17')).toBe(true);
    expect(opt('c++11').matches('C++17')).toBe(false);
    expect(findLang('python')!.options!.find((o) => o.id === 'pypy')!.matches('PyPy3')).toBe(true);
  });

  // https://cses.fi/howto/ lists the language names CSES uses; every CSES+ language must be on it.
  it('only offers languages listed on the CSES how-to page', () => {
    const howto = normalize(readFileSync('tests/fixtures/howto.html', 'utf8').replace(/<[^>]+>/g, ' '));
    for (const l of LANGS) expect(l.csesNames.some((n) => howto.includes(n))).toBe(true);
  });
});
