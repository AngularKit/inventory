# @angularkit/inventory

[Français](README.md) | **English**

Before creating an Angular component, find what your project already has and see how to reuse it.

Inventory scans your source files and suggests components with their imports, required inputs, and examples already present in your project. Read the results in your terminal or share them with a coding agent.

## Get started

With Node.js 18 or later, open a terminal at the root of your Angular project and run:

```bash
npx @angularkit/inventory . --md COMPONENTS.md
```

Open `COMPONENTS.md`: the catalogue contains one row per component, with its selector, inputs/outputs, detected usages, and import when resolved. Source files are unchanged; your chosen output file is created or overwritten.

Replace `.` with another project’s path to scan it. The report is saved relative to the directory where you run the command.

## Find a component to reuse

Describe what you need in a few words:

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --limit 3
```

Each candidate explains why it matches and provides available reuse information: an import, required inputs, standalone or NgModule integration, and existing usage snippets with file names and line numbers.

1. Check existing usages to decide whether the component meets your needs.
2. Use the suggested import. For a relative import, adjust its path to your calling file: the suggested path starts at the scanned project root.
3. Supply required inputs and check Angular dependencies. An existing snippet may refer to variables from its original context.

Search recognizes some interface terms in French and English: `carte` / `card`, `bouton` / `button`, `formulaire` / `form`. It also uses names, descriptions, inputs/outputs, and template text. This is not general translation: domain-specific terms depend on the vocabulary in your source files.

If no result fits, try a component name or selector, rephrase your query, or browse the full catalogue. An empty search does not prove that a suitable component is missing.

## Save and share results

```bash
# Full catalogue with a reuse card for each component
npx @angularkit/inventory . --md COMPONENTS.md --details

# Inventory for use in a script
npx @angularkit/inventory . --json components.json

# Search results in Markdown and JSON
npx @angularkit/inventory . --search "card" --md candidates.md --json candidates.json
```

Without an output option, the report appears in your terminal. Add `--quiet` to hide that report while still saving files. `--help` lists the available options. Report headings and terminal help are currently in French.

For a coding agent, generate the compact catalogue without `--details`, then add this instruction to your `AGENTS.md` or `CLAUDE.md`:

> Before creating a UI component, read `COMPONENTS.md` or run `npx @angularkit/inventory . --search "<need>"`. Review the candidates, their imports, required inputs, and existing usages, then state whether you will reuse, adapt, or whether none fits.

## Understand the results

- **Detected usages**: references in templates and some Angular routes. “No confirmed usage” does not mean “dead code”; dynamic usages may be missed.
- **Imports and inputs**: information resolved from source files and TypeScript configuration. Some computed metadata and inherited inputs are not resolved. Check integration in your application.
- **Component groups and repeated CSS**: suggestions for investigating similarities. They do not prove that two components are interchangeable or should be merged.

Inside a Git repository, the scan reads tracked files and new non-ignored files, including your local edits. It excludes dependencies, build outputs, tests, stories, and temporary Stryker copies. A tracked file remains included even if it matches a `.gitignore` rule.

Outside a Git repository or without Git installed, built-in exclusions still apply, but `.gitignore` rules do not; a warning explains this. Other Git errors stop the scan.

Analysis runs locally, with no telemetry or source uploads, and does not require building your project. `npx` may download the tool when you run it.

## Alongside Compodoc

[Compodoc](https://github.com/compodoc/compodoc#features) provides browsable Angular project documentation: components, services, routes, and graphs. Inventory focuses on a decision during development: “which component can I reuse, and how?”, with explained search results and information you can read directly in a terminal or give to a coding agent. The two can complement each other.

## Further reading

- [Report an issue](https://github.com/AngularKit/inventory/issues)
- [Technical reference (French)](https://github.com/AngularKit/inventory/blob/main/docs/REFERENCE.md)
- [Evaluation method (French)](https://github.com/AngularKit/inventory/blob/main/docs/EVALUATION.md)
- [Contributing (French)](https://github.com/AngularKit/inventory/blob/main/CONTRIBUTING.md)
