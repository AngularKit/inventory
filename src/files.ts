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

/**
 * Files listed by Git (tracked + non-ignored untracked), or undefined when Git is not
 * installed or the folder is outside a repository. Any other failure is a real error.
 */
function gitListing(root: string): string[] | undefined {
  try {
    const listing = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
      // Keep the one recoverable diagnostic stable across the user's Git locale.
      env: { ...process.env, LC_ALL: 'C' },
    });
    return [...new Set(listing.split('\0').filter(Boolean))];
  } catch (error) {
    const { code, status, stderr } = error as { code?: string; status?: number; stderr?: string | Buffer };
    const diagnostic = stderr?.toString() ?? '';
    const outsideRepository = /^fatal: not a git repository \(or (?:any of the parent directories|any parent up to mount point [^\r\n]+)\)(?:: \.git)?\r?$/m.test(diagnostic);
    if (code === 'ENOENT' || (status === 128 && outsideRepository)) return undefined;
    throw new Error(`Échec de git ls-files : ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Never follow symlinked files or directories, nor paths leaving the selected tree. */
function insideWithoutSymlink(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) return false;
  }
  return fs.statSync(file).isFile();
}

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (!included(path.relative(root, file))) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

/** Git supplies tracked and non-ignored untracked files, including nested ignore rules. */
export function collectFiles(root: string): { files: string[]; scope: ScanScope } {
  if (!fs.statSync(root).isDirectory()) throw new Error(`Le chemin n'est pas un dossier : ${root}`);
  const listing = gitListing(root);
  if (!listing) {
    return { files: walk(root), scope: {
      mode: 'filesystem',
      warnings: ['Git indisponible ou dossier hors dépôt : seules les exclusions intégrées sont appliquées, pas les fichiers .gitignore.'],
    } };
  }
  const files = listing
    .filter(included)
    .map((file) => path.resolve(root, file))
    .filter((file) => insideWithoutSymlink(root, file))
    .sort();
  return { files, scope: { mode: 'git', warnings: [] } };
}
