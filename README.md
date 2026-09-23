# Dynamics Toolkit

Chrome extension for Microsoft Dynamics 365 consultants, developers, and support teams. Built as one WXT project with isolated vanilla TypeScript content scripts and a React side-panel experience.

## Capability status

`implemented` means that the workflow is usable end to end in the supported setup. `partial` means that
the workflow is usable but has a material browser, Dynamics UI, or authentication limitation described
below. `roadmap` means that no functional workflow is shipped yet. UI containers, navigation, and
decorative controls are not counted as capabilities.

| Capability | Status | What is available |
| --- | --- | --- |
| Active record context | implemented | Shows and copies the organization, table logical name, record GUID, record name, and form context from the active model-driven record form. |
| Dataverse Web API console | implemented | Runs authenticated `GET`, `POST`, `PATCH`, `PUT`, and `DELETE` requests, supports OData/FetchXML query building, additional headers, request cancellation, and local request history. |
| Field metadata hover | partial | Shows schema name, attribute type, and required level for form fields; locating the hovered control depends on the current UCI DOM (see Limitations). |
| Dirty-field highlighting | partial | Tracks Xrm attribute changes and highlights mapped controls; only controls that can be associated with an Xrm attribute and a supported UCI DOM node are highlighted. |
| Component search and navigation | implemented | Searches tables, forms, system/personal views, plug-in steps, and cloud flows, then opens the selected component where Dynamics exposes a navigation target. |
| Plug-in trace log viewer | implemented | Loads recent trace records, filters the loaded page by result/mode/time/text, expands details, copies a record, and opens it in Dynamics. |
| Form performance monitor | partial | Reports form-ready timing, resource timings, long tasks, and event timings when the corresponding browser Performance APIs expose them. |
| Relationship map | implemented | Loads paged 1:N, N:1, and N:N metadata, filters it, expands related tables to depth three, caches results, and links back to table metadata. |
| Reproduction-step recorder | partial | Stores ordered manual steps, captures the visible tab, adds arrow/rectangle/redaction annotations, copies a text summary, and exports an HTML report with embedded annotated PNGs. Capture is viewport-only. |
| Saved environment management | implemented | Creates, edits, deletes, and labels Dynamics environments as Dev, Test, or Prod. |
| Environment switching | partial | Resolves the target entity set, checks whether the same record exists, and preserves available model-driven app context, but cannot authenticate the user in the target environment. |
| Dynamics theme override | implemented | Applies or removes the built-in dark Dynamics page stylesheet. |
| Custom CSS injection | implemented | Saves, enables, disables, resets, and applies a user-provided stylesheet to supported Dynamics pages. |
| Full-page and multi-tab repro capture | roadmap | The recorder does not stitch a scrolling page or capture background tabs. |

## Limitations

### Supported Dynamics hosts

The extension is injected only into HTTPS pages matching `https://*.dynamics.com/*`, and saved
environment URLs are validated against the same `*.dynamics.com` suffix. It is intended for Dynamics
365/Dataverse model-driven apps that expose `window.Xrm`. Power Apps pages on other domains, on-premises
Dynamics, sovereign-cloud hostnames that do not end in `.dynamics.com`, and arbitrary Dataverse custom
domains are not supported by the current manifest. A supported hostname alone is not sufficient: record
features require an active model-driven form with an available Xrm record context.

### Required privileges

The toolkit uses the signed-in Dynamics user's existing session and never elevates privileges. Every Web
API console request requires the Dataverse privileges that the same request would require normally
(`Read`, `Create`, `Write`, `Delete`, `Append`, or `Append To`, as applicable). Metadata hover and the
relationship map require access to table/attribute/relationship metadata. Component search additionally
requires read access to the queried definitions and records (including forms, views, personal views,
SDK message processing steps, and workflows); results the user cannot read may be absent or the search may
fail. The trace viewer requires organization-level plug-in tracing to be enabled and `Read` access to Plug-in
Trace Log records. Opening a result also remains subject to Dynamics security roles and app access.

### Request history

The Web API console stores request paths and response status codes locally. Saving request bodies and non-sensitive
header values is optional and off by default. Header names containing authentication, token, key,
secret, cookie, or session terms have their values removed from history even when the option is on.
Review paths and bodies for private data before enabling local payload history. The console checks the
active tab and record again before executing a request; switch back to the intended record if it changed.

### Hover and the UCI DOM

Field hover is not provided by an official Xrm hover API. It maps Xrm control names to current Unified
Interface DOM attributes such as `data-id` and control containers, then observes DOM changes. Microsoft can
change that markup without notice; custom controls, PCF controls, editable grids, composite controls,
iframes, and controls whose rendered identifiers do not map to Xrm names may have no tooltip or dirty
outline. Xrm field state remains the source of metadata and dirty values, but rendering the decoration is
DOM-dependent.

### `captureVisibleTab`

Recorder screenshots use the browser's `captureVisibleTab` API. A capture contains only the currently
visible viewport of the active tab in the current window: it is not a full-page capture, does not include
browser chrome, does not stitch scrolled content, and cannot capture a background tab. The active tab can
change between adding a step and taking its screenshot, so users must verify both the captured page and any
personal or confidential data before export. Browser-protected pages and browser/enterprise capture policy
can reject the operation.

### Performance API availability

Resource, navigation, Long Tasks, and Event Timing data comes from browser Performance APIs in the Dynamics
page. Long Tasks and Event Timing are reported only when the browser lists those entry types as supported;
otherwise the corresponding collection is unavailable. Collection begins when the page bridge installs,
uses finite browser timing buffers, and is not a server-side Dynamics trace. Cross-origin resources can hide
detailed timing and transfer sizes unless their responses opt in through Timing-Allow-Origin. Long-task
attribution is browser-provided container attribution, not the identity of a Dynamics event handler or
plug-in.

### Environment-switching authorization

Switching assumes that the user is already authorized in the target organization and that its session
cookies are available to the browser. The toolkit does not transfer tokens or credentials between
environments. On `401` or `403` it can open the target so the user can sign in, after which the switch must
be tried again. The user also needs permission to read table metadata and the target record. Record
verification assumes that the same table and GUID exist in the target; when they do not, the toolkit can
only offer to open the target without that record. Preserving an app ID or app name does not grant access to
that app in the target environment.

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
