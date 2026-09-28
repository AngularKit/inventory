import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const IGNORED = new Set([
  'node_modules', 'dist', '.nx', '.angular', 'coverage', '.git', 'tmp',
  'out-tsc', 'storybook-static', '.stryker-tmp', '__tests__', '__mocks__', 'test-utils', 'test-helpers',
]);

function included(file: string): boolean {
  return !file.split(/[\\/]/).some((part) => IGNORED.has(part))
    && !/(?:\.(?:spec|test|stories|d)\.ts$|(?:^|[/\\])(?:test-setup|setup-tests)\.ts$)/.test(file);
}

export interface ScanScope {
  mode: 'git' | 'filesystem';
  warnings: string[];
}

/** Git supplies tracked and non-ignored untracked files, including nested ignore rules. */
export function collectFiles(root: string): { files: string[]; scope: ScanScope } {
  if (!fs.statSync(root).isDirectory()) throw new Error(`Le chemin n'est pas un dossier : ${root}`);
  try {
    const listing = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    const files = [...new Set(listing.split('\0').filter(Boolean))]
      .filter(included)
      .map((file) => path.resolve(root, file))
      .filter((file) => {
        const relative = path.relative(root, file);
        if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
        // Never follow symlinked files or directories outside the selected tree.
        let current = root;
        for (const part of relative.split(path.sep)) {
          current = path.join(current, part);
          if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) return false;
        }
        return fs.statSync(file).isFile();
      }).sort();
    return { files, scope: { mode: 'git', warnings: [] } };
  } catch {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (!included(path.relative(root, file))) continue;
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) files.push(file);
      }
    };
    walk(root);
    return { files: files.sort(), scope: {
      mode: 'filesystem',
      warnings: ['Git indisponible ou dossier hors dépôt : seules les exclusions intégrées sont appliquées, pas les fichiers .gitignore.'],
    } };
  }
}
