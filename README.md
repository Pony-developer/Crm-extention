# Dynamics Toolkit

Chrome extension for Microsoft Dynamics 365 consultants, developers, and support teams. Built as one WXT project with isolated vanilla TypeScript content scripts and a React side-panel experience.

## Implemented MVP

- Current record badge with GUID, logical entity name, and form context copying.
- Web API console that executes authenticated requests in the current Dynamics tab.
- Field metadata tooltip (schema name, attribute type, required level) and dirty-field highlighting.
- Developer command palette overlay and a Dynamics UI theme toggle.
- Live plugin trace log retrieval and saved Dev/Test/Prod environment management.
- Environment switching that resolves entity-set metadata, verifies the target record, handles target-org
  sign-in, and preserves record and model-driven app context when possible.
- Side-panel shells for performance, relationships, and repro recording.

> Component search, performance instrumentation,
> relationship metadata graphing, and screenshot/annotation capture are represented in the UI but are
> roadmap items. They are deliberately not described as production-ready functionality.

## Architecture

- `xrm-main.content.ts` runs in WXT's `MAIN` world and is the only entry point that touches `window.Xrm`.
- `content.ts` runs in the isolated extension world, owns the Shadow DOM UI, and communicates with the
  page bridge using request-correlated `window.postMessage` events.
- `popup/` is a React side panel; authenticated Web API calls execute in the current Dynamics tab.
- `background.ts` owns browser-level side-panel and keyboard-command behavior.

## Develop

```bash
npm install
npm run dev
```

Load the generated `.output/chrome-mv3` directory as an unpacked extension. Use `npm run build` for a production bundle and `npm run typecheck` to validate TypeScript.
