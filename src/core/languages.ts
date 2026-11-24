// Languages offered in the CSES+ editor. Names and options follow https://cses.fi/howto/.
// The exact <option> values come from the live CSES submit form; these entries only describe how to match them.

export interface LangOption {
  id: string;
  label: string;
  matches: (optionText: string) => boolean;
}

export interface Lang {
  id: string;
  label: string;
  monaco: string;
  csesNames: string[]; // normalized (lowercase, no spaces) names accepted in CSES's language select
  options?: LangOption[];
  defaultOption?: string;
  template: string;
  filename: (code: string) => string;
}

export const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');

const fixed = (name: string) => () => name;

export const LANGS: Lang[] = [
  {
    id: 'cpp',
    label: 'C++',
    monaco: 'cpp',
    csesNames: ['c++'],
    options: ['11', '17', '20', '23'].map((v) => ({
      id: `c++${v}`,
      label: `C++${v}`,
      matches: (s: string) => new RegExp(`(^|\\D)${v}(\\D|$)`).test(s),
    })),
    defaultOption: 'c++20', // CSES's own default on its submit form
    template: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`,
    filename: fixed('solution.cpp'),
  },
  {
    id: 'python',
    label: 'Python 3',
    monaco: 'python',
    csesNames: ['python3'],
    options: [
      { id: 'cpython', label: 'CPython', matches: (s: string) => /cpython/i.test(s) },
      { id: 'pypy', label: 'PyPy', matches: (s: string) => /pypy/i.test(s) },
    ],
    defaultOption: 'pypy', // CSES's own default on its submit form
    template: `import sys

input = sys.stdin.readline


def main():
    pass


main()
`,
    filename: fixed('solution.py'),
  },
  {
    id: 'java',
    label: 'Java',
    monaco: 'java',
    csesNames: ['java'],
    template: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

    }
}
`,
    // Java wants the file named after its public class.
    filename: (code: string) => `${/public\s+(?:final\s+)?class\s+([A-Za-z_]\w*)/.exec(code)?.[1] ?? 'Main'}.java`,
  },
  {
    id: 'c',
    label: 'C',
    monaco: 'cpp',
    csesNames: ['c'],
    template: `#include <stdio.h>

int main(void) {

    return 0;
}
`,
    filename: fixed('solution.c'),
  },
  {
    id: 'rust',
    label: 'Rust',
    monaco: 'rust',
    csesNames: ['rust'],
    options: ['2018', '2021'].map((v) => ({ id: v, label: `Edition ${v}`, matches: (s: string) => s.includes(v) })),
    defaultOption: '2021',
    template: `use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
}
`,
    filename: fixed('solution.rs'),
  },
  {
    id: 'ruby',
    label: 'Ruby',
    monaco: 'ruby',
    csesNames: ['ruby'],
    template: `n = gets.to_i
`,
    filename: fixed('solution.rb'),
  },
  {
    id: 'node',
    label: 'Node.js',
    monaco: 'javascript',
    csesNames: ['node.js', 'nodejs'],
    template: `const lines = require('fs').readFileSync(0, 'utf8').split('\\n');
`,
    filename: fixed('solution.js'),
  },
];

export const findLang = (id: string | undefined) => LANGS.find((l) => l.id === id);
